/* CDM prototype - engine: the renewal pipeline simulation, scan flow, servers view and self-test. */
(function () {
  'use strict';
  const A = window.CDM_APP, D = A.D, S = A.S, DAY = D.DAY, $ = A.$, esc = A.esc, icon = A.icon, pill = A.pill;
  const srv = A.srv, certById = A.certById, isDue = A.isDue, sleep = A.sleep, uid = A.uid;
  const STAGES = [['Discover', 'scan & enrol'], ['Landing', 'obtain certificates'], ['Match', 'identity checks'], ['Plan', 'renewal window'], ['Deploy', 'backup · install'], ['Confirm', 're-login & verify']];
  const STEPS = ['precheck', 'backup', 'install', 'activate', 'verify'];
  const FAIL_TEXT = { linux_apache: 'apachectl configtest failed after install: SSLCertificateKeyFile does not match the certificate', linux_nginx: 'nginx -t failed: SSL_CTX_use_PrivateKey_file: key values mismatch',
    windows_iis: 'Set-WebBinding failed: access denied to the private key', windows_store: 'Restart-Service failed: the service did not start with the new certificate', java_keystore: 'keytool -importkeystore failed: alias exists with a different key' };

  // ------------------------------------------------------------------ pipeline
  const log = (msg, cls = '') => { const R = A.RUN; R.log.push({ t: Date.now(), msg, cls }); if (R.log.length > 700) R.log.shift(); A.ui(); };
  const checkpoint = async () => { const R = A.RUN; while (R.status === 'paused') await new Promise(r => setTimeout(r, 120)); return R.stop; };
  const setStage = (i, st) => { A.RUN.st[i] = st; A.ui(); };
  const active = () => !!A.RUN && ['running', 'paused', 'stopping'].includes(A.RUN.status);
  const candidates = () => S.certs.filter(c => { const s = srv(c.serverId); return c.managed && isDue(c) && !c.paused && !s.paused && s.status !== 'unreachable' && (!A.RUN.only || A.RUN.only.includes(c.id)); });

  async function stageDiscover() {
    const R = A.RUN; setStage(0, 'active'); log('Stage 1: discover. Logging into servers (read-only)…', 'st');
    const servers = S.servers.filter(s => !R.only || R.only.some(id => certById(id).serverId === s.id)); let bindings = 0;
    for (const s of servers) {
      if (await checkpoint()) return;
      if (s.paused) { log(`  ${s.name}: paused by operator, skipped`, 'warn'); continue; }
      if (s.status === 'unreachable') { log(`  ${s.name}: UNREACHABLE/FAILED - ${s.error}`, 'err'); R.problems++; A.audit('discovery.failed', s.name, { error: s.error }, R.actor); continue; }
      log(`  scanning ${s.name} (${s.host}) over ${s.transport.toUpperCase()}…`); await sleep(260);
      const list = S.certs.filter(c => c.serverId === s.id); let enrolled = 0, notDue = 0, notEl = 0;
      const already = list.filter(c => c.managed).length; bindings += already;
      if (S.settings.autoEnrol && !R.only) {
        for (const c of list.filter(c => !c.managed)) {
          if (!isDue(c)) { notDue++; continue; }
          if (A.inel(c)) { notEl++; log(`  not enrolled ${c.cn}: ${c.ineligible}`, 'warn'); continue; }
          if (enrolled >= S.settings.maxPerRun) { log(`  deferred ${c.cn}: max_per_run (${S.settings.maxPerRun}) reached`, 'warn'); continue; }
          c.managed = true; c.state = 'Managed'; c.ineligible = null; enrolled++; log(`  enrolled ${s.name}:${c.cn}  (${Math.round(A.dleft(c))}d left)`, 'ok'); A.audit('enrol.enrolled', c.cn, { server: s.name }, R.actor);
        }
        log(`  ${list.length} certificate(s) found: ${enrolled} enrolled, ${already} already managed, ${notDue} not due, ${notEl} not eligible`);
      }
      list.forEach(c => { c.lastScanned = Date.now(); }); A.dbWrite('certificates_seen', list.length); A.audit('discovery.scanned', s.name, { certificates: list.length, enrolled }, R.actor);
    }
    log(`  ${bindings} managed binding(s) read; ${candidates().length} due for renewal`, 'ok'); setStage(0, 'done');
  }

  async function stageLanding() {
    const R = A.RUN; setStage(1, 'active'); R.landed = new Map(); const list = candidates();
    log(`Stage 2: landing. Obtaining replacements for ${list.length} due certificate(s) (${S.settings.acmeEnv} CA)…`, 'st'); let review = 0;
    for (const c of list) {
      if (await checkpoint()) return;
      const s = srv(c.serverId);
      if (c.state === 'Review' || (c.type !== 'DV' && S.settings.approveOvEv && !c.approved)) {
        if (c.state !== 'Review') { c.state = 'Review'; c.review = 'approval'; A.audit('review.queued', c.cn, { reason: 'OV/EV approval policy' }, R.actor); }
        log(`  REVIEW ${c.cn}: waiting for approval (${c.type})`, 'warn'); review++; continue;
      }
      if (c.type === 'DV') {
        log(`  acme: ordering ${c.cn}`); await sleep(230);
        if (R.caOutage) { c.state = 'Failed'; c.lastError = 'urn:ietf:params:acme:error:serverInternal :: the CA is unreachable'; R.problems++; log(`  acme: could not obtain '${c.cn}' - ${c.lastError}`, 'err'); A.audit('acme.issue_failed', c.cn, { error: c.lastError }, R.actor); continue; }
        log(`    HTTP-01 proof placed on ${s.host}:80, validated by the CA, certificate issued`, 'ok'); A.audit('acme.issued', c.cn, { ca: c.ca }, R.actor); A.dbWrite('acme_issuance');
      } else { log(`  folder: replacement ${c.cn}.crt + .key found in input_certificates/ (approved)`, 'ok'); await sleep(120); }
      R.landed.set(c.id, { newThumb: (D.sha256(c.cn + Date.now() + uid(6)) + D.sha256(uid(8))).slice(0, 64), via: c.type === 'DV' ? 'acme' : 'folder' });
    }
    log(`  ${R.landed.size} certificate(s) available${review ? `, ${review} waiting for approval` : ''}`, 'ok'); setStage(1, 'done');
  }

  async function stageMatch() {
    const R = A.RUN; setStage(2, 'active'); await sleep(200);
    log(`Stage 3: match. ${R.landed.size} match(es). Same identity, different thumbprint, later expiry, no type downgrade`, 'st');
    let n = 0; for (const [id, l] of R.landed) { const c = certById(id); if (n++ < 8) log(`  ${c.cn}: ${c.type} -> ${c.type} (${l.via})`); }
    if (R.landed.size > 8) log(`  … and ${R.landed.size - 8} more`); await sleep(150); setStage(2, 'done');
  }

  function newJob(c, landed) {
    const s = srv(c.serverId);
    return { id: 'JOB-' + uid(10).toUpperCase(), certId: c.id, cn: c.cn, serverId: s.id, zone: s.zone, tech: s.tech, state: 'Planned', steps: { precheck: 'pending', backup: 'pending', install: 'pending', activate: 'pending', verify: 'pending' },
      oldThumb: c.thumbprint, newThumb: landed.newThumb, oldNotAfter: c.notAfter, oldNotBefore: c.notBefore, startedAt: null, endedAt: null, error: null, canary: false, backupId: null, run: A.RUN.id };
  }
  async function stagePlan() {
    const R = A.RUN; setStage(3, 'active'); await sleep(200);
    R.jobs = [...R.landed].map(([id, l]) => newJob(certById(id), l)).sort((a, b) => a.zone.localeCompare(b.zone) || a.cn.localeCompare(b.cn));
    const seen = new Set(); R.jobs.forEach(j => { if (S.settings.canary && !seen.has(j.zone)) { seen.add(j.zone); j.canary = true; } });
    if (R.failNext && R.jobs.length) {
      const size = {}; R.jobs.forEach(x => { size[x.zone] = (size[x.zone] || 0) + 1; });
      const busiest = Object.keys(size).sort((a, b) => size[b] - size[a])[0];
      (R.jobs.find(x => x.zone === busiest && x.canary) || R.jobs.find(x => x.zone === busiest)).willFail = true; S.settings.failNext = false; A.save();
    }
    log(`Stage 4: plan. ${R.jobs.length} job(s) in ${new Set(R.jobs.map(j => j.zone)).size} zone(s)${S.settings.canary ? ', canary first' : ''}`, 'st');
    R.jobs.slice(0, 10).forEach(j => log(`  ${j.id}  ${j.cn} (${j.tech}, zone ${j.zone})${j.canary ? '  [canary]' : ''}`)); if (R.jobs.length > 10) log(`  … and ${R.jobs.length - 10} more`);
    setStage(3, 'done');
  }

  async function runJob(job) {
    const R = A.RUN, c = certById(job.certId), s = srv(job.serverId);
    job.state = 'Running'; job.startedAt = Date.now(); c.state = 'Renewing'; log(`  ${job.id} ${job.cn}: starting${job.canary ? ' (canary)' : ''}`); A.audit('deploy.started', job.id, { target: job.cn, host: s.host }, R.actor);
    for (const step of STEPS) {
      job.steps[step] = 'running'; A.ui(); await sleep(300);
      if (step === 'precheck' && s.os === 'linux' && s.adapter !== 'installed') {
        if (!S.settings.autoInstallAdapter) { return failJob(job, c, step, 'ADAPTER_NO_RESPONSE: cdm_linux_adapter.sh is not installed on ' + s.name, false); }
        log(`    ${s.name}: deploy adapter missing, installing it over SSH (SHA-256 compared first)`, 'warn'); await sleep(350); s.adapter = 'installed'; A.audit('deploy.adapter_installed', s.name, { path: '/usr/local/sbin/cdm_linux_adapter.sh' }, R.actor);
      }
      if (step === 'backup') {
        const b = { id: 'BK-' + job.id.slice(4), jobId: job.id, certId: c.id, cn: c.cn, serverId: s.id, createdAt: Date.now(), retainUntil: Date.now() + 30 * DAY, path: s.os === 'windows' ? 'C:\\ProgramData\\CDM\\backups\\' + job.id : '/var/backups/cdm/' + job.id,
          sha256: D.sha256(job.id + c.thumbprint), oldThumb: c.thumbprint, oldNotAfter: c.notAfter, oldNotBefore: c.notBefore, status: 'available' };
        S.backups.unshift(b); job.backupId = b.id; A.audit('deploy.backup', job.id, { path: b.path }, R.actor);
      }
      if (job.willFail && step === 'activate') return failJob(job, c, step, FAIL_TEXT[s.tech] || 'activation failed', true);
      job.steps[step] = 'done';
    }
    const now = Date.now(), life = c.type === 'DV' ? 90 : 365;
    c.history.unshift({ at: now, jobId: job.id, from: c.thumbprint, to: job.newThumb, outcome: 'Deployed' }); c.thumbprint = job.newThumb; c.serial = uid(32).toUpperCase();
    c.notBefore = now; c.notAfter = now + life * DAY; c.state = 'Managed'; c.lastError = null; c.lastScanned = now; c.approved = false;
    job.state = 'Deployed'; job.endedAt = now; A.dbWrite('deployment_jobs'); log(`  ${job.id} ${job.cn}: Deployed, awaiting confirmation`, 'ok'); A.audit('deploy.deployed', job.id, { thumbprint: job.newThumb.slice(0, 16) }, R.actor);
  }
  async function failJob(job, c, step, msg, rollback) {
    const R = A.RUN; job.steps[step] = 'failed'; job.error = msg; A.ui();
    log(`  ${job.id} ${job.cn}: FAILED at ${step}. ${msg}`, 'err'); A.audit('deploy.failed', job.id, { step, error: msg }, R.actor);
    if (rollback) {
      log(`    rolling back: restoring the previous certificate and verifying the old thumbprint…`, 'warn'); await sleep(500);
      job.steps.verify = 'rolled'; job.state = 'Rolled back'; A.audit('rollback.completed', job.id, { verified: true, automatic: true }, R.actor); log(`    rollback verified: ${job.cn} serves the previous certificate again`, 'ok');
    } else { job.state = 'Failed (no change made)'; }
    c.state = 'Failed'; c.lastError = msg; job.endedAt = Date.now(); R.problems++; A.dbWrite('deployment_jobs');
  }
  const failed = j => /^(Rolled back|Failed)/.test(j.state);
  async function deployZone(zone, jobs) {
    const R = A.RUN, set = S.settings, skip = (list, why) => list.forEach(j => { j.state = 'Skipped'; j.error = why; });
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
    const R = A.RUN; setStage(4, 'active'); log(`Stage 5-11: deploy. ${R.jobs.length} job(s), one zone at a time in parallel, canary first, backup before every change…`, 'st');
    const zones = {}; R.jobs.forEach(j => (zones[j.zone] = zones[j.zone] || []).push(j));
    await Promise.all(Object.entries(zones).map(([z, js]) => deployZone(z, js)));
    const n = s => R.jobs.filter(j => s.test(j.state)).length;
    log(`  ${n(/^Deployed/)} deployed, ${n(/^Rolled/)} rolled back, ${n(/^Failed/)} failed, ${n(/^Skipped/)} skipped${n(/^Cancelled/) ? ', ' + n(/^Cancelled/) + ' cancelled' : ''}`, n(/^(Rolled|Failed)/) ? 'warn' : 'ok');
    setStage(4, R.jobs.some(failed) ? 'error' : 'done');
  }
  async function stageConfirm() {
    const R = A.RUN, list = R.jobs.filter(j => j.state === 'Deployed'); setStage(5, 'active'); log(`Stage 12: confirm. Logging in again to check ${list.length} deployment(s)…`, 'st');
    for (const j of list) { await sleep(160); const c = certById(j.certId); j.state = 'Confirmed'; if (c.history[0]) c.history[0].outcome = 'Confirmed'; log(`  ${j.cn}: CONFIRMED (${j.newThumb.slice(0, 12)}…)`, 'ok'); A.audit('orchestrator.confirmed', j.id, { thumbprint: j.newThumb.slice(0, 16) }, R.actor); }
    setStage(5, 'done');
  }

  async function runPipeline(opts = {}) {
    if (active()) return A.toast('A run is already in progress', 'warn');
    if (S.killSwitch) return A.toast('Emergency stop is active: renewals are frozen', 'err');
    if (A.SC && A.SC.running) return A.toast('Wait for the scan to finish', 'warn');
    const now = Date.now();
    A.RUN = { id: 'RUN-' + new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + uid(3), status: 'running', st: STAGES.map(() => 'pending'), dry: !!opts.dry, only: opts.only || null, jobs: [], log: [], stop: false, problems: 0,
      started: now, ended: null, actor: S.settings.actor, failNext: S.settings.failNext, caOutage: S.settings.caOutage, landed: new Map() };
    const R = A.RUN; A.audit('run.started', R.id, { dry: R.dry, only: R.only, command: R.only ? 'renew ' + certById(R.only[0]).cn : 'run' }, R.actor);
    log(`$ cdm ${R.only ? 'renew ' + certById(R.only[0]).cn : 'run'}${R.dry ? ' --dry-run' : ''}    (${R.id})`, 'st'); A.ui();
    try {
      for (const stage of [stageDiscover, stageLanding, stageMatch, stagePlan]) { if (R.stop) break; await stage(); }
      if (!R.stop && R.dry) log('Dry run: stopping before deployment. Nothing was changed on any server.', 'warn');
      else if (!R.stop && R.jobs.length) await stageDeploy(); else if (!R.stop) log('Nothing to deploy.', 'ok');
      if (!R.stop && !R.dry && R.jobs.length) await stageConfirm();
      else if (R.stop) log('Stopped by operator. In-flight jobs finished safely; deployed certificates are confirmed by the next run.', 'warn');
    } catch (err) { log('Internal error: ' + err.message, 'err'); R.problems++; }
    R.status = R.stop ? 'stopped' : 'done'; R.ended = Date.now();
    R.st = R.st.map(x => (x === 'active' ? 'error' : x));
    S.jobs.unshift(...R.jobs.filter(j => !(R.dry && j.state === 'Planned')).reverse()); S.jobs.length = Math.min(S.jobs.length, 300);
    S.certs.forEach(c => { if (c.state === 'Renewing') c.state = 'Managed'; });
    const exit = R.problems ? 2 : 0; log(`Run finished: ${R.status}, exit code ${exit}`, exit ? 'warn' : 'ok'); A.audit('run.finished', R.id, { status: R.status, problems: R.problems, exit }, R.actor); A.save(); A.ui(); A.renderView();
    return R;
  }
  A.runPipeline = runPipeline;
  A.handlers['run-now'] = () => { A.go('pipeline'); runPipeline(); };
  A.handlers['dry-run'] = () => { A.go('pipeline'); runPipeline({ dry: true }); };
  A.handlers.renew = el => { const c = certById(el.dataset.id); if (!c) return; A.closeLayer(); A.go('pipeline'); runPipeline({ only: [c.id] }); };
  A.handlers['run-pause'] = () => { const R = A.RUN; if (!R) return; R.status = R.status === 'paused' ? 'running' : R.status === 'running' ? 'paused' : R.status; log(R.status === 'paused' ? 'Paused by operator. Takes effect between jobs; in-flight jobs finish.' : 'Resumed.', 'warn'); A.audit('run.' + R.status, R.id, {}, R.actor); };
  A.handlers['run-stop'] = () => A.confirm({ title: 'Stop the renewal run?', danger: true, label: 'Stop gracefully', body: 'Jobs already in flight finish or roll back, so no server is left half-changed. Nothing new starts. Deployed certificates are confirmed by the next run.',
    onYes: () => { const R = A.RUN; if (!active()) return; R.stop = true; R.status = 'stopping'; log('Stop requested: finishing in-flight jobs…', 'warn'); A.audit('run.stop_requested', R.id, {}, R.actor); } });
  A.handlers['log-clear'] = () => { if (A.RUN && !active()) { A.RUN.log = []; A.renderView(); } };

  // ------------------------------------------------------------------ pipeline view
  const stagesHtml = () => { const R = A.RUN; return STAGES.map(([t, s], i) => `<div class="stage ${R ? R.st[i] === 'pending' && R.dry && i > 3 ? 'skip' : R.st[i] : ''}"><div class="n">${R && R.st[i] === 'done' ? '✓' : R && R.st[i] === 'error' ? '!' : i + 1}</div><b>${t}</b><small>${s}</small></div>`).join(''); };
  const ctrlHtml = () => {
    const R = A.RUN, on = active();
    return `<button class="btn primary" data-act="run-now" ${on || S.killSwitch ? 'disabled' : ''}>${icon('play')}Run pipeline</button><button class="btn" data-act="dry-run" ${on || S.killSwitch ? 'disabled' : ''}>Dry run</button>
      <button class="btn" data-act="run-pause" ${on && R.status !== 'stopping' ? '' : 'disabled'}>${icon('pause')}${R && R.status === 'paused' ? 'Resume' : 'Pause'}</button><button class="btn danger" data-act="run-stop" ${on && R.status !== 'stopping' ? '' : 'disabled'}>${icon('stop')}Stop</button>
      <button class="btn" data-act="log-clear" ${on || !R ? 'disabled' : ''}>Clear log</button>${R ? `<span class="muted" style="margin-left:6px">${esc(R.id)} · ${esc(R.status)}${R.dry ? ' · dry run' : ''}</span>` : ''}`;
  };
  const jobsHtml = () => {
    const R = A.RUN, jobs = R ? R.jobs : [];
    return `<table><thead><tr><th>Job</th><th>Certificate</th><th>Server</th><th>Steps</th><th>State</th><th></th></tr></thead><tbody>${jobs.map(j => `<tr><td class="mono nowrap">${esc(j.id)}</td><td><div class="cn">${esc(j.cn)}</div>${j.error ? `<div class="sub" style="color:var(--${/^(Skipped|Cancelled)/.test(j.state) ? 'faint' : 'red'})">${esc(j.error)}</div>` : ''}</td><td class="nowrap">${esc(srv(j.serverId).name)}<div class="sub">${esc(j.zone)}${j.canary ? ' · canary' : ''}</div></td><td>${A.stepDots(j.steps)}</td><td>${A.jobPill(j.state === 'Deployed' ? 'Deployed' : j.state)}</td><td>${A.canRollback(j) ? `<button class="btn sm danger" data-act="rollback-job" data-id="${j.id}">${icon('undo')}Roll back</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${R ? (R.dry ? 'Dry run: jobs are planned but nothing is deployed.' : R.stop ? 'Stopped before any job started.' : R.status === 'done' ? 'No jobs were needed.' : 'Planning…') : 'Run the pipeline to see live jobs here.'}</td></tr>`}</tbody></table>`;
  };
  const consoleHtml = () => { const R = A.RUN; return R && R.log.length ? R.log.map(l => `<div><span class="t">${A.fmtTime(l.t)}</span> <span class="${l.cls}">${esc(l.msg)}</span></div>`).join('') : '<span class="t">$ cdm run   (waiting)</span>'; };
  const setHtml = (id, html, stick) => { const el = $(id); if (!el) return; const near = stick && el.scrollHeight - el.scrollTop - el.clientHeight < 60; el.innerHTML = html; if (near || (stick && el.dataset.first !== '1')) { el.scrollTop = el.scrollHeight; el.dataset.first = '1'; } };
  A.views.pipeline = {
    render() {
      const s = S.settings;
      return `<div class="card"><h3>Renewal pipeline</h3><div class="sub">Discover, landing, match, plan, deploy, confirm. The same six stages run for Linux, Windows and Java; this simulation uses sample data and never touches a real server.</div><div class="stages" id="p-stages">${stagesHtml()}</div></div>
        <div class="card"><div class="row" id="p-ctrl">${ctrlHtml()}</div><div class="ctrl-grid" style="margin-top:16px">
          <label class="toggle"><input type="checkbox" data-pset="failNext" ${s.failNext ? 'checked' : ''}><div><b>Fail the next deployment</b><span>Fault injection: the canary breaks at activation so you can watch the automatic rollback and zone halt</span></div></label>
          <label class="toggle"><input type="checkbox" data-pset="caOutage" ${s.caOutage ? 'checked' : ''}><div><b>Simulate CA outage</b><span>ACME orders fail; certificates stay untouched and are retried next run</span></div></label>
          <label><b>Simulation speed</b><br><select class="input" data-pselect="speed" style="margin-top:6px;width:100%">${[['slow', 'Slow (explain each step)'], ['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']].map(([v, t]) => `<option value="${v}" ${s.speed === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div></div>
        <div class="grid g21" style="align-items:start"><div class="tablewrap" id="p-jobs">${jobsHtml()}</div><div class="console" id="p-console" style="position:sticky;top:16px;height:min(72vh,620px)">${consoleHtml()}</div></div>`;
    },
    after() { const c = $('#p-console'); if (c) c.scrollTop = c.scrollHeight; },
    live() { setHtml('#p-stages', stagesHtml()); setHtml('#p-ctrl', ctrlHtml()); setHtml('#p-jobs', jobsHtml()); setHtml('#p-console', consoleHtml(), true); },
  };
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.pset) { A.setSetting(t.dataset.pset, t.checked); A.toast(t.checked ? 'Fault injection armed' : 'Fault injection cleared', t.checked ? 'warn' : 'ok'); }
    else if (t.dataset.pselect) A.setSetting(t.dataset.pselect, t.value);
  });

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
        if (i === 0 && s.status === 'unreachable') { SC.errors.push(`${s.name}: ${s.error}`); A.audit('discovery.failed', s.name, { error: s.error }); break; }
        if (i === SC.steps.length - 1) { const list = S.certs.filter(c => c.serverId === id); list.forEach(c => { c.lastScanned = Date.now(); }); found.push(...list); A.dbWrite('certificates_seen', list.length); A.audit('discovery.scanned', s.name, { certificates: list.length }); }
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
      <div class="tablewrap" style="border:0"><table><thead><tr><th>Status</th><th>Certificate</th><th>Server</th><th>Type</th><th>Expires</th><th>Location</th><th>CDM</th></tr></thead><tbody>${list.map(c => `<tr class="clickable" data-act="cert" data-id="${c.id}"><td>${pill(A.status(c) === 'expired' ? 'Expired' : A.status(c) === 'expiring' ? 'Expiring' : 'Valid', A.status(c) === 'expired' ? 'red' : A.status(c) === 'expiring' ? 'amber' : 'green')}</td><td><div class="cn">${esc(c.cn)}</div></td><td>${esc(srv(c.serverId).name)}</td><td>${pill(c.type, c.type === 'DV' ? 'cyan' : c.type === 'OV' ? 'purple' : 'amber')}</td><td class="nowrap">${A.fmtDate(c.notAfter)} (${Math.round(A.dleft(c))}d)</td><td class="mono">${esc(c.location)}</td><td>${c.managed ? pill('Managed', 'blue') : A.inel(c) ? `<span class="muted" style="font-size:.8rem">${esc(A.inel(c))}</span>` : pill('Eligible', 'green')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No certificates in this range.</td></tr>'}</tbody></table></div></div>`;
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
        <div class="card ap-card"><div class="tablewrap flat"><table><thead><tr><th>Server</th><th>Platform</th><th>Zone</th><th>Transport</th><th>Deploy adapter</th><th>Certificates</th><th>Status</th><th class="right">Actions</th></tr></thead><tbody>${S.servers.map(s => { const cs = S.certs.filter(c => c.serverId === s.id), due = cs.filter(c => c.managed && isDue(c)).length;
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
      if (bad) s.tries = (s.tries || 0) + 1; else if (s.status === 'unreachable') { s.status = 'online'; s.error = null; A.audit('connectivity.restored', s.name, {}); }
      if (ok) A.toast(s.name + ' is reachable', 'ok'); A.renderView(); A.ui();
    },
    'srv-pause': el => { const s = srv(el.dataset.id); s.paused = !s.paused; A.audit(s.paused ? 'server.paused' : 'server.resumed', s.name, {}); A.toast(s.name + (s.paused ? ' excluded from runs' : ' back in rotation'), s.paused ? 'warn' : 'ok'); A.renderView(); },
    'srv-adapter': async el => { const s = srv(el.dataset.id); const ok = await A.progress({ title: 'Installing the deploy adapter on ' + s.name, steps: ['Compare SHA-256 of /usr/local/sbin/cdm_linux_adapter.sh', 'Copy the reviewed script over SSH (sudo -n tee)', 'chown root:root, chmod 0750', 'Create /var/backups/cdm (0700)'], stepMs: 520 }); if (ok) { s.adapter = 'installed'; A.audit('deploy.adapter_installed', s.name, {}); A.renderView(); } },
  });

  // ------------------------------------------------------------------ self-test (?selftest)
  async function selftest() {
    const out = [], t = (n, ok, x) => out.push({ n, ok: !!ok, x });
    try {
      A.reset(); S.settings.speed = 'instant'; const before = A.stats();
      const chain0 = A.verifyChain(); t('seed chain verifies', chain0.ok, chain0);
      S.settings.failNext = true; let R = await runPipeline();
      t('run completes', R.status === 'done', R.status); t('jobs created', R.jobs.length > 5, R.jobs.length);
      t('canary failure rolled back', R.jobs.some(j => j.state === 'Rolled back'), R.jobs.map(j => j.state).join());
      t('zone halted (skipped jobs)', R.jobs.some(j => j.state === 'Skipped'));
      t('other zones confirmed', R.jobs.some(j => j.state === 'Confirmed'));
      t('adapter auto-installed on lnx01', srv('lnx01').adapter === 'installed' || !R.jobs.some(j => j.serverId === 'lnx01'));
      t('compliance improved', A.stats().expiring + A.stats().expired < before.expiring + before.expired, [before.expiring + before.expired, A.stats().expiring + A.stats().expired]);
      t('chain still verifies after run', A.verifyChain().ok);
      const j = S.jobs.find(x => A.canRollback(x)); t('rollback candidate exists', !!j);
      if (j) { const c = certById(j.certId); A.applyRollback(j); t('rollback restores old thumbprint', c.thumbprint === j.oldThumb && j.state === 'Rolled back (manual)'); t('rolled-back job not re-rollbackable', !A.canRollback(j)); }
      A.tamper(); t('tamper detected', !A.verifyChain().ok, A.verifyChain()); A.untamper(); t('untamper restores chain', A.verifyChain().ok);
      const dry = await runPipeline({ dry: true }); t('dry run leaves jobs unexecuted', dry.jobs.every(x => x.state === 'Planned'));
      S.settings.caOutage = true; S.settings.speed = 'instant'; const co = await runPipeline(); t('CA outage reports problems', co.problems > 0 || co.jobs.length === 0, co.problems); S.settings.caOutage = false;
      const lab = srv('win01'); await scan([lab.id]); t('scan returns windows certificates', SC.results && SC.results.list.length === S.certs.filter(c => c.serverId === 'win01').length);
      S.killSwitch = true; const ks = await runPipeline(); t('emergency stop blocks runs', ks === undefined); S.killSwitch = false;
      S.settings.speed = 'fast'; S.certs.filter(c => c.managed && c.type === 'DV' && !c.paused).slice(0, 12).forEach(c => { c.notAfter = Date.now() + 3 * DAY; });
      const p = runPipeline(); await new Promise(r => setTimeout(r, 1500)); A.handlers['run-stop'] && (A.RUN.stop = true, A.RUN.status = 'stopping'); R = await p;
      t('graceful stop', R.status === 'stopped' && !R.jobs.some(x => x.state === 'Running'), R.status + ' ' + R.jobs.map(x => x.state).join());
      const views = Object.keys(A.views); views.forEach(v => { const h = A.views[v].render(); t('view renders: ' + v, typeof h === 'string' && h.length > 50); });
    } catch (err) { t('exception', false, String(err && err.stack || err)); }
    const pre = document.createElement('pre'); pre.id = 'selftest-out'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
    document.title = 'SELFTEST ' + (out.every(o => o.ok) ? 'PASS ' : 'FAIL ') + out.filter(o => o.ok).length + '/' + out.length;
  }
  if (/[?&]selftest/.test(location.search)) window.addEventListener('load', () => setTimeout(selftest, 100));
})();
