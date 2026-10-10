/* CDM prototype - engine: the renewal run behind the Certificate journey and the automation schedule, scan flow, servers view and self-test. */
(function () {
  'use strict';
  const A = window.CDM_APP, D = A.D, S = A.S, DAY = D.DAY, $ = A.$, esc = A.esc, icon = A.icon, pill = A.pill;
  const srv = A.srv, certById = A.certById, isDue = A.isDue, sleep = A.sleep, uid = A.uid;
  const STAGES = [['Discover', 'scan, window & CA'], ['Landing', 'key, CSR, certificate'], ['Match', 'identity checks'], ['Plan', 'deployment jobs'], ['Deploy', 'backup · install'], ['Confirm', 're-login & verify'], ['Retire', 'remove replaced']];
  const ST = { discover: 0, landing: 1, match: 2, plan: 3, deploy: 4, confirm: 5, retire: 6 };
  const RETIRE_DAYS = 7;   // how long a replaced certificate stays on the server as the way back
  const STEPS = ['precheck', 'backup', 'install', 'activate', 'verify'];
  const CHANGES_SERVER = ['install', 'activate', 'verify'];   // a failure from here on means the server was touched: roll back
  const FAIL_TEXT = { linux_apache: 'apachectl configtest failed after install: SSLCertificateKeyFile does not match the certificate', linux_nginx: 'nginx -t failed: SSL_CTX_use_PrivateKey_file: key values mismatch',
    windows_iis: 'Set-WebBinding failed: access denied to the private key', windows_store: 'Restart-Service failed: the service did not start with the new certificate', java_keystore: 'keytool -importkeystore failed: alias exists with a different key' };
  const INSTALL_FAIL = { linux_apache: 'the private key does not belong to the certificate', linux_nginx: 'the private key does not belong to the certificate', windows_iis: 'Import-PfxCertificate failed: access is denied',
    windows_store: 'Import-PfxCertificate failed: access is denied', java_keystore: 'keytool -importkeystore failed: keystore password was incorrect' };
  const INSTALL_TEXT = { linux_apache: 'New certificate and key written next to the old files, then the configured paths switched to them in one step', linux_nginx: 'New certificate and key written next to the old files, then the configured paths switched to them in one step',
    windows_iis: 'PFX imported into Cert:\\LocalMachine\\My; the private key is marked not exportable', windows_store: 'PFX imported into Cert:\\LocalMachine\\My; the private key is marked not exportable', java_keystore: 'Key pair imported into the keystore under the same alias' };
  const ACTIVATE_TEXT = { linux_apache: 'apachectl configtest passed; Apache reloaded gracefully', linux_nginx: 'nginx -t passed; nginx reloaded', windows_iis: 'HTTPS binding of the IIS site switched to the new thumbprint',
    windows_store: 'Service restarted so it picks up the new certificate', java_keystore: 'Application restarted so it loads the updated keystore' };
  const sh = t => (t || '').slice(0, 16) + '…';

  // ------------------------------------------------------------------ pipeline
  const log = (msg, cls = '') => { const R = A.RUN; R.log.push({ t: Date.now(), msg, cls }); if (R.log.length > 700) R.log.shift(); A.ui(); };
  const checkpoint = async () => { const R = A.RUN; while (R.status === 'paused') await new Promise(r => setTimeout(r, 120)); return R.stop; };
  const setStage = (i, st) => { A.RUN.st[i] = st; A.ui(); };
  const active = () => !!A.RUN && ['running', 'paused', 'stopping'].includes(A.RUN.status);
  const candidates = () => A.certs().filter(c => { const s = srv(c.serverId), R = A.RUN; return c.managed && isDue(c) && !c.paused && !s.paused && s.status !== 'unreachable' && !R.dropped.has(c.id) && (!R.only || R.only.includes(c.id)); });

  // Certificate journey: every stage notes what it did to each certificate in R.trace; the Journey view replays one of them.
  const traced = c => (A.RUN.only ? A.RUN.only.includes(c.id) : c.managed && isDue(c));
  function note(c, key, status, lines, code) {
    const R = A.RUN, list = R.trace[c.id] || (R.trace[c.id] = []);
    let s = list.find(x => x.key === key);
    if (!s) list.push(s = { key, status, at: Date.now(), end: null, lines: [], code: null });
    s.status = status; if (lines) s.lines.push(...lines); if (code) s.code = code; if (status !== 'running') s.end = Date.now();
    A.ui();
  }
  // Step-by-step mode: before each stage of the one certificate being followed, wait until the operator presses Next.
  // Several pieces of work belong to one stage (scan, window and CA check are all Discover): the wait happens once per stage.
  const gate = async (c, key) => { const R = A.RUN; if (!R.stepMode || !R.only.includes(c.id)) return; const stage = A.stageOf(key); if (R.gated === stage) return; R.gated = stage; R.waiting = stage; A.ui(); while (R.waiting && !R.stop) await new Promise(r => setTimeout(r, 100)); R.waiting = null; };
  const inject = (c, key) => { const i = A.RUN.inject; return !!i && i.certId === c.id && i.at === key; };
  const fail = (c, e) => A.recordError({ certId: c.id, ...e });

  async function stageDiscover() {
    const R = A.RUN; setStage(ST.discover, 'active'); log('Stage 1: discover. Logging into servers (read-only)…', 'st');
    const servers = S.servers.filter(s => !R.only || R.only.some(id => certById(id).serverId === s.id)); let bindings = 0;
    for (const s of servers) {
      if (await checkpoint()) return;
      const list = A.certs().filter(c => c.serverId === s.id), follow = list.filter(traced), T = s.transport.toUpperCase();   // only certificates of the selected CAs
      if (s.paused) { log(`  ${s.name}: paused by operator, skipped`, 'warn'); follow.forEach(c => note(c, 'scan', 'skipped', [`${s.name} is paused by an operator, so it was not scanned`])); continue; }
      for (const c of follow) await gate(c, 'scan');
      const down = s.status === 'unreachable' ? s.error : follow.some(c => inject(c, 'scan')) ? `Connection timed out (port ${s.port})` : null;
      if (down) {
        log(`  ${s.name}: UNREACHABLE/FAILED - ${down}`, 'err'); R.problems++; A.audit('discovery.failed', s.name, { error: down }, R.actor);
        A.recordError({ stage: 'Discover', step: 'scan', code: 'SCAN_UNREACHABLE', message: down, serverId: s.id, certId: R.only && follow[0] ? follow[0].id : null, outcome: 'Server skipped; nothing changed' });
        follow.forEach(c => { R.dropped.add(c.id); note(c, 'scan', 'failed', [`Could not log in to ${s.name} (${s.host}) over ${T}: ${down}`, 'The certificate could not be read, so nothing was renewed or changed'], 'SCAN_UNREACHABLE'); });
        continue;
      }
      follow.forEach(c => note(c, 'scan', 'running', [`Logged in to ${s.name} (${s.host}) over ${T}, read-only`]));
      log(`  scanning ${s.name} (${s.host}) over ${T}…`); await sleep(260);
      let enrolled = 0, notDue = 0, notEl = 0;
      const already = list.filter(c => c.managed).length; bindings += already;
      if (S.settings.autoEnrol && !R.only) {
        for (const c of list.filter(c => !c.managed)) {
          if (!isDue(c)) { notDue++; continue; }
          if (A.inel(c)) { notEl++; log(`  not enrolled ${c.cn}: ${c.ineligible}`, 'warn'); continue; }
          if (enrolled >= S.settings.maxPerRun) { log(`  deferred ${c.cn}: max_per_run (${S.settings.maxPerRun}) reached`, 'warn'); continue; }
          c.managed = true; c.state = 'Managed'; c.ineligible = null; enrolled++; log(`  enrolled ${s.name}:${c.cn}  (${Math.round(A.dleft(c))}d left)`, 'ok'); A.audit('enrol.enrolled', c.cn, { server: s.name }, R.actor);
        }
        log(`  ${list.length} certificate(s) of the selected CAs found: ${enrolled} enrolled, ${already} already managed, ${notDue} not due, ${notEl} not eligible`);
      }
      list.forEach(c => { c.lastScanned = Date.now(); }); A.dbWrite('certificates_seen', list.length); A.audit('discovery.scanned', s.name, { certificates: list.length, enrolled }, R.actor);
      A.resolveErrors(x => x.code === 'SCAN_UNREACHABLE' && x.serverId === s.id, 'CDM', 'Server scanned successfully in ' + R.id);
      for (const c of list.filter(traced)) {
        const d = Math.round(A.dleft(c));
        note(c, 'scan', 'done', [`Found at ${c.location}`, `Issued by ${c.ca} · ${c.type} · ${c.keyAlg}`, `Thumbprint ${sh(c.thumbprint)} · expires ${A.fmtDate(c.notAfter)}`]);
        await gate(c, 'window');
        const why = !c.managed ? 'Not managed by CDM: ' + (A.inel(c) || c.ineligible || 'not enrolled') : c.paused ? 'Renewal is paused: ' + c.pauseReason : !isDue(c) ? 'Not due yet, so there is nothing to renew' : null;
        note(c, 'window', why ? 'skipped' : 'done', [`${d < 0 ? 'Expired ' + (-d) + ' day(s) ago' : d + ' day(s) left'}; the renewal window is ${S.settings.windowDays} days`, why || 'Due for renewal: continue to the CA check']);
      }
    }
    log(`  ${bindings} managed binding(s) read; ${candidates().length} due for renewal`, 'ok'); setStage(ST.discover, 'done');
  }

  // After the scan and before any renewal: confirm the scope. Only certificates whose issuing CA and its root CA are selected in the
  // automation setup are candidates at all; certificates of other CAs are not part of the run, so nothing is blocked or reported here.
  async function stageCaCheck() {
    const R = A.RUN; setStage(ST.discover, 'active'); const list = candidates();
    log(`Stage 2: CA check. ${list.length} due certificate(s) come from the selected root and issuing CAs…`, 'st');
    for (const c of list) {
      if (await checkpoint()) return;
      await gate(c, 'ca'); note(c, 'ca', 'running', [`Issuer on the certificate: ${c.ca}`]); await sleep(R.only ? 200 : 30);
      const v = A.caVerdict(c); R.cleared.add(c.id);
      note(c, 'ca', 'done', [`Issuing CA "${v.issuer.name}" is selected in the automation setup`, `Its root CA "${v.root.name}" is selected too`, 'In scope: continue to renewal']);
    }
    const out = S.certs.length - A.certs().length;
    log(`  ${R.cleared.size} in scope${out && !R.only ? `; ${out} certificate(s) of CAs that are not selected are left out` : ''}`, 'ok'); setStage(ST.discover, 'done');
  }

  async function stageLanding() {
    const R = A.RUN; setStage(ST.landing, 'active'); R.landed = new Map(); const list = candidates().filter(c => R.cleared.has(c.id));
    log(`Stage 3: landing. Obtaining replacements for ${list.length} due certificate(s) (${S.settings.acmeEnv} CA)…`, 'st'); let review = 0;
    for (const c of list) {
      if (await checkpoint()) return;
      const s = srv(c.serverId);
      if (c.state === 'Review' || (c.type !== 'DV' && S.settings.approveOvEv && !c.approved)) {
        if (c.state !== 'Review') { c.state = 'Review'; c.review = 'approval'; A.audit('review.queued', c.cn, { reason: 'OV/EV approval policy' }, R.actor); }
        log(`  REVIEW ${c.cn}: waiting for approval (${c.type})`, 'warn'); review++;
        note(c, 'order', 'blocked', [`This ${c.type} certificate is never replaced without a decision by a person`, 'It is waiting under Approvals. Approve it there, then run again']); continue;
      }
      const newThumb = (D.sha256(c.cn + Date.now() + uid(6)) + D.sha256(uid(8))).slice(0, 64).toUpperCase();
      if (c.type === 'DV') {
        await gate(c, 'order'); note(c, 'order', 'running'); await sleep(110);
        note(c, 'order', 'running', ['New private key generated on the CDM host: RSA-2048. It is never reused and never sent to the CA', `CSR built for CN=${c.cn} with SAN ${c.san.join(', ')}, signed with SHA-256`]);
        log(`  acme: ordering ${c.cn}`); note(c, 'order', 'running', [`Order with the CSR sent to the ${S.settings.acmeEnv} CA over ACME`]); await sleep(230);
        const bad = R.caOutage ? ['ACME_CA_UNREACHABLE', 'urn:ietf:params:acme:error:serverInternal :: the CA is unreachable']
          : inject(c, 'order') ? ['ACME_VALIDATION_FAILED', `ACME validation failed: proof not reachable at http://${c.cn}/.well-known/acme-challenge/ (port 80 blocked)`] : null;
        if (bad) {
          c.state = 'Failed'; c.lastError = bad[1]; R.problems++; log(`  acme: could not obtain '${c.cn}' - ${bad[1]}`, 'err'); A.audit('acme.issue_failed', c.cn, { error: bad[1] }, R.actor);
          note(c, 'order', 'failed', [bad[1], 'No certificate was issued. The server still has its current certificate'], bad[0]);
          fail(c, { stage: 'Landing', step: 'order', code: bad[0], message: bad[1], outcome: 'No certificate issued; server unchanged' }); continue;
        }
        log(`    HTTP-01 proof placed on ${s.host}:80, validated by the CA, certificate issued`, 'ok'); A.audit('acme.issued', c.cn, { ca: c.ca }, R.actor); A.dbWrite('acme_issuance');
        note(c, 'order', 'done', [`HTTP-01 proof file placed in the webroot on ${s.host} and fetched by the CA on port 80`, 'Name validated, order finalized, proof file removed', `Certificate issued by ${c.ca}: thumbprint ${sh(newThumb)}, valid 90 days`]);
      } else {
        await gate(c, 'order'); note(c, 'order', 'running', [`Not generated by CDM: ${c.type} certificates are requested outside CDM`, 'The CA checks the organisation before it issues']);
        log(`  folder: replacement ${c.cn}.crt + .key found in input_certificates/`, 'ok'); await sleep(120);
        note(c, 'order', 'done', [`Replacement ${c.cn}.crt and .key picked up from input_certificates/`, `Thumbprint ${sh(newThumb)}`]);
      }
      R.landed.set(c.id, { newThumb, via: c.type === 'DV' ? 'acme' : 'folder' });
    }
    log(`  ${R.landed.size} certificate(s) available${review ? `, ${review} waiting for approval` : ''}`, 'ok'); setStage(ST.landing, 'done');
  }

  async function stageMatch() {
    const R = A.RUN; setStage(ST.match, 'active'); await sleep(200);
    log(`Stage 4: match. ${R.landed.size} candidate(s). Same identity, different thumbprint, later expiry, no type downgrade`, 'st'); let n = 0;
    for (const [id, l] of [...R.landed]) {
      const c = certById(id); await gate(c, 'match');
      if (inject(c, 'match')) {
        const msg = `Replacement names (${c.cn}, www.${c.cn}) do not equal the names on the current certificate (${c.san.join(', ')})`;
        R.landed.delete(id); c.state = 'Failed'; c.lastError = msg; R.problems++; log(`  NO MATCH ${c.cn}: ${msg}`, 'err');
        note(c, 'match', 'failed', [msg, 'The replacement was rejected and not planned for deployment'], 'MATCH_SAN_MISMATCH');
        fail(c, { stage: 'Match', step: 'match', code: 'MATCH_SAN_MISMATCH', message: msg, outcome: 'Replacement rejected; server unchanged' }); continue;
      }
      note(c, 'match', 'done', ['Same common name and SAN as the certificate on the server', `Different thumbprint: ${sh(c.thumbprint)} → ${sh(l.newThumb)}`, `Later expiry and no type downgrade (${c.type} → ${c.type})`]);
      if (n++ < 8) log(`  ${c.cn}: ${c.type} -> ${c.type} (${l.via})`);
    }
    if (n > 8) log(`  … and ${n - 8} more`); await sleep(150); setStage(ST.match, 'done');
  }

  function newJob(c, landed) {
    const s = srv(c.serverId);
    return { id: 'JOB-' + uid(10).toUpperCase(), certId: c.id, cn: c.cn, serverId: s.id, zone: s.zone, tech: s.tech, state: 'Planned', steps: { precheck: 'pending', backup: 'pending', install: 'pending', activate: 'pending', verify: 'pending' },
      oldThumb: c.thumbprint, newThumb: landed.newThumb, oldNotAfter: c.notAfter, oldNotBefore: c.notBefore, startedAt: null, endedAt: null, error: null, canary: false, backupId: null, run: A.RUN.id };
  }
  async function stagePlan() {
    const R = A.RUN; setStage(ST.plan, 'active'); await sleep(200);
    R.jobs = [...R.landed].map(([id, l]) => newJob(certById(id), l)).sort((a, b) => a.zone.localeCompare(b.zone) || a.cn.localeCompare(b.cn));
    const seen = new Set(); R.jobs.forEach(j => { if (S.settings.canary && !seen.has(j.zone)) { seen.add(j.zone); j.canary = true; } });
    if (R.failNext && R.jobs.length) {
      const size = {}; R.jobs.forEach(x => { size[x.zone] = (size[x.zone] || 0) + 1; });
      const busiest = Object.keys(size).sort((a, b) => size[b] - size[a])[0];
      (R.jobs.find(x => x.zone === busiest && x.canary) || R.jobs.find(x => x.zone === busiest)).failAt = 'activate'; S.settings.failNext = false; A.save();
    }
    const target = R.inject && R.jobs.find(x => x.certId === R.inject.certId);
    if (target && STEPS.includes(R.inject.at)) target.failAt = R.inject.at; else if (target && R.inject.at === 'confirm') target.failConfirm = true;
    log(`Stage 5: plan. ${R.jobs.length} job(s) in ${new Set(R.jobs.map(j => j.zone)).size} zone(s)${S.settings.canary ? ', canary first' : ''}`, 'st');
    R.jobs.slice(0, 10).forEach(j => log(`  ${j.id}  ${j.cn} (${j.tech}, zone ${j.zone})${j.canary ? '  [canary]' : ''}`)); if (R.jobs.length > 10) log(`  … and ${R.jobs.length - 10} more`);
    for (const j of R.jobs) {
      const c = certById(j.certId); await gate(c, 'plan');
      note(c, 'plan', 'done', [`Deployment job ${j.id} created for ${srv(j.serverId).name} (${j.tech.replace('_', ' ')}, zone ${j.zone})`, j.canary ? 'Canary: it deploys first and alone; the rest of the zone waits for it' : 'It deploys after the canary of its zone succeeds']);
    }
    setStage(ST.plan, 'done');
  }

  const failText = (step, s) => ({ precheck: 'DRIFT_DETECTED: the server has a different certificate than the one the plan was made for', backup: 'BACKUP_FAILED: cannot write the backup (no space left on device)',
    install: 'INSTALL_FAILED: ' + (INSTALL_FAIL[s.tech] || 'install failed'), activate: FAIL_TEXT[s.tech] || 'activation failed', verify: 'VERIFY_MISMATCH: the endpoint still presents the old certificate after activation' }[step]);
  async function runJob(job) {
    const R = A.RUN, c = certById(job.certId), s = srv(job.serverId);
    job.state = 'Running'; job.startedAt = Date.now(); c.state = 'Renewing'; log(`  ${job.id} ${job.cn}: starting${job.canary ? ' (canary)' : ''}`); A.audit('deploy.started', job.id, { target: job.cn, host: s.host }, R.actor);
    for (const step of STEPS) {
      await gate(c, step); job.steps[step] = 'running'; note(c, step, 'running'); await sleep(300);
      const lines = [];
      if (step === 'precheck' && s.os === 'linux' && s.adapter !== 'installed') {
        if (!S.settings.autoInstallAdapter) { return failJob(job, c, step, 'ADAPTER_NO_RESPONSE: cdm_linux_adapter.sh is not installed on ' + s.name, false); }
        log(`    ${s.name}: deploy adapter missing, installing it over SSH (SHA-256 compared first)`, 'warn'); await sleep(350); s.adapter = 'installed'; A.audit('deploy.adapter_installed', s.name, { path: '/usr/local/sbin/cdm_linux_adapter.sh' }, R.actor);
        lines.push('Deploy adapter was missing: the reviewed script was installed over SSH');
      }
      if (job.failAt === step) return failJob(job, c, step, failText(step, s), CHANGES_SERVER.includes(step));
      if (step === 'precheck') lines.push(`${s.name} is reachable over ${s.transport.toUpperCase()}`, `The certificate on the server is still the planned one (${sh(job.oldThumb)})`, s.os === 'linux' ? 'Service configuration test passes before any change' : 'Target certificate store and service are present');
      if (step === 'backup') {
        const b = { id: 'BK-' + job.id.slice(4), jobId: job.id, certId: c.id, cn: c.cn, serverId: s.id, createdAt: Date.now(), retainUntil: Date.now() + 30 * DAY, path: s.os === 'windows' ? 'C:\\ProgramData\\CDM\\backups\\' + job.id : '/var/backups/cdm/' + job.id,
          sha256: D.sha256(job.id + c.thumbprint), oldThumb: c.thumbprint, oldNotAfter: c.notAfter, oldNotBefore: c.notBefore, status: 'available' };
        S.backups.unshift(b); job.backupId = b.id; A.audit('deploy.backup', job.id, { path: b.path }, R.actor);
        lines.push(`Previous certificate and key saved to ${b.path}`, `Backup ${b.id} · SHA-256 ${sh(b.sha256)} · kept for 30 days`);
      }
      if (step === 'install') lines.push(INSTALL_TEXT[s.tech] || 'New certificate installed');
      if (step === 'activate') lines.push(ACTIVATE_TEXT[s.tech] || 'Service switched to the new certificate');
      if (step === 'verify') lines.push(`${s.name} now presents the new thumbprint ${sh(job.newThumb)}`, 'The names on the certificate match the plan');
      job.steps[step] = 'done'; note(c, step, 'done', lines);
    }
    const now = Date.now(), life = c.type === 'DV' ? 90 : 365;
    c.history.unshift({ at: now, jobId: job.id, from: c.thumbprint, to: job.newThumb, outcome: 'Deployed' }); c.thumbprint = job.newThumb; c.serial = uid(32).toUpperCase();
    c.notBefore = now; c.notAfter = now + life * DAY; c.state = 'Managed'; c.lastError = null; c.lastScanned = now; c.approved = false;
    job.state = 'Deployed'; job.endedAt = now; A.dbWrite('deployment_jobs'); log(`  ${job.id} ${job.cn}: Deployed, awaiting confirmation`, 'ok'); A.audit('deploy.deployed', job.id, { thumbprint: job.newThumb.slice(0, 16) }, R.actor);
  }
  async function failJob(job, c, step, msg, rollback) {
    const R = A.RUN, code = (msg.match(/^([A-Z_]+):/) || [])[1] || step.toUpperCase() + '_FAILED', text = msg.replace(/^[A-Z_]+:\s*/, '');
    job.steps[step] = 'failed'; job.error = msg; A.ui();
    log(`  ${job.id} ${job.cn}: FAILED at ${step}. ${msg}`, 'err'); A.audit('deploy.failed', job.id, { step, error: msg }, R.actor);
    note(c, step, 'failed', [text, rollback ? 'The server was already changed, so CDM rolls it back' : 'Nothing was changed on the server'], code);
    if (rollback) {
      log(`    rolling back: restoring the previous certificate and verifying the old thumbprint…`, 'warn'); note(c, 'rollback', 'running'); await sleep(500);
      job.steps.verify = 'rolled'; job.state = 'Rolled back'; A.audit('rollback.completed', job.id, { verified: true, automatic: true }, R.actor); log(`    rollback verified: ${job.cn} serves the previous certificate again`, 'ok');
      note(c, 'rollback', 'done', ['Previous certificate and key restored from the backup', 'Service reactivated', `Old thumbprint ${sh(job.oldThumb)} verified: the server is back to its previous state`]);
    } else { job.state = 'Failed (no change made)'; }
    c.state = 'Failed'; c.lastError = msg; job.endedAt = Date.now(); R.problems++; A.dbWrite('deployment_jobs');
    fail(c, { stage: 'Deploy', step, code, message: text, jobId: job.id, outcome: rollback ? 'Rolled back automatically; old certificate verified' : 'No change made on the server' });
  }
  const failed = j => /^(Rolled back|Failed)/.test(j.state);
  async function deployZone(zone, jobs) {
    const R = A.RUN, set = S.settings, skip = (list, why) => list.forEach(j => { j.state = 'Skipped'; j.error = why; note(certById(j.certId), 'precheck', 'skipped', [why, 'Not deployed in this run; the next run tries again']); });
    const first = set.canary ? jobs.slice(0, 1) : [], rest = set.canary ? jobs.slice(1) : jobs;
    for (const j of first) {
      if (await checkpoint()) { skip(jobs.filter(x => x.state === 'Planned'), 'cancelled'); jobs.filter(x => x.state === 'Skipped').forEach(x => { x.state = 'Cancelled'; x.error = 'Stopped by operator'; }); return; }
      await runJob(j);
      if (failed(j) && set.stopOnFailure) { skip(rest, `zone '${zone}' halted: canary ${j.cn} failed`); log(`  zone '${zone}' halted: ${rest.length} job(s) skipped`, 'warn'); return; }
    }
    for (let i = 0; i < rest.length; i += set.maxParallel) {
      if (await checkpoint()) { rest.slice(i).forEach(j => { j.state = 'Cancelled'; j.error = 'Stopped by operator'; }); return; }
      const batch = rest.slice(i, i + set.maxParallel); await Promise.all(batch.map(runJob));
      if (batch.some(failed) && set.stopOnFailure) { const left = rest.slice(i + set.maxParallel); skip(left, `zone '${zone}' halted after a failure`); if (left.length) log(`  zone '${zone}' halted: ${left.length} job(s) skipped`, 'warn'); return; }
    }
  }
  async function stageDeploy() {
    const R = A.RUN; setStage(ST.deploy, 'active'); log(`Stage 6-11: deploy. ${R.jobs.length} job(s), one zone at a time in parallel, canary first, backup before every change…`, 'st');
    const zones = {}; R.jobs.forEach(j => (zones[j.zone] = zones[j.zone] || []).push(j));
    await Promise.all(Object.entries(zones).map(([z, js]) => deployZone(z, js)));
    const n = s => R.jobs.filter(j => s.test(j.state)).length;
    log(`  ${n(/^Deployed/)} deployed, ${n(/^Rolled/)} rolled back, ${n(/^Failed/)} failed, ${n(/^Skipped/)} skipped${n(/^Cancelled/) ? ', ' + n(/^Cancelled/) + ' cancelled' : ''}`, n(/^(Rolled|Failed)/) ? 'warn' : 'ok');
    setStage(ST.deploy, R.jobs.some(failed) ? 'error' : 'done');
  }
  async function stageConfirm() {
    const R = A.RUN, list = R.jobs.filter(j => j.state === 'Deployed'); setStage(ST.confirm, 'active'); log(`Stage 12: confirm. Logging in again to check ${list.length} deployment(s)…`, 'st');
    for (const j of list) {
      const c = certById(j.certId); await gate(c, 'confirm'); note(c, 'confirm', 'running'); await sleep(160);
      if (j.failConfirm) {
        const msg = `Re-scan found thumbprint ${sh(D.sha256(j.id))}, expected ${sh(j.newThumb)}: the certificate was changed after deployment`;
        j.state = 'Not confirmed'; j.error = msg; c.state = 'Failed'; c.lastError = msg; R.problems++; log(`  ${j.cn}: NOT CONFIRMED. ${msg}`, 'err'); A.audit('orchestrator.confirm_failed', j.id, { expected: j.newThumb.slice(0, 16) }, R.actor);
        note(c, 'confirm', 'failed', [msg, 'The deployment is not confirmed. A person has to check the server'], 'CONFIRM_MISMATCH');
        fail(c, { stage: 'Confirm', step: 'confirm', code: 'CONFIRM_MISMATCH', message: msg, jobId: j.id, outcome: 'Deployed but not confirmed; needs a manual check' }); continue;
      }
      j.state = 'Confirmed'; if (c.history[0]) c.history[0].outcome = 'Confirmed'; log(`  ${j.cn}: CONFIRMED (${j.newThumb.slice(0, 12)}…)`, 'ok'); A.audit('orchestrator.confirmed', j.id, { thumbprint: j.newThumb.slice(0, 16) }, R.actor);
      note(c, 'confirm', 'done', [`Logged in again and re-read ${c.location}`, `Thumbprint ${sh(j.newThumb)} matches the deployed certificate`]);
      A.resolveErrors(x => x.certId === c.id, 'CDM', 'Renewed and confirmed in ' + R.id);
    }
    setStage(ST.confirm, R.jobs.some(j => j.state === 'Not confirmed') ? 'error' : 'done');
  }

  // Stage 13 (cdm retire-replaced). A replaced certificate is deleted only after its renewal has been confirmed for RETIRE_DAYS,
  // so right after a renewal this stage runs and finds the certificate still inside its rollback window.
  async function stageRetire() {
    const R = A.RUN, list = R.jobs.filter(j => j.state === 'Confirmed'); setStage(ST.retire, 'active'); log(`Stage 13: retire-replaced. ${list.length} replaced certificate(s) checked against the ${RETIRE_DAYS}-day rollback window…`, 'st');
    for (const j of list) {
      if (await checkpoint()) return;
      const c = certById(j.certId), s = srv(j.serverId); await gate(c, 'retire'); note(c, 'retire', 'running'); await sleep(120);
      const what = s.tech === 'java_keystore' ? 'Nothing is left to remove in a Java keystore: the alias was replaced in place' : `On ${A.fmtDate(Date.now() + RETIRE_DAYS * DAY)} CDM deletes ${s.os === 'windows' ? 'the old entry from the Windows certificate store' : 'the superseded certificate and key files'}`;
      note(c, 'retire', 'done', [`The replaced certificate ${sh(j.oldThumb)} is still inside the ${RETIRE_DAYS}-day rollback window, so nothing is removed now`, what, 'Until then the renewal can be rolled back from Jobs & rollback']);
    }
    log(`  ${list.length} replaced certificate(s) still inside the rollback window`, 'ok'); setStage(ST.retire, 'done');
  }

  // opts: only [certId], step (wait for Next before each step of that certificate), inject { certId, at } (fail that step)
  async function runPipeline(opts = {}) {
    if (active()) return A.toast('A run is already in progress', 'warn');
    if (S.killSwitch) return A.toast('Emergency stop is active: renewals are frozen', 'err');
    if (A.SC && A.SC.running) return A.toast('Wait for the scan to finish', 'warn');
    if (!S.setup.selIssuers.length) return A.toast('No CA is selected yet: choose the Root CAs and Issuing CAs in Automation setup first', 'warn');
    const now = Date.now();
    A.RUN = { id: 'RUN-' + new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + uid(3), status: 'running', st: STAGES.map(() => 'pending'), only: opts.only || null, jobs: [], log: [], stop: false, problems: 0,
      started: now, ended: null, actor: S.settings.actor, failNext: S.settings.failNext, caOutage: S.settings.caOutage, landed: new Map(),
      trace: {}, cleared: new Set(), dropped: new Set(), inject: opts.inject || null, stepMode: !!opts.step && !!opts.only, waiting: null };
    const R = A.RUN; A.audit('run.started', R.id, { only: R.only, command: R.only ? 'renew ' + certById(R.only[0]).cn : 'run' }, R.actor);
    log(`$ cdm ${R.only ? 'renew ' + certById(R.only[0]).cn : 'run'}    (${R.id})`, 'st'); A.ui();
    try {
      for (const stage of [stageDiscover, stageCaCheck, stageLanding, stageMatch, stagePlan]) { if (R.stop) break; await stage(); }
      if (!R.stop && R.jobs.length) await stageDeploy(); else if (!R.stop) log('Nothing to deploy.', 'ok');
      if (!R.stop && R.jobs.length) { await stageConfirm(); if (!R.stop) await stageRetire(); }
      else if (R.stop) log('Stopped by operator. In-flight jobs finished safely; deployed certificates are confirmed by the next run.', 'warn');
    } catch (err) { log('Internal error: ' + err.message, 'err'); R.problems++; A.recordError({ stage: 'Pipeline', step: '', code: 'INTERNAL_ERROR', message: err.message, outcome: 'Run aborted; in-flight jobs are confirmed by the next run' }); }
    R.status = R.stop ? 'stopped' : 'done'; R.ended = Date.now(); R.waiting = null;
    R.st = R.st.map(x => (x === 'active' ? 'error' : x));
    S.jobs.unshift(...R.jobs.slice().reverse()); S.jobs.length = Math.min(S.jobs.length, 300);
    S.certs.forEach(c => { if (c.state === 'Renewing') c.state = 'Managed'; });
    Object.entries(R.trace).forEach(([id, steps]) => {
      steps.forEach(x => { if (x.status === 'running') { x.status = 'skipped'; x.end = R.ended; x.lines.push('The run was stopped before this step finished'); } });
      S.journeys[id] = { runId: R.id, at: R.started, steps };
    });
    S.journeys = Object.fromEntries(Object.entries(S.journeys).sort((a, b) => b[1].at - a[1].at).slice(0, 80));
    const exit = R.problems ? 2 : 0; log(`Run finished: ${R.status}, exit code ${exit}`, exit ? 'warn' : 'ok'); A.audit('run.finished', R.id, { status: R.status, problems: R.problems, exit }, R.actor); A.save(); A.ui(); A.renderView();
    return R;
  }
  A.runPipeline = runPipeline;
  // The scheduled run, started by hand for the demo: every due certificate of the selected CAs in one run. Its progress shows on Automation setup.
  A.handlers['auto-run'] = () => { if (!S.setup.done) { A.toast('Complete the automation setup first: the run uses its CA selection and schedule', 'warn'); return A.go('setup'); } if (active()) return A.toast('A run is already in progress', 'warn'); A.go('setup'); runPipeline(); };
  A.handlers.renew = el => { const c = certById(el.dataset.id); if (!c) return; A.closeLayer(); if (A.J) A.J.sel = c.id; A.go('journey'); runPipeline({ only: [c.id] }); };   // a manual renewal is followed on the Certificate journey
  A.handlers['run-stop'] = () => A.confirm({ title: 'Stop the renewal run?', danger: true, label: 'Stop gracefully', body: 'Jobs already in flight finish or roll back, so no server is left half-changed. Nothing new starts. Deployed certificates are confirmed by the next run.',
    onYes: () => { const R = A.RUN; if (!active()) return; R.stop = true; R.status = 'stopping'; log('Stop requested: finishing in-flight jobs…', 'warn'); A.audit('run.stop_requested', R.id, {}, R.actor); } });
  // ------------------------------------------------------------------ scan
  const SC = A.SC = { sel: new Set(), running: false, steps: [], idx: -1, results: null, days: null, errors: [], current: null };
  const scanSteps = s => s.os === 'windows'
    ? [`Open ${s.transport.toUpperCase()}/HTTPS session (port ${s.port})`, 'Read Cert:\\LocalMachine\\My and IIS bindings', 'Parse X.509 and check private keys', 'Record results (certificates_seen)']
    : [`Open ${s.transport.toUpperCase()} session (port ${s.port})`, 'Enumerate /etc/letsencrypt/live, /etc/ssl and configured paths', 'Parse X.509 and locate private keys', 'Record results (certificates_seen)'];
  async function scan(ids) {
    if (SC.running || active()) return A.toast(active() ? 'A renewal run is in progress' : 'A scan is already running', 'warn');
    SC.running = true; SC.results = null; SC.errors = []; const found = [];
    for (const id of ids) {
      const s = srv(id); SC.current = s; SC.steps = scanSteps(s); SC.idx = 0; A.ui();
      for (let i = 0; i < SC.steps.length; i++) {
        SC.idx = i; A.ui(); await sleep(420);
        if (i === 0 && s.status === 'unreachable') { SC.errors.push(`${s.name}: ${s.error}`); A.audit('discovery.failed', s.name, { error: s.error }); A.recordError({ stage: 'Discover', step: 'scan', code: 'SCAN_UNREACHABLE', message: s.error, serverId: s.id, runId: 'manual scan', outcome: 'Server skipped; nothing changed' }); break; }
        if (i === SC.steps.length - 1) { const list = A.certs().filter(c => c.serverId === id); list.forEach(c => { c.lastScanned = Date.now(); }); found.push(...list); A.dbWrite('certificates_seen', list.length); A.audit('discovery.scanned', s.name, { certificates: list.length }); A.resolveErrors(x => x.code === 'SCAN_UNREACHABLE' && x.serverId === id, S.settings.actor, 'Manual scan succeeded'); }
      }
    }
    SC.running = false; SC.idx = -1; SC.current = null; SC.results = { ids, list: found }; if (SC.days == null) SC.days = S.settings.windowDays; A.save(); A.ui(); A.renderView();
    A.toast(`Scan finished: ${found.length} certificate(s) on ${ids.length} server(s)` + (SC.errors.length ? `, ${SC.errors.length} unreachable` : ''), SC.errors.length ? 'warn' : 'ok');
  }
  A.scan = scan;
  const scanTable = () => {
    const r = SC.results; if (!r) return '';
    const list = r.list.filter(c => A.dleft(c) <= SC.days).sort((a, b) => a.notAfter - b.notAfter), enrollable = list.filter(c => !c.managed && !A.inel(c));
    return `<div class="card"><div class="row spread"><div><h3>${list.length} of ${r.list.length} certificate(s) expire within ${SC.days} days or are already expired</h3><div class="sub">Equivalent of <span class="mono">cdm scan-server &lt;server&gt; --expiring-within ${SC.days}</span></div></div>
      <div class="row"><button class="btn good" data-act="scan-enrol" ${enrollable.length ? '' : 'disabled'}>Enrol ${enrollable.length} eligible for auto-renewal</button><button class="btn" data-act="scan-csv">${icon('download')}Export CSV</button></div></div>
      <div style="max-width:420px;margin:6px 0 14px"><b>Show certificates expiring within <span id="lbl-scan">${SC.days}</span> days</b><input type="range" min="7" max="400" value="${SC.days}" data-scandays></div>
      <div class="tablewrap" style="border:0"><table><thead><tr><th>Status</th><th>Certificate</th><th>Server</th><th>Type</th><th>Issuer</th><th>Expires</th><th>Location</th><th>CDM</th></tr></thead><tbody>${list.map(c => `<tr class="clickable" data-act="cert" data-id="${c.id}"><td>${pill(A.status(c) === 'expired' ? 'Expired' : A.status(c) === 'expiring' ? 'Expiring' : 'Valid', A.status(c) === 'expired' ? 'red' : A.status(c) === 'expiring' ? 'amber' : 'green')}</td><td><div class="cn">${esc(c.cn)}</div></td><td>${esc(srv(c.serverId).name)}</td><td>${pill(c.type, c.type === 'DV' ? 'cyan' : c.type === 'OV' ? 'purple' : 'amber')}</td><td>${esc(c.ca)}</td><td class="nowrap">${A.fmtDate(c.notAfter)} (${Math.round(A.dleft(c))}d)</td><td class="mono">${esc(c.location)}</td><td>${c.managed ? pill('Managed', 'blue') : A.inel(c) ? `<span class="muted" style="font-size:.8rem">${esc(A.inel(c))}</span>` : pill('Eligible', 'green')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No certificates in this range.</td></tr>'}</tbody></table></div></div>`;
  };
  A.views.scan = {
    render() {
      return `<div class="card"><h3>Scan servers</h3><div class="sub">A read-only survey: log in, list every certificate (not just the ones CDM manages), and decide what to enrol. Nothing on the server changes.</div>
        <div class="scangrid" id="scan-grid">${S.servers.map(s => `<button class="srv ${SC.sel.has(s.id) ? 'on' : ''}" data-act="scan-pick" data-id="${s.id}"><b>${esc(s.name)}</b><small>${esc(s.host)} · ${s.os === 'windows' ? 'Windows' : 'Linux'} · ${esc(s.zone)}</small>${s.status === 'unreachable' ? '<br>' + pill('Unreachable', 'red') : ''}${s.paused ? '<br>' + pill('Paused', 'purple') : ''}</button>`).join('')}</div>
        <div class="row" style="margin-top:14px"><button class="btn primary" data-act="scan-go" ${SC.running || !SC.sel.size ? 'disabled' : ''}>${icon('radar')}Scan ${SC.sel.size || ''} selected</button><button class="btn" data-act="scan-all" ${SC.running ? 'disabled' : ''}>Scan all ${S.servers.length} servers</button><button class="btn" data-act="scan-clear" ${SC.sel.size ? '' : 'disabled'}>Clear selection</button></div>
        ${SC.running ? `<div style="margin-top:14px"><b>${esc(SC.current ? SC.current.name : '')}</b>${SC.steps.map((t, i) => `<div class="pstep ${i < SC.idx ? 'done' : i === SC.idx ? 'running' : ''}"><span class="ic">${i < SC.idx ? '✓' : i + 1}</span><span>${esc(t)}</span></div>`).join('')}</div>` : ''}
        ${SC.errors.length ? `<div class="banner" style="margin-top:14px"><div>${SC.errors.map(e => `<b>Unreachable</b> ${esc(e)}`).join('<br>')}<br><span class="muted">CDM continues with the other servers. Use Servers → Test connection to diagnose.</span></div></div>` : ''}</div>${scanTable()}`;
    },
  };
  A.live.add('scan');
  document.addEventListener('input', e => { if (e.target.dataset.scandays != null) { SC.days = +e.target.value; $('#lbl-scan').textContent = SC.days; } });
  document.addEventListener('change', e => { if (e.target.dataset.scandays != null && A.view() === 'scan') A.renderView(); });
  Object.assign(A.handlers, {
    'scan-pick': el => { const id = el.dataset.id; SC.sel.has(id) ? SC.sel.delete(id) : SC.sel.add(id); A.renderView(); },
    'scan-clear': () => { SC.sel.clear(); A.renderView(); },
    'scan-go': () => scan([...SC.sel]), 'scan-all': () => scan(S.servers.map(s => s.id)),
    'scan-from': el => { A.closeLayer(); SC.sel = new Set([el.dataset.id]); A.go('scan'); setTimeout(() => scan([el.dataset.id]), 100); },
    'scan-enrol': () => { const list = SC.results.list.filter(c => A.dleft(c) <= SC.days && !c.managed && !A.inel(c)); list.forEach(c => { c.managed = true; c.state = 'Managed'; c.ineligible = null; A.audit('enrol.enrolled', c.cn, { server: srv(c.serverId).name }); }); A.save(); A.toast(`${list.length} certificate(s) enrolled for auto-renewal`, 'ok'); A.renderView(); A.ui(); },
    'scan-csv': () => { const rows = [['common_name', 'server', 'type', 'not_after', 'days_left', 'location', 'managed']].concat(SC.results.list.filter(c => A.dleft(c) <= SC.days).map(c => [c.cn, srv(c.serverId).name, c.type, A.fmtDate(c.notAfter), Math.round(A.dleft(c)), c.location, c.managed]));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n')], { type: 'text/csv' })); a.download = 'cdm-scan.csv'; document.body.appendChild(a); a.click(); a.remove(); },
  });

  // ------------------------------------------------------------------ servers
  A.views.servers = {
    render() {
      return `<div class="card"><h3>Servers & connectivity</h3><div class="sub">Linux over SSH, Windows over WinRM/HTTPS. One unreachable or paused server never stops the rest of the fleet.</div></div>
        <div class="card ap-card"><div class="tablewrap flat"><table><thead><tr><th>Server</th><th>Platform</th><th>Zone</th><th>Transport</th><th>Deploy adapter</th><th>Certificates</th><th>Status</th><th class="right">Actions</th></tr></thead><tbody>${S.servers.map(s => { const cs = A.certs().filter(c => c.serverId === s.id), due = cs.filter(c => c.managed && isDue(c)).length;
          return `<tr><td><div class="cn">${esc(s.name)}</div><div class="sub">${esc(s.host)} · ${esc(s.env)}</div></td><td>${s.os === 'windows' ? 'Windows' : 'Linux'}<div class="sub">${esc(s.tech.replace('_', ' '))}</div></td><td>${esc(s.zone)}</td><td>${s.transport.toUpperCase()} :${s.port}</td>
          <td>${s.os === 'windows' ? '<span class="muted">not needed (PowerShell inline)</span>' : s.adapter === 'installed' ? pill('Installed', 'green') : pill('Auto-installs on first deploy', 'amber')}</td><td>${cs.length}${due ? ` · <b style="color:var(--amber)">${due} due</b>` : ''}</td>
          <td>${s.paused ? pill('Paused', 'purple') : s.status === 'unreachable' ? pill('Unreachable', 'red') + `<div class="sub" style="color:var(--red)">${esc(s.error)}</div>` : pill('Online', 'green')}</td>
          <td class="nowrap right"><button class="btn sm" data-act="srv-test" data-id="${s.id}">Test connection</button> <button class="btn sm" data-act="scan-from" data-id="${s.id}">Scan</button> <button class="btn sm" data-act="srv-pause" data-id="${s.id}">${s.paused ? 'Resume' : 'Pause'}</button>${s.os === 'linux' && s.adapter !== 'installed' ? ` <button class="btn sm good" data-act="srv-adapter" data-id="${s.id}">Install adapter</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div><div class="ap-foot muted">${S.servers.length} servers</div></div>`;
    },
  };
  A.live.add('servers');
  Object.assign(A.handlers, {
    'srv-test': async el => {
      const s = srv(el.dataset.id), bad = s.status === 'unreachable' && !(s.tries >= 1);
      const ok = await A.progress({ title: 'Testing ' + s.name, steps: ['Resolve ' + s.host, `Connect to ${s.host}:${s.port}`, s.os === 'windows' ? 'Authenticate (NTLM over HTTPS)' : 'Authenticate (SSH key)', 'Run a read-only probe'], failAt: bad ? 1 : -1, failMsg: s.error + '. Check the firewall or security group, then retry.', stepMs: 520 });
      if (bad) s.tries = (s.tries || 0) + 1; else if (s.status === 'unreachable') { s.status = 'online'; s.error = null; A.audit('connectivity.restored', s.name, {}); A.resolveErrors(x => x.code === 'SCAN_UNREACHABLE' && x.serverId === s.id, S.settings.actor, 'Connection test passed'); }
      if (ok) A.toast(s.name + ' is reachable', 'ok'); A.renderView(); A.ui();
    },
    'srv-pause': el => { const s = srv(el.dataset.id); s.paused = !s.paused; A.audit(s.paused ? 'server.paused' : 'server.resumed', s.name, {}); A.toast(s.name + (s.paused ? ' excluded from runs' : ' back in rotation'), s.paused ? 'warn' : 'ok'); A.renderView(); },
    'srv-adapter': async el => { const s = srv(el.dataset.id); const ok = await A.progress({ title: 'Installing the deploy adapter on ' + s.name, steps: ['Compare SHA-256 of /usr/local/sbin/cdm_linux_adapter.sh', 'Copy the reviewed script over SSH (sudo -n tee)', 'chown root:root, chmod 0750', 'Create /var/backups/cdm (0700)'], stepMs: 520 }); if (ok) { s.adapter = 'installed'; A.audit('deploy.adapter_installed', s.name, {}); A.renderView(); } },
  });

  // ------------------------------------------------------------------ self-test (?selftest)
  async function selftest() {
    const out = [], t = (n, ok, x) => out.push({ n, ok: !!ok, x });
    try {
      A.reset(); S.settings.speed = 'instant';
      t('by default no CA is selected: the user chooses them', !S.setup.selRoots.length && !S.setup.selIssuers.length && S.certs.every(c => !A.caVerdict(c).ok), [S.setup.selRoots, S.setup.selIssuers]);
      t('with no CA selected yet the whole estate is listed', !A.scopeOn() && A.certs().length === S.certs.length && A.stats().total === S.certs.length);
      { const sh0 = A.views.setup.render(); t('setup opens with one empty row and Next disabled', (sh0.match(/data-f="rootId"/g) || []).length === 1 && A.W.draft.rows[0].rootId === '' && /data-act="wz-next" disabled/.test(sh0)); A.W.reset(); }
      t('before automation starts the header offers Set up automation, not Emergency stop', /data-act="nav" data-v="setup"/.test($('#top').innerHTML) && !/data-act="killswitch"/.test($('#top').innerHTML));
      t('a run is refused while no CA is selected', (await runPipeline()) === undefined && !A.RUN);
      { const d0 = A.setupDraft(); d0.selRoots = ['R-ISRG', 'R-LESTG', 'R-DIGI', 'R-ENTR']; d0.selIssuers = ['I-LER11', 'I-LESTG', 'I-DIGI', 'I-ENTR']; A.setupCommit(d0); }   // Northwind and Fabrikam left out, to exercise the scope
      const before = A.stats(), offCa = c => /^(Northwind|Fabrikam)/.test(c.ca), off = S.certs.filter(offCa);
      t('only certificates of the selected CAs are listed', A.scopeOn() && off.length >= 4 && A.certs().length === S.certs.length - off.length && A.certs().every(c => A.caVerdict(c).ok) && before.total === A.certs().length, [S.certs.length, A.certs().length, off.length]);
      { A.F.q = ''; const ch = A.views.certificates.render() + A.views.servers.render() + A.views.journey.render(); t('views do not mention certificates of CAs that are not selected', off.every(c => !ch.includes(c.cn)) && !/not selected in the automation setup|Blocked by the CA check/.test(ch)); }
      const readyBefore = A.readyToRenew().length;
      { const rdy = A.readyToRenew(), demo = A.demoCerts(), ov = A.views.overview.render(); t('the overview lists demo certificates that are ready to renew, across platforms', rdy.length >= 6 && demo.length === 6 && demo.every(c => rdy.includes(c) && ov.includes(c.cn)) && new Set(demo.map(c => srv(c.serverId).tech)).size >= 3 && (ov.match(/data-act="renew"/g) || []).length === 6 && /data-act="auto-run"/.test(ov), [rdy.length, demo.length]); }
      t('Run automation now asks for the automation setup first', (A.handlers['auto-run'](), !A.RUN && !S.setup.done));
      const chain0 = A.verifyChain(); t('seed chain verifies', chain0.ok, chain0);
      S.settings.failNext = true; let R = await runPipeline();
      t('run completes', R.status === 'done', R.status); t('jobs created', R.jobs.length > 5, R.jobs.length);
      t('canary failure rolled back', R.jobs.some(j => j.state === 'Rolled back'), R.jobs.map(j => j.state).join());
      t('zone halted (skipped jobs)', R.jobs.some(j => j.state === 'Skipped'));
      t('other zones confirmed', R.jobs.some(j => j.state === 'Confirmed'));
      t('adapter auto-installed on lnx01', srv('lnx01').adapter === 'installed' || !R.jobs.some(j => j.serverId === 'lnx01'));
      t('compliance improved', A.stats().expiring + A.stats().expired < before.expiring + before.expired, [before.expiring + before.expired, A.stats().expiring + A.stats().expired]);
      t('an automation run renews the ready certificates', R.jobs.filter(j => j.state === 'Confirmed').length > 5 && R.jobs.filter(j => j.state === 'Confirmed').every(j => !isDue(certById(j.certId))) && A.readyToRenew().length < readyBefore, [readyBefore, A.readyToRenew().length]);
      t('chain still verifies after run', A.verifyChain().ok);
      // scope: certificates of CAs that are not selected are left out of the run without any error
      const caErr = () => S.errors.filter(e => e.stage === 'CA check' || e.severity === 'blocked' || /not selected in the automation setup/.test(e.message || ''));
      t('certificates of CAs that are not selected raise no error', caErr().length === 0 && !S.audit.some(e => e.type === 'ca.blocked') && off.every(c => !c.lastError), caErr().map(e => e.code));
      t('they are not renewed and have no journey', off.every(c => !R.jobs.some(x => x.certId === c.id) && c.history.length === 0 && !S.journeys[c.id]));
      t('the verdict still tells a CA that is not selected from one that is unknown', A.caVerdict(off[0]).code === 'CA_NOT_SELECTED' && A.caVerdict({ ca: 'Some Unknown CA' }).code === 'CA_NOT_CONFIGURED');
      t('no certificate of a selected CA waits for approval or is blocked', !R.jobs.length || S.certs.filter(c => c.managed && isDue(c) && !c.paused && A.caVerdict(c).ok && srv(c.serverId).status !== 'unreachable' && !srv(c.serverId).paused && !c.review).every(c => S.journeys[c.id] && S.journeys[c.id].steps.find(x => x.key === 'ca').status === 'done' && !S.journeys[c.id].steps.some(x => x.status === 'blocked')));
      const KEYS = ['scan', 'window', 'ca', 'order', 'match', 'plan', 'precheck', 'backup', 'install', 'activate', 'verify', 'confirm', 'retire'], STAGE_KEYS = ['discover', 'landing', 'match', 'plan', 'deploy', 'confirm', 'retire'];
      const okJob = R.jobs.find(x => x.state === 'Confirmed'), okSteps = S.journeys[okJob.certId].steps;
      t('journey of a renewed certificate records the work of every stage, in order', okSteps.map(x => x.key).join() === KEYS.join() && okSteps.every(x => x.status === 'done' && x.lines.length), okSteps.map(x => x.key + ':' + x.status).join());
      t('canary failure recorded with its rollback outcome', S.errors.some(e => e.code === 'ACTIVATE_FAILED' && e.status === 'open' && e.runId === R.id && /Rolled back/.test(e.outcome) && e.jobId));
      const unreach = S.errors.filter(e => e.code === 'SCAN_UNREACHABLE' && e.serverId === 'edge-lb-01');
      t('repeated problem raises the count instead of adding a row', unreach.length === 1 && unreach[0].count === 8, unreach.map(e => e.count));
      const byCa = n => off.find(c => c.ca.startsWith(n) && c.managed && isDue(c)).id, nw = byCa('Northwind'), fb = byCa('Fabrikam');
      let sd = A.setupDraft(); sd.selRoots.push('R-NWIND'); sd.selIssuers.push('I-NWIND'); A.setupCommit(sd);
      t('selecting an issuing CA and its root brings its certificates into view', A.caVerdict(certById(nw)).ok && A.certs().includes(certById(nw)) && !A.certs().includes(certById(fb)));
      let one = await runPipeline({ only: [nw] }); t('a certificate renews once its issuing CA is selected', one.jobs.length === 1 && one.jobs[0].state === 'Confirmed', one.jobs.map(x => x.state));
      sd = A.setupDraft(); sd.selRoots = sd.selRoots.filter(x => x !== 'R-ISRG');
      t('an issuing CA is blocked when its root CA is not selected', A.caVerdict(S.certs.find(c => c.ca === "Let's Encrypt R11"), sd).code === 'CA_ROOT_NOT_SELECTED');
      sd = A.setupDraft(); sd.selRoots.push('R-FAB'); sd.selIssuers.push('I-FAB'); A.setupCommit(sd); one = await runPipeline({ only: [fb] });
      t('every issuer found on the servers can be selected and is then renewed', one.jobs.length === 1 && one.jobs[0].state === 'Confirmed' && S.journeys[fb].steps.find(x => x.key === 'ca').status === 'done');
      // a failure at any step is identified and recorded
      const pool = S.certs.filter(c => { const s = srv(c.serverId); return c.managed && c.type === 'DV' && !c.paused && !s.paused && s.status !== 'unreachable' && A.caVerdict(c).ok && c.state === 'Managed' && !isDue(c); });
      const CASES = [['scan', 'SCAN_UNREACHABLE', 'Discover'], ['order', 'ACME_VALIDATION_FAILED', 'Landing'], ['match', 'MATCH_SAN_MISMATCH', 'Match'], ['precheck', 'DRIFT_DETECTED', 'Deploy'], ['backup', 'BACKUP_FAILED', 'Deploy'],
        ['install', 'INSTALL_FAILED', 'Deploy'], ['activate', 'ACTIVATE_FAILED', 'Deploy'], ['verify', 'VERIFY_MISMATCH', 'Deploy'], ['confirm', 'CONFIRM_MISMATCH', 'Confirm']];
      for (let i = 0; i < CASES.length; i++) {
        const [at, code, stage] = CASES[i], c = pool[i]; c.notAfter = Date.now() + 3 * DAY; const old = c.thumbprint;
        const r = await runPipeline({ only: [c.id], inject: { certId: c.id, at } }), e = S.errors.find(x => x.certId === c.id && x.code === code), st = S.journeys[c.id].steps;
        const bad = st.find(x => x.status === 'failed'), rolled = st.some(x => x.key === 'rollback' && x.status === 'done'), touched = ['install', 'activate', 'verify'].includes(at);
        t('failure at ' + at + ' is recorded as ' + code, e && e.status === 'open' && e.stage === stage && e.step === at && e.runId === r.id && r.problems > 0, e || S.errors.filter(x => x.certId === c.id));
        t('failure at ' + at + ' shows on the journey and leaves the server safe', bad && bad.key === at && bad.code === code && rolled === touched && (at === 'confirm' ? r.jobs[0].state === 'Not confirmed' : c.thumbprint === old), [bad && bad.key, rolled, c.thumbprint === old]);
      }
      // step-by-step mode waits before every step
      const sc = pool[CASES.length]; sc.notAfter = Date.now() + 3 * DAY; const waited = [], sp = runPipeline({ only: [sc.id], step: true });
      while (A.RUN.status === 'running') { if (A.RUN.waiting) { waited.push(A.RUN.waiting); A.RUN.waiting = null; } await new Promise(r => setTimeout(r, 30)); }
      one = await sp; t('step-by-step mode waits once before each of the seven stages', waited.join() === STAGE_KEYS.join() && one.jobs[0].state === 'Confirmed', waited.join());
      const tg = S.errors.find(e => e.status === 'open'); A.handlers['err-toggle']({ dataset: { id: tg.id } }); const wasResolved = tg.status === 'resolved' && tg.resolvedBy === S.settings.actor;
      A.handlers['err-toggle']({ dataset: { id: tg.id } }); t('an error can be resolved and reopened', wasResolved && tg.status === 'open');
      t('chain verifies with error events', A.verifyChain().ok);
      const j = S.jobs.find(x => A.canRollback(x)); t('rollback candidate exists', !!j);
      if (j) { const c = certById(j.certId); A.applyRollback(j); t('rollback restores old thumbprint', c.thumbprint === j.oldThumb && j.state === 'Rolled back (manual)'); t('rolled-back job not re-rollbackable', !A.canRollback(j)); }
      A.tamper(); t('tamper detected', !A.verifyChain().ok, A.verifyChain()); A.untamper(); t('untamper restores chain', A.verifyChain().ok);
      S.settings.caOutage = true; S.settings.speed = 'instant'; const co = await runPipeline(); t('CA outage reports problems', co.problems > 0 || co.jobs.length === 0, co.problems); S.settings.caOutage = false;
      const lab = srv('win01'); await scan([lab.id]); t('scan returns windows certificates', SC.results && SC.results.list.length === A.certs().filter(c => c.serverId === 'win01').length);
      S.killSwitch = true; const ks = await runPipeline(); t('emergency stop blocks runs', ks === undefined); S.killSwitch = false;
      S.settings.speed = 'fast'; S.certs.filter(c => c.managed && c.type === 'DV' && !c.paused).slice(0, 12).forEach(c => { c.notAfter = Date.now() + 3 * DAY; });
      const p = runPipeline(); await new Promise(r => setTimeout(r, 1500)); A.handlers['run-stop'] && (A.RUN.stop = true, A.RUN.status = 'stopping'); R = await p;
      t('graceful stop', R.status === 'stopped' && !R.jobs.some(x => x.state === 'Running'), R.status + ' ' + R.jobs.map(x => x.state).join());
      A.J.sel = nw; const html = A.views.journey.render(), sel = certById(nw);
      t('journey dropdowns show the selected certificate in full', html.includes('id="jdd-sel-btn"') && html.split('id="jdd-sel-btn"')[1].split('</button>')[0].includes(sel.cn), sel.cn);
      t('both journey dropdowns are the same component, none is a native select, and there is no option to make a stage fail', (html.match(/class="jdd-btn"/g) || []).length === 2 && !/<select/.test(html) && !/Make a stage fail|jdd-inject/.test(html));
      t('a renewed certificate stays on screen with its journey but cannot be started again', !isDue(sel) && /data-act="journey-start" disabled/.test(html) && /it was renewed/.test(html) && !html.includes(`data-dd="sel" data-v="${nw}"`));
      const dc = S.certs.find(c => c.managed && c.type === 'DV' && !c.paused && c.state === 'Managed' && !isDue(c) && A.caVerdict(c).ok && srv(c.serverId).status !== 'unreachable' && !srv(c.serverId).paused); dc.notAfter = Date.now() + 3 * DAY;
      A.J.sel = dc.id; const html2 = A.views.journey.render(), offered = (html2.match(/data-dd="sel" data-v="[^"]+"/g) || []).map(x => x.split('data-v="')[1].replace('"', ''));
      t('each journey dropdown marks one selected option', (html2.match(/aria-selected="true"/g) || []).length === 2 && offered.includes(dc.id) && /data-act="journey-start" >/.test(html2));
      t('the journey list offers only certificates inside the renewal window', offered.length > 0 && offered.every(id => { const c = certById(id); return c.managed && isDue(c) && A.caVerdict(c).ok; }) && !offered.includes(nw) && !/Followed earlier/.test(html2), offered.length);
      { const w0 = S.settings.windowDays, far = S.certs.find(c => c.managed && !c.paused && c.state === 'Managed' && A.caVerdict(c).ok && A.dleft(c) > 40 && A.dleft(c) < 300 && srv(c.serverId).status !== 'unreachable' && !srv(c.serverId).paused);
        const inList = () => A.views.journey.render().includes(`data-dd="sel" data-v="${far.id}"`), out30 = !inList(); S.settings.windowDays = Math.ceil(A.dleft(far)) + 1; const inWide = inList(); S.settings.windowDays = w0;
        t('the list follows the renewal window setting', out30 && inWide, Math.round(A.dleft(far))); }
      t('the journey shows the seven pipeline stages with the work done inside each', (html.match(/<li class="jstep /g) || []).length === 7 && ['cdm discover', 'cdm landing', 'cdm match', 'cdm plan', 'cdm deploy', 'cdm confirm', 'cdm retire-replaced'].every(x => html.includes('>' + x + '<')) && ['Scan the server', 'Check the renewal window', 'Check the selected CAs', 'Precheck', 'Backup', 'Install', 'Activate', 'Verify'].every(x => html.includes('<b>' + x + '</b>')) && (html.match(/<li class="jstep done"/g) || []).length === 7 && /7\/7/.test(html));
      // automation setup page
      A.W.reset(); let sh = A.views.setup.render();
      t('setup starts at step 1 with one Root CA + Issuing CA row per selected issuing CA', /Start Setup/.test(sh) && /class="wz-steps"/.test(sh) && (sh.match(/data-f="rootId"/g) || []).length === S.setup.selIssuers.length && /Add another CA/.test(sh) && !S.setup.done && A.W.step === 1);
      const r0 = A.W.draft.rows[0].issuerId; A.W.setRow(0, 'rootId', 'R-ENTR'); sh = A.views.setup.render();
      t('changing the Root CA of a row clears its Issuing CA and blocks Next', A.W.draft.rows[0].issuerId === '' && !A.W.draft.selIssuers.includes(r0) && /data-act="wz-next" disabled/.test(sh) && /in every row to continue/.test(sh));
      const sel0 = sh.split('data-row="0" data-f="issuerId"')[1].split('</select>')[0];
      t('a row offers the other Issuing CAs of its Root CA, not the one another row uses', !sel0.includes('value="I-ENTR"') && sel0.includes('value="I-ENL1K"'), sel0.slice(0, 200));
      A.W.setRow(0, 'issuerId', 'I-ENL1K');
      t('one Root CA can have several Issuing CAs, each in its own row', A.W.draft.selRoots.filter(x => x === 'R-ENTR').length === 1 && ['I-ENTR', 'I-ENL1K'].every(x => A.W.draft.selIssuers.includes(x)) && A.W.draft.rows.filter(r => r.rootId === 'R-ENTR').length === 2);
      A.handlers['row-add'](); sh = A.views.setup.render(); const newRoot = sh.split(`data-row="${A.W.draft.rows.length - 1}" data-f="rootId"`)[1].split('</select>')[0];
      t('a Root CA is greyed out once all its Issuing CAs are added', /value="R-ENTR"\s+disabled/.test(newRoot) && !/value="R-NWIND"\s+disabled/.test(newRoot), newRoot.slice(0, 300));
      A.handlers['row-del']({ dataset: { i: String(A.W.draft.rows.length - 1) } });
      A.W.setRow(0, 'rootId', 'R-NWIND'); A.W.setRow(0, 'issuerId', 'I-NWIND'); const nRows = A.W.draft.rows.length; A.handlers['row-add'](); A.handlers['wz-next']();
      t('Add another CA adds a row that must be completed before Next', A.W.draft.rows.length === nRows + 1 && A.W.step === 1 && !!A.W.err);
      A.handlers['row-del']({ dataset: { i: String(nRows) } }); sh = A.views.setup.render(); t('Remove deletes the row and Next is enabled again', A.W.draft.rows.length === nRows && !/data-act="wz-next" disabled/.test(sh) && A.W.draft.selIssuers.includes('I-NWIND'));
      A.W.setRow(0, 'rootId', 'R-ENTR'); A.W.setRow(0, 'issuerId', 'I-ENL1K'); sh = A.views.setup.render(); const pending = /Not applied yet/.test(sh) && !S.setup.selIssuers.includes('I-ENL1K'); A.handlers['wz-next']();
      t('a changed selection is flagged as not applied, and Next on step 1 applies it', pending && A.W.step === 2 && S.setup.selIssuers.includes('I-ENL1K') && !S.setup.done);
      A.W.reset(); A.handlers['wz-next'](); sh = A.views.setup.render(); t('step 2 reviews the selected CAs and previews what automation will do', A.W.step === 2 && /When automation starts/.test(sh) && /Nothing has run yet/.test(sh) && (sh.match(/class="rv-root"/g) || []).length === S.setup.selRoots.length && (sh.match(/class="rv-name"/g) || []).length === S.setup.selIssuers.length && /Renew automatically/.test(sh) && !/renewed automatically/.test(sh));
      A.handlers['wz-next'](); sh = A.views.setup.render(); t('step 3 asks for the schedule', A.W.step === 3 && /data-wz="freq"/.test(sh) && /Start automation/.test(sh));
      Object.assign(A.W.draft.schedule, { freq: 'weekly', dow: 3, hour: 4 }); A.W.draft.firstRun = 'later'; A.handlers['wz-start'](); sh = A.views.setup.render();
      t('completing setup shows that automation is running with the seven-stage flow', S.setup.done && /Automation is running/.test(sh) && ['Discover', 'Landing', 'Match', 'Plan', 'Deploy', 'Confirm', 'Retire'].every(n => sh.includes('<b>' + n + '</b>')) && !sh.includes('<b>CA check</b>'));
      t('after setup the configuration lists each Root CA with its Issuing CAs, and the schedule its next run', (sh.match(/class="cf-row"/g) || []).length === S.setup.selRoots.length && S.setup.issuers.filter(i => S.setup.selIssuers.includes(i.id)).every(i => sh.includes('<i>' + A.esc(i.name) + '</i>')) && /Next run/.test(sh) && /Last run/.test(sh) && /class="pill green">Active/.test(sh));
      t('the step indicator is shown only during the start setup, not after it', !/wz-steps/.test(sh) && /Automation is running/.test(sh));
      t('once automation is started the header shows Emergency stop', /data-act="killswitch"/.test($('#top').innerHTML) && /Emergency stop/.test($('#top').innerHTML) && !/Set up automation/.test($('#top').innerHTML));
      const nx = A.scheduleNext(); t('a weekly schedule gives the next run on the chosen day and hour', S.schedule.freq === 'weekly' && nx.getUTCDay() === 3 && nx.getUTCHours() === 4 && nx > new Date(), String(nx));
      A.handlers['setup-edit']({ dataset: { k: 'schedule' } }); A.views.setup.render(); A.W.draft.schedule.freq = 'monthly'; A.W.draft.schedule.dom = 15; A.handlers['setup-save']();
      t('the schedule can be updated after setup', S.schedule.freq === 'monthly' && A.scheduleNext().getUTCDate() === 15 && A.W.edit === null);
      A.handlers['setup-edit']({ dataset: { k: 'config' } }); sh = A.views.setup.render(); A.handlers['row-del']({ dataset: { i: String(A.W.draft.rows.findIndex(r => r.issuerId === 'I-NWIND')) } }); A.handlers['setup-save']();
      t('the CA selection can be updated after setup', /Update configuration settings/.test(sh) && !S.setup.selIssuers.includes('I-NWIND') && A.W.edit === null);
      { const r0 = A.readyToRenew().length, nR = A.restorable().length, one0 = A.restorable()[0], jobs0 = S.jobs.length, done0 = S.setup.done, n = A.restoreDue();
        t('renewed test certificates can be made due again without resetting anything else', nR > 0 && n === nR && A.restorable().length === 0 && isDue(one0) && A.readyToRenew().length > r0 && S.jobs.length === jobs0 && S.setup.done === done0 && one0.history.length > 0 && A.verifyChain().ok, [nR, r0, A.readyToRenew().length]);
        const again = await runPipeline({ only: [one0.id] }); t('a certificate made due again renews again', again.jobs.length === 1 && again.jobs[0].state === 'Confirmed' && !isDue(one0), again.jobs.map(x => x.state)); }
      // emergency stop: stop, then resume or terminate
      const keep = [...S.setup.selIssuers]; A.emergencyStop(); sh = A.views.setup.render(); let bn = $('#banners').innerHTML;
      t('emergency stop shows automation as stopped, with Resume and Terminate', S.killSwitch && /Automation is stopped/.test(sh) && ['automation-resume', 'automation-terminate'].every(a => sh.includes(`data-act="${a}"`)) && /Emergency stop is active/.test(bn) && !/<button/.test(bn) && (await runPipeline()) === undefined);
      A.resumeAutomation(); sh = A.views.setup.render();
      t('Resume continues with the same settings', !S.killSwitch && S.setup.done && S.setup.selIssuers.join() === keep.join() && !/Automation is stopped/.test(sh) && $('#banners').innerHTML === '');
      const nAudit = S.audit.length, nJobs = S.jobs.length; A.emergencyStop(); A.terminateAutomation(); sh = A.views.setup.render();
      t('Terminate returns to the starting setup with nothing selected', !S.setup.done && !S.killSwitch && !S.setup.selRoots.length && !S.setup.selIssuers.length && /Start Setup/.test(sh) && (sh.match(/data-f="rootId"/g) || []).length === 1 && A.W.step === 1 && $('#banners').innerHTML === '');
      t('Terminate keeps history and is audited', S.jobs.length === nJobs && S.audit.length === nAudit + 2 && S.audit[S.audit.length - 1].type === 'automation.terminated' && A.verifyChain().ok);
      t('there is no Renewal pipeline page: renewals are started from Certificate journey', !A.views.pipeline && !A.handlers['run-now'] && !A.handlers['run-pause'] && !/Renewal pipeline/.test($('#nav').innerHTML) && !/run-now/.test(A.views.overview.render()));
      const views = Object.keys(A.views); views.forEach(v => { const h = A.views[v].render(); t('view renders: ' + v, typeof h === 'string' && h.length > 50); });
    } catch (err) { t('exception', false, String(err && err.stack || err)); }
    const pre = document.createElement('pre'); pre.id = 'selftest-out'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
    document.title = 'SELFTEST ' + (out.every(o => o.ok) ? 'PASS ' : 'FAIL ') + out.filter(o => o.ok).length + '/' + out.length;
  }
  if (/[?&]selftest/.test(location.search)) window.addEventListener('load', () => setTimeout(selftest, 100));
})();
