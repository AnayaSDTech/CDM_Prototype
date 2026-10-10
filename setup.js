/* CDM prototype - Automation setup: select root and issuing CAs, review, schedule, start. Afterwards: status, pipeline flow, update options. */
(function () {
  'use strict';
  const A = window.CDM_APP, S = A.S, $ = A.$, esc = A.esc, icon = A.icon, opt = A.opt;
  const STEPS = [['Configuration', 'Set your automation settings'], ['Review', 'Check your configuration'], ['Schedule', 'Define when to run'], ['Complete', 'Automation will be started']];
  const FLOW = [['Discover', 'scan, window & CA'], ['Landing', 'key, CSR, certificate'], ['Match', 'identity checks'], ['Plan', 'deployment jobs'], ['Deploy', 'backup · install'], ['Confirm', 're-login & verify'], ['Retire', 'remove replaced']];
  const INCOMPLETE = 'Select a Root CA and an Issuing CA in every row to continue.';
  const clone = o => JSON.parse(JSON.stringify(o));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // Everything the wizard and the two "update" forms change is held in a draft until it is started or saved.
  // draft.rows is the Configuration step: one { rootId, issuerId } pair per row.
  const W = A.W = { step: 1, edit: null, err: '', focus: '', draft: null, reset() { Object.assign(W, { step: 1, edit: null, err: '', focus: '', draft: null }); } };
  A.setupDraft = () => {
    const su = S.setup, rows = su.selIssuers.map(id => su.issuers.find(i => i.id === id)).filter(Boolean).map(i => ({ rootId: i.rootId, issuerId: i.id }));
    return { roots: clone(su.roots), issuers: clone(su.issuers), selRoots: [...su.selRoots], selIssuers: [...su.selIssuers], rows: rows.length ? rows : [{ rootId: '', issuerId: '' }], schedule: { ...S.schedule }, firstRun: 'now' };
  };
  const draft = () => W.draft || (W.draft = A.setupDraft());
  // Store the CA selection; certificates it now allows lose their "blocked" records.
  A.setupCommit = d => {
    Object.assign(S.setup, { roots: clone(d.roots), issuers: clone(d.issuers), selRoots: [...d.selRoots], selIssuers: [...d.selIssuers] });
    const n = A.resolveErrors(x => x.severity === 'blocked' && x.certId && A.certById(x.certId) && A.caVerdict(A.certById(x.certId)).ok, S.settings.actor, 'Automation setup changed: the certificate is allowed now');
    S.certs.forEach(c => { if (c.lastError && /automation setup/.test(c.lastError) && A.caVerdict(c).ok) c.lastError = null; });
    A.audit('setup.config_changed', 'ca-selection', { rootCAs: d.selRoots.length, issuingCAs: d.selIssuers.length }); A.save(); return n;
  };
  const dueNow = () => S.certs.filter(c => { const s = A.srv(c.serverId); return c.managed && A.isDue(c) && !c.paused && !s.paused && s.status !== 'unreachable'; });

  // ------------------------------------------------------------------ Configuration step: rows of Root CA + Issuing CA
  const complete = d => d.rows.length > 0 && d.rows.every(r => r.rootId && r.issuerId);
  const sync = d => { const full = d.rows.filter(r => r.rootId && r.issuerId); d.selIssuers = [...new Set(full.map(r => r.issuerId))]; d.selRoots = [...new Set(full.map(r => r.rootId))]; };
  // One root CA can have several issuing CAs: pick the same root in another row to add the next one.
  // An issuing CA is offered in one row only, and a root is greyed out once every issuing CA under it is used.
  const freeIssuers = (d, rootId, i) => d.issuers.filter(x => x.rootId === rootId && !d.rows.some((r, k) => k !== i && r.issuerId === x.id));
  function rowHtml(d, r, i) {
    const list = r.rootId ? freeIssuers(d, r.rootId, i) : [];
    const rootOpt = x => { const used = x.id !== r.rootId && !freeIssuers(d, x.id, i).length; return `<option value="${x.id}" ${x.id === r.rootId ? 'selected' : ''} ${used ? 'disabled' : ''}>${esc(x.name)}${used ? ' (all Issuing CAs added)' : ''}</option>`; };
    return `<div class="ca-row"><select class="input" data-row="${i}" data-f="rootId" aria-label="Root CA, row ${i + 1}">${opt('', 'Select Root CA', r.rootId)}${d.roots.map(rootOpt).join('')}</select>
      <select class="input" data-row="${i}" data-f="issuerId" aria-label="Issuing CA, row ${i + 1}" ${list.length ? '' : 'disabled'}>${opt('', !r.rootId ? 'Select a Root CA first' : list.length ? 'Select Issuing CA' : 'No Issuing CA under this Root CA', r.issuerId)}${list.map(x => opt(x.id, esc(x.name), r.issuerId)).join('')}</select>
      <button type="button" class="btn sm" data-act="row-del" data-i="${i}" aria-label="Remove row ${i + 1}">Remove</button></div>`;
  }
  const stepConfig = () => { const d = draft(); return `<div class="ca-rows"><div class="ca-row ca-head"><b>Root CA</b><b>Issuing CA</b><span></span></div>${d.rows.map((r, i) => rowHtml(d, r, i)).join('')}</div>
    <button type="button" class="btn sm" data-act="row-add" style="margin-top:14px">+ Add another CA</button>`; };
  W.setRow = (i, field, value) => { const d = draft(), r = d.rows[i]; if (!r) return; r[field] = value; if (field === 'rootId') r.issuerId = ''; sync(d); W.err = ''; };

  // ------------------------------------------------------------------ Review and Schedule steps
  // The CA selection as a tree: each selected Root CA with its selected Issuing CAs, and how many certificates each one covers.
  // `su` is the automation setup or a draft of it; `certs` and `dueList` are the certificates (and the due ones) it covers.
  function caTree(su, certs, dueList) {
    const issuers = su.issuers.filter(i => su.selIssuers.includes(i.id));
    const row = i => { const n = certs.filter(c => c.ca === i.name).length, dn = dueList.filter(c => c.ca === i.name).length;
      return `<li><span class="rv-name">${esc(i.name)}</span><span class="rv-meta">${plural(n, 'certificate')}${dn ? ` · <b>${dn} due</b>` : ''}</span></li>`; };
    return su.roots.filter(r => su.selRoots.includes(r.id)).map(r => `<div class="rv-ca"><div class="rv-root"><span class="rv-tag">Root CA</span><b>${esc(r.name)}</b></div><ul>${issuers.filter(i => i.rootId === r.id).map(row).join('')}</ul></div>`).join('') || '<div class="muted">No CA selected.</div>';
  }
  // Review step: the selection as a Root CA > Issuing CA tree, and a preview of what the first run would do. Nothing has run yet.
  function stepReview() {
    const d = draft(), ok = c => A.caVerdict(c, d).ok, due = dueNow(), inScope = due.filter(ok), out = due.filter(c => !ok(c)), scoped = S.certs.filter(ok), byIssuer = {};
    const wait = inScope.filter(c => c.state === 'Review' || (c.type !== 'DV' && S.settings.approveOvEv && !c.approved)), auto = inScope.length - wait.length;
    out.forEach(c => { byIssuer[c.ca] = (byIssuer[c.ca] || 0) + 1; });
    const roots = d.roots.filter(r => d.selRoots.includes(r.id)), issuers = d.issuers.filter(i => d.selIssuers.includes(i.id));
    const stat = (n, label, hint) => `<div class="rv-stat"><div class="rv-num">${n}</div><div><b>${label}</b><small>${hint}</small></div></div>`;
    const outcome = (n, color, title, text) => `<div class="rv-out" style="--c:var(--${color})"><div class="rv-num">${n}</div><div><b>${title}</b><small>${text}</small></div></div>`;
    const total = Math.max(1, due.length), seg = (n, color) => (n ? `<i style="width:${n / total * 100}%;background:var(--${color})"></i>` : '');
    return `<div class="rv-stats">${stat(roots.length, roots.length === 1 ? 'Root CA' : 'Root CAs', 'selected')}${stat(issuers.length, issuers.length === 1 ? 'Issuing CA' : 'Issuing CAs', 'selected')}${stat(scoped.length, scoped.length === 1 ? 'Certificate' : 'Certificates', 'issued by the selected CAs')}${stat(inScope.length, 'Due for renewal', `inside the ${S.settings.windowDays}-day renewal window`)}</div>
      <div class="rv-cols"><section class="rv-panel"><div class="rv-head"><div><h4>Certificate authorities</h4><small>CDM shows and renews only certificates issued by these CAs.</small></div><button type="button" class="btn sm" data-act="wz-back">Edit selection</button></div>
          ${caTree(d, scoped, inScope)}</section>
        <section class="rv-panel"><div class="rv-head"><div><h4>When automation starts</h4><small>A preview based on the certificates on your servers today. Nothing has run yet.</small></div></div>
          <div class="rv-bar" role="img" aria-label="${auto} renew automatically, ${wait.length} need approval, ${out.length} not included">${seg(auto, 'green')}${seg(wait.length, 'amber')}${seg(out.length, 'faint')}</div>
          ${outcome(auto, 'green', 'Renew automatically', 'Replaced and deployed when every check passes.')}
          ${outcome(wait.length, 'amber', 'Need approval', 'Wait under Approvals for a decision before they are replaced.')}
          ${outcome(out.length, 'faint', 'Not included', out.length ? `Due, but issued by a CA that is not selected: ${Object.entries(byIssuer).map(([n, c]) => `${esc(n)} (${c})`).join(', ')}.` : 'Every due certificate comes from a selected CA.')}</section></div>`;
  }
  function stepSchedule(first) {
    const s = draft().schedule, hours = Array.from({ length: 24 }, (_, h) => opt(String(h), String(h).padStart(2, '0') + ':00', String(s.hour))).join('');
    const field = (label, html) => `<label class="wz-field"><b>${label}</b>${html}</label>`;
    return `<div class="wz-grid three">${field('Frequency', `<select class="input" data-wz="freq">${opt('daily', 'Daily', s.freq)}${opt('weekly', 'Weekly', s.freq)}${opt('monthly', 'Monthly', s.freq)}</select>`)}
        ${s.freq === 'weekly' ? field('Day of the week', `<select class="input" data-wz="dow">${A.DOW.map((n, i) => opt(String(i), n, String(s.dow))).join('')}</select>`) : ''}
        ${s.freq === 'monthly' ? field('Day of the month', `<select class="input" data-wz="dom">${Array.from({ length: 28 }, (_, i) => opt(String(i + 1), String(i + 1), String(s.dom))).join('')}</select>`) : ''}
        ${field('Start time', `<select class="input" data-wz="hour">${hours}</select>`)}
        ${first ? field('First run', `<select class="input" data-wz="firstRun">${opt('now', 'Right after setup', draft().firstRun)}${opt('later', 'At the next scheduled time', draft().firstRun)}</select>`) : ''}</div>
      <p class="muted wz-hint">${A.scheduleText(s)}. Next scheduled run: ${A.fmtDT(A.scheduleNext(s).getTime())} UTC.</p>`;
  }

  // ------------------------------------------------------------------ page
  const stepper = at => `<ol class="wz-steps">${STEPS.map(([t, sub], i) => `<li class="wz-step ${i + 1 < at ? 'done' : i + 1 === at ? 'on' : ''}" ${i + 1 === at ? 'aria-current="step"' : ''}><span class="wz-dot">${i + 1 < at ? '✓' : i + 1}</span><b>${t}</b><small>${sub}</small></li>`).join('')}</ol>`;
  // The step indicator belongs to the start setup only (steps 1-3); once automation is set up, the header stands alone.
  const head = (title, sub, at) => `<div class="card"><div class="wz-head ${at ? '' : 'solo'}">${icon('gear')}<div><h2>${title}</h2><div class="muted">${sub}</div></div></div>${at ? stepper(at) : ''}</div>`;
  const foot = (note, buttons) => `<div class="wz-foot"><div class="wz-note">${W.err ? `<span style="color:var(--red)">${esc(W.err)}</span>` : note}</div><div class="row">${buttons}</div></div>`;
  const CONFIG_SUB = 'Choose the Root CAs and Issuing CAs automation may renew from. Nothing is selected for you: pick a Root CA and an Issuing CA, then use <b>Add another CA</b> to include more. A Root CA can have several Issuing CAs: add a row for each.';
  const dirty = d => [...d.selIssuers].sort().join() !== [...S.setup.selIssuers].sort().join();
  const configNote = () => { const d = draft(); return !complete(d) ? INCOMPLETE : dirty(d) ? `<b style="color:var(--amber)">Not applied yet.</b> Press <b>${W.edit ? 'Save changes' : 'Next'}</b> to apply this selection.` : '<b>Note:</b> CDM shows and renews only certificates issued by the selected CAs. Certificates of other CAs are left out.'; };
  function liveHtml() {
    const R = A.RUN, on = !!R && ['running', 'paused', 'stopping'].includes(R.status), paused = !S.schedule.enabled, at = on ? R.st.indexOf('active') : -1;
    const last = S.audit.slice().reverse().find(e => e.type === 'run.finished');
    const stopped = S.killSwitch;
    const state = stopped ? ['red', 'Automation is stopped', 'Emergency stop is active. No run starts until you resume it.'] : paused ? ['amber', 'Automation is paused', 'No scheduled run starts until you resume the schedule.']
      : on ? ['green', 'Automation is running', `Run ${esc(R.id)} is in progress.`] : ['green', 'Automation is running', `${A.scheduleText()} · next run ${A.untilText(A.scheduleNext())}`];
    return `<div class="card au-card"><div class="wz-head solo">${icon('gear')}<div><h2>CDM Automation</h2><div class="muted">Discovers, renews and deploys certificates from the selected CAs on a schedule.</div></div></div>
        <div class="au-side"><div class="au-status" style="--c:var(--${state[0]})"><span class="dot ${stopped ? 'red' : paused ? 'amber' : 'pulse'}"></span><div><b>${state[1]}</b><small>${state[2]}</small></div></div>
          ${stopped ? `<div class="row"><button class="btn sm good" data-act="automation-resume">${icon('play')}Resume automation</button><button class="btn sm danger" data-act="automation-terminate">${icon('power')}Terminate automation</button></div>` : ''}</div></div>
      <div class="card"><div class="row spread" style="margin-bottom:4px"><h3 style="font-size:1.05rem">Pipeline flow</h3>${on ? `<button class="btn sm danger" data-act="run-stop" ${R.status === 'stopping' ? 'disabled' : ''}>${icon('stop')}${R.status === 'stopping' ? 'Stopping…' : 'Stop run'}</button>` : ''}</div>
        <div class="sub">${on && R.status === 'stopping' ? `Run ${esc(R.id)} is stopping: jobs already in flight finish or roll back, nothing new starts.` : on ? `Run ${esc(R.id)} is in progress${at >= 0 ? ': ' + FLOW[at][0] : ''}.` : last ? `Every run goes through these seven stages. Last run finished ${A.rel(last.ts)}${last.detail.problems ? ` with ${plural(last.detail.problems, 'problem')} recorded in the Error table` : ' without problems'}.` : 'Every run goes through these seven stages. Waiting for the first run.'}</div>
        <div class="stages">${FLOW.map(([t, s], i) => { const st = R ? R.st[i] : ''; return `<div class="stage ${st === 'pending' ? '' : st}"><div class="n">${st === 'done' ? '✓' : st === 'error' ? '!' : i + 1}</div><b>${t}</b><small>${s}</small></div>`; }).join('')}</div></div>`;
  }
  function doneHtml() {
    const su = S.setup, certs = A.certs(), due = dueNow().filter(c => A.caVerdict(c).ok), issuers = su.issuers.filter(i => su.selIssuers.includes(i.id));
    const kv = (k, v) => `<div class="cf-kv"><span>${k}</span><b>${v}</b></div>`;
    const sc = S.schedule, on = sc.enabled && !S.killSwitch, next = A.scheduleNext(), last = S.audit.slice().reverse().find(e => e.type === 'run.finished');
    // one row per Root CA: its Issuing CAs, and how many certificates they cover
    const caRow = r => { const mine = issuers.filter(i => i.rootId === r.id), names = mine.map(i => i.name), n = certs.filter(c => names.includes(c.ca)).length, dn = due.filter(c => names.includes(c.ca)).length;
      return `<div class="cf-row"><b>${esc(r.name)}</b><span>${mine.map(i => `<i>${esc(i.name)}</i>`).join('')}</span><span class="rv-meta">${n}${dn ? ` · <b>${dn} due</b>` : ''}</span></div>`; };
    return `<div id="su-live" class="wz-live">${liveHtml()}</div>
      <div class="cf-cols"><div class="card cf-card"><div class="cf-head"><h3>Configuration settings</h3><button class="btn sm" data-act="setup-edit" data-k="config">${icon('gear')}Update CA selection</button></div>
          <div class="cf-list cf-table"><div class="cf-row cf-th"><span>Root CA</span><span>Issuing CA</span><span>Certificates</span></div>${su.roots.filter(r => su.selRoots.includes(r.id)).map(caRow).join('')}</div></div>
        <div class="card cf-card"><div class="cf-head"><h3>Schedule</h3><div class="row"><button class="btn sm primary" data-act="auto-run" ${S.killSwitch ? 'disabled' : ''}>${icon('play')}Run now</button><button class="btn sm" data-act="toggle-schedule">${sc.enabled ? 'Pause' : 'Resume'}</button><button class="btn sm" data-act="setup-edit" data-k="schedule">${icon('history')}Update schedule</button></div></div>
          <div class="cf-list">${kv('Status', A.pill(on ? 'Active' : S.killSwitch ? 'Stopped' : 'Paused', on ? 'green' : S.killSwitch ? 'red' : 'amber'))}${kv('Runs', esc(A.scheduleText()))}${kv('Next run', on ? `${A.fmtDT(next.getTime())} UTC · ${A.untilText(next)}` : '—')}${kv('Last run', last ? `${A.rel(last.ts)}${last.detail.problems ? ` · ${plural(last.detail.problems, 'problem')}` : ' · no problems'}` : 'No run yet')}</div></div></div>`;
  }
  const editHtml = () => W.edit === 'config'
    ? `${head('Update configuration settings', 'Change which root and issuing CAs automation may renew from. It applies from the next run.', 0)}<div class="card"><h3>Configuration setup</h3><div class="sub">${CONFIG_SUB}</div>${stepConfig()}
        ${foot(configNote(), `<button class="btn" data-act="setup-cancel">Cancel</button><button class="btn primary" data-act="setup-save" ${complete(draft()) ? '' : 'disabled'}>Save changes</button>`)}</div>`
    : `${head('Update schedule', 'Change when automation runs. It applies from the next scheduled run.', 0)}<div class="card"><h3>Schedule</h3><div class="sub">Define when the pipeline runs.</div>${stepSchedule(false)}
        ${foot('<b>Note:</b> A run that is already in progress is not affected.', '<button class="btn" data-act="setup-cancel">Cancel</button><button class="btn primary" data-act="setup-save">Save changes</button>')}</div>`;
  function wizardHtml() {
    const body = [['Configuration setup', CONFIG_SUB, stepConfig], ['Review', 'Check the selection before you continue.', stepReview], ['Schedule', 'Define when the pipeline runs.', () => stepSchedule(true)]][W.step - 1];
    const note = W.step === 1 ? configNote() : '<b>Note:</b> Automation only renews certificates issued by the selected CAs and deploys them when every check passes.';
    const next = W.step < 3 ? `<button class="btn primary" data-act="wz-next" ${W.step === 1 && !complete(draft()) ? 'disabled' : ''}>Next</button>` : `<button class="btn primary" data-act="wz-start">${icon('play')}Start automation</button>`;
    return `${head('CDM Automation – Start Setup', 'Configure and activate automation to discover, renew and deploy certificates based on your defined settings.', W.step)}
      <div class="card"><h3>${body[0]}</h3><div class="sub">${body[1]}</div>${body[2]()}${foot(note, `<button class="btn" data-act="wz-back" ${W.step > 1 ? '' : 'disabled'}>Back</button>${next}`)}</div>`;
  }
  A.views.setup = {
    render() { return `<div class="wz">${W.edit ? editHtml() : S.setup.done ? doneHtml() : wizardHtml()}</div>`; },
    after() { const f = W.focus && $(W.focus); if (f) f.focus({ preventScroll: true }); W.focus = ''; },
    live() { A.put($('#su-live'), liveHtml()); },
  };

  // ------------------------------------------------------------------ behaviour
  const redraw = focus => { W.focus = focus || ''; if (A.view() === 'setup') A.renderView(); };
  const configError = d => (complete(d) ? '' : INCOMPLETE);
  document.addEventListener('change', e => {
    const t = e.target.dataset;
    if (t.row != null) { W.setRow(+t.row, t.f, e.target.value); return redraw(`[data-row="${t.row}"][data-f="${t.f === 'rootId' && e.target.value ? 'issuerId' : t.f}"]`); }
    if (!t.wz) return; const d = draft();
    if (t.wz === 'firstRun') d.firstRun = e.target.value; else d.schedule[t.wz] = t.wz === 'freq' ? e.target.value : +e.target.value;
    redraw(`[data-wz="${t.wz}"]`);
  });
  Object.assign(A.handlers, {
    'row-add': () => { const d = draft(); d.rows.push({ rootId: '', issuerId: '' }); W.err = ''; redraw(`[data-row="${d.rows.length - 1}"][data-f="rootId"]`); },
    'row-del': el => { const d = draft(); d.rows.splice(+el.dataset.i, 1); if (!d.rows.length) d.rows.push({ rootId: '', issuerId: '' }); sync(d); W.err = ''; redraw('[data-act="row-add"]'); },
    'wz-next': () => { W.err = W.step === 1 ? configError(draft()) : ''; if (!W.err) { if (W.step === 1 && dirty(draft())) A.setupCommit(draft()); W.step++; } redraw(); window.scrollTo(0, 0); },   // leaving step 1 applies the CA selection
    'wz-back': () => { W.err = ''; W.step = Math.max(1, W.step - 1); redraw(); window.scrollTo(0, 0); },
    'wz-start': () => {
      const d = draft(); W.err = configError(d); if (W.err) { W.step = 1; return redraw(); }
      A.setupCommit(d); Object.assign(S.schedule, d.schedule, { enabled: true }); Object.assign(S.setup, { done: true, completedAt: Date.now() });
      A.audit('setup.completed', 'automation', { schedule: A.scheduleText(), firstRun: d.firstRun }); W.reset(); A.save(); A.render(); A.toast('Automation is running', 'ok'); window.scrollTo(0, 0);
      if (d.firstRun === 'now') A.runPipeline();
    },
    'setup-edit': el => { W.reset(); W.edit = el.dataset.k; redraw(); window.scrollTo(0, 0); },
    'setup-cancel': () => { W.reset(); redraw(); },
    'setup-save': () => {
      const d = draft();
      if (W.edit === 'config') { W.err = configError(d); if (W.err) return redraw(); const n = A.setupCommit(d); A.toast(n ? `CA selection saved. ${plural(n, 'blocked certificate')} will renew on the next run` : 'CA selection saved', 'ok'); }
      else { Object.assign(S.schedule, d.schedule, { enabled: S.schedule.enabled }); A.audit('schedule.changed', 'automation', { schedule: A.scheduleText() }); A.save(); A.toast('Schedule saved: ' + A.scheduleText(), 'ok'); }
      W.reset(); A.render();
    },
  });
})();
