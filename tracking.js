/* CDM prototype - the journey of one certificate, and the error table. */
(function () {
  'use strict';
  const A = window.CDM_APP, S = A.S, $ = A.$, esc = A.esc, icon = A.icon, pill = A.pill, opt = A.opt;
  const srv = A.srv, certById = A.certById, isDue = A.isDue;
  const tile = (lbl, num, color, hint, act) => `<${act ? 'button' : 'div'} class="kpi small" style="--c:var(--${color})" ${act || ''}><div class="kpi-l"><div class="lbl">${lbl}</div><div class="hint">${hint}</div></div><div class="num">${num}</div></${act ? 'button' : 'div'}>`;
  const days = c => { const d = Math.round(A.dleft(c)); return d < 0 ? `expired ${-d}d ago` : `${d}d left`; };
  const running = () => !!A.RUN && ['running', 'paused', 'stopping'].includes(A.RUN.status);

  // ------------------------------------------------------------------ certificate journey
  // The journey follows the backend pipeline: seven stages, in the order `cdm run` executes them. Under each stage it lists
  // the work done inside it; the engine traces that work under the keys in `subs`.
  const JSTAGES = [
    { key: 'discover', title: 'Discover', cmd: 'cdm discover', text: 'CDM logs in read-only, reads the certificate the server uses now and decides whether it is due.',
      subs: [['scan', 'Scan the server'], ['window', 'Check the renewal window'], ['ca', 'Check the selected CAs']] },
    { key: 'landing', title: 'Landing', cmd: 'cdm landing', text: 'CDM obtains the replacement certificate: an ACME order for DV, the drop-in folder for OV and EV.',
      subs: [['order', 'Create the key and order the certificate']] },
    { key: 'match', title: 'Match', cmd: 'cdm match', text: 'The replacement must be the same identity, expire later and not be a weaker type.',
      subs: [['match', 'Match the replacement']] },
    { key: 'plan', title: 'Plan', cmd: 'cdm plan', text: 'A deployment job is created. One canary per zone goes first.',
      subs: [['plan', 'Create the deployment job']] },
    { key: 'deploy', title: 'Deploy', cmd: 'cdm deploy', text: 'The job runs on the server: precheck, backup, install, activate and verify. A failure after install rolls the server back.',
      subs: [['precheck', 'Precheck'], ['backup', 'Backup'], ['install', 'Install'], ['activate', 'Activate'], ['verify', 'Verify']] },
    { key: 'confirm', title: 'Confirm', cmd: 'cdm confirm', text: 'CDM logs in again and checks the result independently of the deployment.',
      subs: [['confirm', 'Log in again and compare']] },
    { key: 'retire', title: 'Retire replaced', cmd: 'cdm retire-replaced', text: 'After the rollback window, CDM deletes the certificate that was replaced.',
      subs: [['retire', 'Remove the replaced certificate']] },
  ];
  const ROLLBACK = ['rollback', 'Roll back'];
  const J = A.J = { sel: null, mode: 'step', last: '', reset() { Object.assign(J, { sel: null, mode: 'step', last: '' }); } };
  const titleOf = key => (JSTAGES.find(g => g.key === key) || { title: key }).title;
  // which stage a traced piece of work belongs to (the engine waits once per stage in step-by-step mode)
  A.stageOf = key => (key === 'rollback' ? 'deploy' : (JSTAGES.find(g => g.subs.some(u => u[0] === key)) || { key }).key);
  function journeyOf(id) {
    const R = A.RUN;
    const mine = !!R && !!R.only && R.only.includes(id);   // followed by the current run: live even before its first step is traced
    if (R && (R.trace[id] || (mine && running()))) return { live: running(), runId: R.id, at: R.started, steps: R.trace[id] || [], waiting: mine ? R.waiting : null, stepMode: R.stepMode };
    return S.journeys[id] ? { live: false, ...S.journeys[id] } : null;
  }
  // The certificates a journey can be started for: managed, inside the renewal window (expired included), on a server CDM can reach.
  // A certificate that was renewed is no longer due, so it leaves this list.
  function pickList() {
    const g = { ok: [], review: [] };
    for (const c of A.certs()) {
      const s = srv(c.serverId), due = c.managed && isDue(c) && !c.paused && !s.paused && s.status !== 'unreachable';
      if (!due) continue;
      if (c.state === 'Review' || (c.type !== 'DV' && S.settings.approveOvEv && !c.approved)) g.review.push(c);
      else g.ok.push(c);
    }
    Object.values(g).forEach(l => l.sort((a, b) => a.notAfter - b.notAfter));
    return g;
  }
  // One row per stage. Its status comes from the work traced inside it.
  const ENDS = ['failed', 'blocked', 'skipped'];
  function rowsOf(j) {
    const rec = Object.fromEntries((j ? j.steps : []).map(s => [s.key, s])); let ended = false;
    return JSTAGES.map((g, i) => {
      const subs = g.subs.map(([key, title]) => ({ key, title, s: rec[key] }));
      const got = subs.filter(u => u.s), has = st => got.some(u => u.s.status === st);
      const status = !got.length ? (!j ? 'pending' : ended || !j.live ? 'notreached' : j.waiting === g.key ? 'waiting' : 'pending')
        : has('failed') ? 'failed' : has('blocked') ? 'blocked' : has('skipped') ? 'skipped' : got.length === subs.length && !has('running') ? 'done' : j.live ? 'running' : 'skipped';
      const open = ENDS.includes(status) || ended || !j || !j.live ? 'notreached' : 'pending';
      subs.forEach(u => { u.status = u.s ? u.s.status : open; });
      if (g.key === 'deploy' && rec.rollback) subs.push({ key: 'rollback', title: ROLLBACK[1], s: rec.rollback, status: rec.rollback.status });
      if (ENDS.includes(status)) ended = true;
      const all = subs.filter(u => u.s), at = all.length ? Math.min(...all.map(u => u.s.at)) : null, end = all.length && all.every(u => u.s.end) ? Math.max(...all.map(u => u.s.end)) : null;
      return { g, n: i + 1, subs, status, at, end, bad: all.find(u => u.s.code) };
    });
  }
  const MARK = { done: '✓', failed: '✕', blocked: '!', skipped: '–', waiting: '▶' };
  const WORD = { done: 'Done', failed: 'Failed', blocked: 'Blocked', skipped: 'Skipped', running: 'Running…', waiting: 'Next stage', pending: 'Not started', notreached: 'Not reached' };
  const subLines = u => (u.s && u.s.lines.length ? `<ul class="jlines">${u.s.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '');
  // A stage with several pieces of work lists each of them with its own result; a stage with one shows its lines directly.
  function stepHtml(r, c) {
    const took = r.at ? ` · ${A.fmtTime(r.at)}${r.end ? ` · ${((r.end - r.at) / 1000).toFixed(1)} s` : ''}` : '';
    const inside = r.subs.length > 1 ? `<div class="jsubs">${r.subs.map(u => `<div class="jsub ${u.status}"><div class="jsub-h"><span class="jsub-ic">${MARK[u.status] || (u.key === 'rollback' ? '↩' : '')}</span><b>${u.title}</b><small>${WORD[u.status]}</small></div>${subLines(u)}</div>`).join('')}</div>` : subLines(r.subs[0]);
    return `<li class="jstep ${r.status}" data-key="${r.g.key}"><span class="ic">${MARK[r.status] || r.n}</span><div class="jbody">
      <div class="row spread"><div class="jt"><b>${r.g.title}</b><span class="jcmd mono">${r.g.cmd}</span></div>${r.status === 'waiting' ? `<button class="btn sm primary" data-act="journey-next">${icon('play')}Run &amp; Next</button>` : `<span class="muted" style="font-size:.84rem">${WORD[r.status]}${took}</span>`}</div>
      <div class="muted" style="font-size:.9rem">${r.g.text}</div>${inside}
      ${r.bad ? `<div class="jerr"><b class="mono">${esc(r.bad.s.code)}</b><span>Recorded in the error table</span><button class="btn sm" data-act="err-find" data-cert="${c.id}" data-code="${esc(r.bad.s.code)}">Open the record</button></div>` : ''}</div></li>`;
  }
  function verdictHtml(c, j, rows) {
    if (!j) return `<div class="banner info">${icon('route')}<div><b>Not started.</b> Press <b>Start journey</b> to follow this certificate through its renewal. Nothing real is touched: this is sample data.</div></div>`;
    const bad = rows.find(r => r.status === 'failed'), block = rows.find(r => r.status === 'blocked'), skip = rows.find(r => r.status === 'skipped');
    const rb = rows.flatMap(r => r.subs).find(u => u.key === 'rollback'), sub = (r, st) => r.subs.find(u => u.s && u.s.status === st);
    if (j.live && j.waiting) return `<div class="banner info">${icon('pause')}<div><b>Waiting for you.</b> The next stage is <b>${titleOf(j.waiting)}</b>. Press <b>Run &amp; Next</b> on that stage to run it.</div></div>`;
    if (bad) return `<div class="banner">${icon('alert')}<div><b>Stopped at "${bad.g.title}"${bad.subs.length > 1 && sub(bad, 'failed') ? ` (${sub(bad, 'failed').title.toLowerCase()})` : ''} with ${esc((bad.bad && bad.bad.s.code) || 'an error')}.</b> ${rb ? (rb.status === 'done' ? 'The server was rolled back and serves its previous certificate again.' : 'CDM is rolling the server back now.') : bad.g.key === 'confirm' ? 'The certificate was deployed but could not be confirmed.' : 'Nothing was changed on the server.'} The error is recorded in the error table.</div></div>`;
    if (j.live) return `<div class="banner info">${icon('play')}<div><b>Running.</b> ${esc(j.runId)}</div></div>`;
    if (block) return `<div class="banner warn">${icon('alert')}<div><b>Blocked at "${block.g.title}".</b> ${esc((sub(block, 'blocked') || { s: { lines: [] } }).s.lines[0] || '')}. The certificate is unchanged.</div></div>`;
    if (skip) return `<div class="banner info">${icon('check')}<div><b>Ended at "${skip.g.title}".</b> ${esc(((sub(skip, 'skipped') || { s: { lines: [] } }).s.lines.slice(-1)[0]) || 'The run ended before this stage finished')}.</div></div>`;
    if (rows.some(r => r.g.key === 'confirm' && r.status === 'done')) return `<div class="banner ok">${icon('check')}<div><b>Renewed and confirmed.</b> ${esc(c.cn)} now has a certificate valid until ${A.fmtDate(c.notAfter)}.</div></div>`;
    return `<div class="banner info">${icon('pause')}<div><b>The run ended before this journey finished.</b> Start it again to continue.</div></div>`;
  }
  function journeyBody() {
    const c = certById(J.sel); if (!c) return `<div class="card empty">${A.scopeOn() ? `No certificate from the selected CAs is inside the ${S.settings.windowDays}-day renewal window right now, so there is nothing to renew.` : 'No certificate is inside the renewal window right now.'}<div class="row" style="justify-content:center;margin-top:14px">${A.restorable().length ? `<button class="btn primary" data-act="restore-due">${icon('undo')}Make ${A.restorable().length} renewed test certificate${A.restorable().length === 1 ? '' : 's'} due again</button>` : ''}<button class="btn" data-act="reset-demo">${icon('undo')}Reset demo data</button></div></div>`;
    const s = srv(c.serverId), j = journeyOf(c.id), rows = rowsOf(j), v = A.caVerdict(c), done = rows.filter(r => r.status === 'done').length;
    return `<div class="card"><div class="row spread"><div><h3 style="font-size:1.2rem;word-break:break-all">${esc(c.cn)}</h3><div class="row" style="margin-top:8px">${A.statePill(c)}${pill(c.type, c.type === 'DV' ? 'cyan' : c.type === 'OV' ? 'purple' : 'amber')}${pill(days(c), A.status(c) === 'valid' ? 'green' : A.status(c) === 'expired' ? 'red' : 'amber')}</div></div>
        <div class="right"><div style="font-size:1.6rem;font-weight:800">${done}/${JSTAGES.length}</div><div class="muted" style="font-size:.84rem">stages completed${j ? ' · ' + esc(j.runId) : ''}</div></div></div>
      <dl class="kv"><dt>Server</dt><dd>${esc(s.name)} (${esc(s.host)}) · ${esc(s.zone)} · ${esc(s.tech.replace('_', ' '))}</dd><dt>Location</dt><dd class="mono">${esc(c.location)}</dd><dt>Issuer</dt><dd>${esc(c.ca)} ${A.scopeOn() && v.ok ? pill('Selected CA', 'green') : ''}</dd><dt>Expires</dt><dd>${A.fmtDate(c.notAfter)}</dd><dt>Thumbprint</dt><dd class="mono">${esc(c.thumbprint.slice(0, 32))}…</dd></dl>
      ${verdictHtml(c, j, rows)}</div>
      <div class="card"><h3>Stage by stage</h3><div class="sub">The seven stages of the pipeline, in the order they run. Each stage shows what CDM did inside it and what it found. A failed stage shows its error code and what happened to the server.</div><ul class="jsteps">${rows.map(r => stepHtml(r, c)).join('')}</ul></div>`;
  }
  const canStart = id => { const g = pickList(); return [...g.ok, ...g.review].some(c => c.id === id); };
  function journeyCtrl() {
    const R = A.RUN, on = running(), mine = on && R.only && R.only.includes(J.sel), c = certById(J.sel), ok = !!c && canStart(J.sel);
    return `<button class="btn primary" data-act="journey-start" ${on || S.killSwitch || !ok ? 'disabled' : ''}>${icon('play')}Start journey</button>
      <button class="btn danger" data-act="run-stop" ${on && R.status !== 'stopping' ? '' : 'disabled'}>${icon('stop')}Stop</button>
      ${on && !mine ? '<span class="muted">A renewal run is in progress. Its certificates appear here as it reaches them.</span>' : S.killSwitch ? '<span class="muted">Emergency stop is active.</span>'
        : c && !ok && !on ? `<span class="muted">This certificate is not inside the ${S.settings.windowDays}-day renewal window${c.history.length ? ' any more: it was renewed' : ''}. Choose another certificate to start a journey.</span>` : ''}`;
  }
  // ---- Dropdowns of this page. Certificate and How to play share one component, so they look and behave alike.
  const GROUPS = g => [['Due for renewal', g.ok], ['Due, waiting for approval', g.review]];
  const MODES = [['step', 'One stage at a time', 'Press Run & Next on every stage'], ['auto', 'All stages automatically', 'Runs to the end without waiting']];
  const DD_KEYS = ['sel', 'mode'];
  const ddDefs = () => ({
    sel: { label: 'Certificate', search: true, placeholder: 'No certificate is due',
      groups: GROUPS(pickList()).map(([name, list]) => [name, list.map(c => ({ v: c.id, title: c.cn, sub: `${srv(c.serverId).name} · ${srv(c.serverId).zone} · ${c.type} · ${days(c)}`, find: [c.cn, c.id, srv(c.serverId).name, srv(c.serverId).zone, c.type].join(' ') }))]) },
    mode: { label: 'How to play', groups: [['', MODES.map(([v, title, sub]) => ({ v, title, sub }))]] },
  });
  const SVG = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const CHEV = SVG('<path d="M6 9l6 6 6-6"/>').replace('<svg ', '<svg class="jdd-chev" '), TICK = SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>').replace('<svg ', '<svg class="jdd-tick" ');
  A.CHEV = CHEV; A.TICK = TICK;
  const ddMain = it => `<span class="jdd-main"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>`;
  const ddValue = key => (key === 'sel' ? J.sel : J[key]);
  function ddItems(key, q) {
    const d = ddDefs()[key], f = (q || '').trim().toLowerCase(), cur = ddValue(key);
    const html = d.groups.map(([name, items]) => {
      const m = items.filter(it => !f || (it.find || it.title + ' ' + it.sub).toLowerCase().includes(f));
      return m.length ? (name ? `<div class="jdd-grp" role="presentation">${esc(name)} (${m.length})</div>` : '')
        + m.map(it => `<button type="button" class="jdd-opt${it.v === cur ? ' sel' : ''}" role="option" aria-selected="${it.v === cur}" data-act="jdd-choose" data-dd="${key}" data-v="${esc(it.v)}">${ddMain(it)}${it.v === cur ? TICK : ''}</button>`).join('') : '';
    }).join('');
    return html || '<div class="jdd-none">Nothing matches the search.</div>';
  }
  function ddHtml(key) {
    const d = ddDefs()[key], sel = key === 'sel' && certById(J.sel);
    // the certificate being viewed stays on the button after its renewal took it out of the list
    const cur = d.groups.flatMap(([, items]) => items).find(it => it.v === ddValue(key)) || (sel ? { title: sel.cn, sub: `${srv(sel.serverId).name} · ${srv(sel.serverId).zone} · ${sel.type} · ${days(sel)}` } : null);
    return `<div class="jdd-wrap"><b class="jdd-label" id="jdd-${key}-label">${d.label}</b><div class="jdd">
      <button type="button" class="jdd-btn" id="jdd-${key}-btn" data-act="jdd-toggle" data-dd="${key}" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="jdd-${key}-label jdd-${key}-btn">${cur ? ddMain(cur) : `<span class="jdd-main"><b>${esc(d.placeholder || '')}</b></span>`}${CHEV}</button>
      <div class="jdd-pop" id="jdd-${key}-pop" hidden>${d.search ? `<input class="jdd-search" id="jdd-${key}-q" type="search" autocomplete="off" placeholder="Search by name, server, zone or type…" aria-label="Search certificates">` : ''}<div class="jdd-list" id="jdd-${key}-list" role="listbox" aria-labelledby="jdd-${key}-label">${ddItems(key, '')}</div></div></div></div>`;
  }
  const ddOpenKey = () => DD_KEYS.find(k => { const p = $('#jdd-' + k + '-pop'); return p && !p.hidden; });
  function ddClose(key, focus) {
    const p = $('#jdd-' + key + '-pop'); if (!p || p.hidden) return;
    p.hidden = true; $('#jdd-' + key + '-btn').setAttribute('aria-expanded', 'false'); if (focus) $('#jdd-' + key + '-btn').focus();
  }
  function ddOpen(key) {
    DD_KEYS.forEach(k => { if (k !== key) ddClose(k, false); });
    const p = $('#jdd-' + key + '-pop'), q = $('#jdd-' + key + '-q'), list = $('#jdd-' + key + '-list'); if (q) q.value = '';
    list.innerHTML = ddItems(key, ''); p.hidden = false; $('#jdd-' + key + '-btn').setAttribute('aria-expanded', 'true');
    const sel = list.querySelector('.jdd-opt.sel'); if (sel) list.scrollTop = Math.max(0, sel.offsetTop - (list.clientHeight - sel.offsetHeight) / 2);
    (q || sel || list.querySelector('.jdd-opt')).focus({ preventScroll: true });
  }
  function ddChoose(key, v) {
    if (key === 'sel') { J.sel = v; J.last = ''; } else J[key] = v;
    // switching the mode while a journey is running applies to the rest of it
    if (key === 'mode' && running() && A.RUN.only) { A.RUN.stepMode = J.mode === 'step'; if (!A.RUN.stepMode) A.RUN.waiting = null; }
    A.renderView(); $('#jdd-' + key + '-btn').focus();
  }
  A.views.journey = {
    render() {
      const g = pickList(), all = [...g.ok, ...g.review];
      // keep showing a certificate whose journey was just followed, even though its renewal took it out of the list
      if (!certById(J.sel) || !(all.some(c => c.id === J.sel) || journeyOf(J.sel))) J.sel = (g.ok.find(c => srv(c.serverId).lab) || all[0] || {}).id || null;
      return `<div class="card jdd-card"><h3>Certificate journey</h3><div class="sub">Follow one certificate through the pipeline: discover, landing, match, plan, deploy, confirm and retire-replaced. Run it one stage at a time, or all stages in one go.</div>
          <div class="ctrl-grid">${DD_KEYS.map(ddHtml).join('')}</div>
          <div class="row" id="j-ctrl" style="margin-top:16px">${journeyCtrl()}</div></div><div id="j-body" style="display:flex;flex-direction:column;gap:18px">${journeyBody()}</div>`;
    },
    after() {
      const q = $('#jdd-sel-q');
      q.addEventListener('input', e => { $('#jdd-sel-list').innerHTML = ddItems('sel', e.target.value); });
      q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const first = $('#jdd-sel-list .jdd-opt'); if (first) first.click(); } });
    },
    live() {
      const ctrl = $('#j-ctrl'), body = $('#j-body'); if (!ctrl || !body) return;
      A.put(ctrl, journeyCtrl()); A.put(body, journeyBody());
      const at = (body.querySelector('.jstep.waiting, .jstep.running') || {}).dataset;
      if (at && at.key !== J.last) { J.last = at.key; body.querySelector(`.jstep[data-key="${at.key}"]`).scrollIntoView({ block: 'nearest' }); }
    },
  };
  document.addEventListener('click', e => { const k = ddOpenKey(); if (k && !e.target.closest('.jdd')) ddClose(k, false); });
  document.addEventListener('keydown', e => {
    const key = ddOpenKey();
    if (!key) { if (e.key === 'ArrowDown' && e.target.dataset && e.target.dataset.dd && e.target.classList.contains('jdd-btn')) { e.preventDefault(); ddOpen(e.target.closest('.jdd-wrap').querySelector('.jdd-btn').dataset.dd); } return; }
    if (e.key === 'Escape') { e.stopPropagation(); ddClose(key, true); return; }
    const opts = [...document.querySelectorAll('#jdd-' + key + '-list .jdd-opt')], i = opts.indexOf(document.activeElement); if (!opts.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(opts.length - 1, i + 1)].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) (document.getElementById('jdd-' + key + '-q') || opts[0]).focus(); else opts[i - 1].focus(); }
    else if (e.key === 'Home' && i >= 0) { e.preventDefault(); opts[0].focus(); }
    else if (e.key === 'End' && i >= 0) { e.preventDefault(); opts[opts.length - 1].focus(); }
    else if (e.key === 'Tab') ddClose(key, false);
  }, true);
  Object.assign(A.handlers, {
    'jdd-toggle': el => { const k = el.dataset.dd; if ($('#jdd-' + k + '-pop').hidden) ddOpen(k); else ddClose(k, true); },
    'jdd-choose': el => ddChoose(el.dataset.dd, el.dataset.v),
    'journey-open': el => { J.sel = el.dataset.id; J.last = ''; A.closeLayer(); if (A.view() === 'journey') A.renderView(); else A.go('journey'); },
    'journey-start': () => { const c = certById(J.sel); if (!c) return; if (!canStart(c.id)) return A.toast('This certificate is not inside the renewal window, so there is nothing to renew', 'warn'); J.last = ''; A.runPipeline({ only: [c.id], step: J.mode === 'step' }); },
    'journey-next': () => { if (A.RUN) A.RUN.waiting = null; },
  });

  // ------------------------------------------------------------------ error table
  const STAGE_NAMES = ['Discover', 'Landing', 'Match', 'Deploy', 'Confirm', 'Pipeline'];
  const FIX = {
    SCAN_UNREACHABLE: 'Check the firewall or security group and the SSH/WinRM port, then use Servers → Test connection. The server is skipped until it answers; other servers are not affected.',
    CA_NOT_CONFIGURED: 'This issuer is not in the CA list of the automation setup, so CDM does not renew its certificates. Replace the certificate with one from a listed CA.',
    CA_NOT_SELECTED: 'Open Automation setup, choose Update CA selection and add a row with this issuing CA and its root CA if CDM should renew its certificates.',
    CA_ROOT_NOT_SELECTED: 'Open Automation setup, choose Update CA selection and add a row with this issuing CA and its root CA.',
    ACME_CA_UNREACHABLE: 'The CA did not answer. Nothing changed and the next run tries again. Check outbound HTTPS from the CDM host if it keeps happening.',
    ACME_VALIDATION_FAILED: 'The CA must reach the server on port 80. Open port 80 from the internet and check the webroot path, then renew again.',
    MATCH_SAN_MISMATCH: 'The replacement lists different names. Request a replacement with exactly the names of the current certificate.',
    DRIFT_DETECTED: 'Someone changed the certificate outside CDM after the scan. Scan the server again and rerun.',
    BACKUP_FAILED: 'Free disk space in the backup location on the server, then rerun. CDM never changes a server it could not back up.',
    ADAPTER_NO_RESPONSE: 'Install the deploy adapter from Servers, or switch on "Auto-install Linux adapter" under Policies.',
    INSTALL_FAILED: 'CDM restored the previous certificate. Check the account permissions and the certificate/key pair, then rerun.',
    ACTIVATE_FAILED: 'The service rejected the new certificate and CDM restored the previous one. Check the service configuration on the server, then rerun.',
    VERIFY_MISMATCH: 'The service did not pick up the new certificate, so CDM restored the previous one. Check which certificate the service is bound to.',
    CONFIRM_MISMATCH: 'The certificate on the server is not the one CDM deployed. Check who changed it, then scan the server and decide whether to renew again or roll back.',
    INTERNAL_ERROR: 'An unexpected error stopped the run. Run it again; deployed certificates are confirmed by the next run.',
  };
  const E = { q: '', stage: '', sev: '', status: '' };
  const errList = () => {
    const q = E.q.trim().toLowerCase();
    return S.errors.filter(e => (!E.stage || e.stage === E.stage) && (!E.sev || e.severity === E.sev) && (!E.status || e.status === E.status)
      && (!q || [e.id, e.code, e.message, e.cn, e.stage, e.step, e.runId, e.jobId, e.serverId ? srv(e.serverId).name : ''].join(' ').toLowerCase().includes(q)));
  };
  const who = e => e.cn ? `<button class="linkbtn cn name" data-act="cert" data-id="${e.certId}">${esc(e.cn)}</button>${e.serverId ? `<div class="sub">${esc(srv(e.serverId).name)} · ${esc(srv(e.serverId).zone)}</div>` : ''}`
    : e.serverId ? `<div class="cn name">${esc(srv(e.serverId).name)}</div><div class="sub">whole server · ${esc(srv(e.serverId).zone)}</div>` : '<span class="muted">whole run</span>';
  function errRows() {
    const list = errList(), body = $('#err-body'); if (!body) return;
    $('#err-count').textContent = `${list.length} of ${S.errors.length} records`;
    for (const [id, f] of [['open', e => e.status === 'open'], ['fail', e => e.status === 'open' && e.severity === 'error'], ['res', e => e.status === 'resolved']]) $('#err-n-' + id).textContent = S.errors.filter(f).length;
    body.innerHTML = list.slice(0, 200).map(e => `<tr><td class="nowrap"><span class="mono">${e.id}</span><div class="sub">${e.severity === 'blocked' ? pill('Blocked', 'amber') : pill('Failure', 'red')}</div></td>
      <td class="nowrap">${A.rel(e.lastSeen)}<div class="sub">first ${A.fmtDT(e.ts)}</div></td><td>${pill(e.stage, 'blue')}<div class="sub">${esc(e.step ? 'step: ' + e.step : '')}</div></td><td>${who(e)}</td>
      <td class="msg"><span class="mono">${esc(e.code)}</span><div style="margin-top:3px">${esc(e.message)}</div><div class="sub" style="margin-top:3px">${esc(e.outcome)}</div></td><td class="right">${e.count}×</td>
      <td>${e.status === 'open' ? pill('Open', e.severity === 'blocked' ? 'amber' : 'red') : pill('Resolved', 'green') + `<div class="sub">${esc(e.resolvedBy || '')}</div>`}</td>
      <td class="nowrap right"><button class="btn sm" data-act="err-detail" data-id="${e.id}">Details</button> <button class="btn sm ${e.status === 'open' ? 'good' : ''}" data-act="err-toggle" data-id="${e.id}">${e.status === 'open' ? 'Resolve' : 'Reopen'}</button></td></tr>`).join('')
      || `<tr><td colspan="8" class="empty">${S.errors.length ? 'No records match these filters.' : 'No errors recorded. Every stage of every run writes here when something goes wrong.'}</td></tr>`;
  }
  A.views.errors = {
    render() {
      const qt = (id, lbl, color, hint, set) => tile(lbl, `<span id="err-n-${id}">0</span>`, color, hint, `data-act="err-quick" data-set="${set}"`);
      return `<div class="card"><h3>Error table</h3><div class="sub" style="margin-bottom:0">Every problem from any stage of a run is recorded here with the stage and step where it happened, an error code, the certificate and server, what happened to the server and how to fix it. The same open problem seen again raises its count instead of adding a row.</div></div>
        <div class="kpis wide">${qt('open', 'Open', 'red', 'need a look', 'open,')}${qt('fail', 'Failures', 'red', 'a step went wrong', 'open,error')}${qt('res', 'Resolved', 'green', 'fixed or renewed since', 'resolved,')}</div>
        <div class="card ap-card"><div class="toolbar flat"><input class="input grow" id="err-q" placeholder="Search error ID, code, message, certificate, server, run or job…" value="${esc(E.q)}">
            <select class="input" data-er="stage">${opt('', 'All stages', E.stage)}${STAGE_NAMES.map(s => opt(s, s, E.stage)).join('')}</select>
            
            <select class="input" data-er="status">${opt('', 'Open and resolved', E.status)}${opt('open', 'Open', E.status)}${opt('resolved', 'Resolved', E.status)}</select>
            <button class="btn" data-act="err-reset">Reset</button><button class="btn" data-act="err-export">${icon('download')}Export CSV</button></div>
          <div class="tablewrap flat"><table><thead><tr><th>Error</th><th>Last seen</th><th>Stage</th><th>Certificate or server</th><th>Code, message and what happened</th><th class="right">Seen</th><th>Status</th><th class="right">Actions</th></tr></thead><tbody id="err-body"></tbody></table></div>
          <div class="ap-foot muted" id="err-count"></div></div>`;
    },
    after() { errRows(); $('#err-q').addEventListener('input', e => { E.q = e.target.value; errRows(); }); },
    live() { errRows(); },
  };
  function errDetail(id) {
    const e = S.errors.find(x => x.id === id); if (!e) return;
    A.openModal(`<div class="row spread"><h3 class="mono">${e.id}</h3><button class="btn sm" data-act="close-layer">Close</button></div>
      <div class="row" style="margin:8px 0">${e.severity === 'blocked' ? pill('Blocked', 'amber') : pill('Failure', 'red')}${e.status === 'open' ? pill('Open', 'red') : pill('Resolved', 'green')}${pill(e.stage, 'blue')}</div>
      <dl class="kv"><dt>Code</dt><dd class="mono">${esc(e.code)}</dd><dt>Message</dt><dd style="word-break:normal">${esc(e.message)}</dd><dt>Stage and step</dt><dd>${esc(e.stage)}${e.step ? ' · ' + esc(e.step) : ''}</dd><dt>Certificate</dt><dd>${esc(e.cn || 'whole server')}</dd>
        <dt>Server</dt><dd>${e.serverId ? esc(srv(e.serverId).name) + ' (' + esc(srv(e.serverId).host) + ')' : '—'}</dd><dt>What happened</dt><dd style="word-break:normal">${esc(e.outcome || '—')}</dd><dt>First seen</dt><dd>${A.fmtDT(e.ts)} UTC</dd><dt>Last seen</dt><dd>${A.fmtDT(e.lastSeen)} UTC · seen ${e.count}×</dd>
        <dt>Run</dt><dd class="mono">${esc(e.runId || '—')}</dd><dt>Job</dt><dd class="mono">${esc(e.jobId || '—')}</dd>${e.status === 'resolved' ? `<dt>Resolved</dt><dd style="word-break:normal">${A.fmtDT(e.resolvedAt)} UTC by ${esc(e.resolvedBy)}${e.note ? '<br>' + esc(e.note) : ''}</dd>` : ''}</dl>
      <div class="banner info"><div><b>How to fix it:</b> ${esc(FIX[e.code] || 'Open the certificate for details, then renew it again from Certificate journey.')}</div></div>
      ${e.status === 'open' ? `<div class="form"><label>Resolution note (optional)<input class="input" id="err-note" placeholder="What was done to fix it"></label></div>` : '<div style="height:14px"></div>'}
      <div class="row" style="justify-content:flex-end">${e.certId ? `<button class="btn" data-act="journey-open" data-id="${e.certId}">${icon('route')}Show journey</button>` : ''}${/^CA_/.test(e.code) ? `<button class="btn" data-act="nav" data-v="setup">${icon('gear')}Automation setup</button>` : ''}
        <button class="btn ${e.status === 'open' ? 'primary' : ''}" data-act="err-toggle" data-id="${e.id}">${e.status === 'open' ? 'Mark resolved' : 'Reopen'}</button></div>`);
  }
  A.errDetail = errDetail;
  document.addEventListener('change', e => { const k = e.target.dataset.er; if (k) { E[k] = e.target.value; errRows(); } });
  Object.assign(A.handlers, {
    'err-detail': el => errDetail(el.dataset.id),
    'err-toggle': el => {
      const e = S.errors.find(x => x.id === el.dataset.id); if (!e) return; const note = $('#err-note') ? $('#err-note').value.trim() : '';
      if (e.status === 'open') Object.assign(e, { status: 'resolved', resolvedAt: Date.now(), resolvedBy: S.settings.actor, note }); else Object.assign(e, { status: 'open', resolvedAt: null, resolvedBy: null });
      A.audit(e.status === 'open' ? 'error.reopened' : 'error.resolved', e.id, { code: e.code, note }); A.toast(`${e.id} ${e.status === 'open' ? 'reopened' : 'marked resolved'}`, 'ok'); A.closeLayer(); A.save(); A.renderNav(); errRows();
    },
    'err-quick': el => { const [status, sev] = el.dataset.set.split(','); Object.assign(E, { status, sev, stage: '', q: '' }); A.renderView(); },
    'err-reset': () => { Object.assign(E, { q: '', stage: '', sev: '', status: '' }); A.renderView(); },
    'err-export': () => { A.exportCsv('cdm-errors.csv', [['error_id', 'first_seen', 'last_seen', 'times_seen', 'severity', 'status', 'stage', 'step', 'code', 'message', 'certificate', 'server', 'what_happened', 'run', 'job', 'resolved_at', 'resolved_by', 'note'],
      ...errList().map(e => [e.id, A.fmtDT(e.ts), A.fmtDT(e.lastSeen), e.count, e.severity, e.status, e.stage, e.step, e.code, e.message, e.cn, e.serverId ? srv(e.serverId).name : '', e.outcome, e.runId, e.jobId, e.resolvedAt ? A.fmtDT(e.resolvedAt) : '', e.resolvedBy || '', e.note])]); A.toast('CSV exported', 'ok'); },
    'err-find': el => { const e = S.errors.find(x => x.certId === el.dataset.cert && x.code === el.dataset.code); Object.assign(E, { q: '', stage: '', sev: '', status: '' }); A.go('errors'); if (e) setTimeout(() => errDetail(e.id), 80); },
  });
})();
