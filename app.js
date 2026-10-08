/* CDM prototype - core: state, shared UI, and the dashboard / certificates / jobs / approvals / audit / policy views. */
(function () {
  'use strict';
  const D = window.CDM_DATA, DAY = D.DAY, HOUR = D.HOUR, KEY = 'cdm-prototype-v1';
  const A = window.CDM_APP = { D, views: {}, handlers: {}, RUN: null, SC: null, live: new Set() };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  Object.assign(A, { $, esc, uid });

  // ------------------------------------------------------------------ state
  const DEFAULTS = { windowDays: 30, maxPerRun: 25, maxParallel: 5, canary: true, stopOnFailure: true, approveOvEv: true, autoEnrol: true,
    autoInstallAdapter: true, acmeEnv: 'staging', speed: 'normal', failNext: false, caOutage: false, actor: 'a.sharma@pki-ops' };
  function pushEvent(s, e) {
    const prev = s.audit.length ? s.audit[s.audit.length - 1].hash : '0'.repeat(64);
    const ev = { seq: s.audit.length + 1, ts: e.ts, type: e.type, target: e.target, actor: e.actor, detail: e.detail || {}, prev };
    ev.hash = D.eventHash(prev, ev); s.audit.push(ev); return ev;
  }
  function fresh() {
    const seed = D.buildSeed();
    const s = { v: 1, theme: 'dark', servers: seed.servers, certs: seed.certs, jobs: seed.jobs, backups: seed.backups, weekly: seed.weekly,
      audit: [], settings: { ...DEFAULTS }, killSwitch: false, schedule: { enabled: true, hour: 2 },
      db: { outage: false, pending: 0, rows: { certificates_seen: seed.certs.length * 14, audit_events: 0, deployment_jobs: seed.jobs.length, acme_issuance: 61 } } };
    seed.events.forEach(e => pushEvent(s, e)); s.db.rows.audit_events = s.audit.length;
    return s;
  }
  function load() { try { const o = JSON.parse(localStorage.getItem(KEY)); return o && o.v === 1 ? o : null; } catch (e) { return null; } }
  const S = A.S = load() || fresh();
  let saveT = 0;
  A.save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: demo still works */ } }, 150); };
  A.reset = () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } Object.keys(S).forEach(k => delete S[k]); Object.assign(S, fresh()); A.RUN = null; if (A.SC) Object.assign(A.SC, { running: false, results: null, errors: [], days: null, idx: -1, current: null }), A.SC.sel.clear(); A.render(); toast('Demo data reset to the original sample estate', 'ok'); };

  // ------------------------------------------------------------------ helpers
  const srv = A.srv = id => S.servers.find(s => s.id === id);
  const certById = A.certById = id => S.certs.find(c => c.id === id);
  const dleft = A.dleft = c => (c.notAfter - Date.now()) / DAY;
  const isDue = A.isDue = c => dleft(c) <= S.settings.windowDays;
  const status = A.status = c => { const d = dleft(c); return d < 0 ? 'expired' : d <= S.settings.windowDays ? 'expiring' : 'valid'; };
  const inel = A.inel = c => (c.ineligible === D.REASON.notdue ? null : c.ineligible);
  const fmtDate = A.fmtDate = ms => new Date(ms).toISOString().slice(0, 10);
  const fmtDT = A.fmtDT = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const fmtTime = A.fmtTime = ms => new Date(ms).toTimeString().slice(0, 8);
  const rel = A.rel = ms => { const m = Math.round((Date.now() - ms) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; };
  const short = A.short = (t, n = 16) => (t || '').slice(0, n) + '…';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  A.sleep = ms => { const f = { slow: .5, normal: 1, fast: 3, instant: 0 }[S.settings.speed]; return f ? new Promise(r => setTimeout(r, ms / f)) : Promise.resolve(); };
  A.dbWrite = (key, n = 1) => { if (S.db.outage) S.db.pending += n; else S.db.rows[key] = (S.db.rows[key] || 0) + n; };
  A.audit = (type, target, detail, actor) => { const ev = pushEvent(S, { ts: Date.now(), type, target, actor: actor || S.settings.actor, detail }); A.dbWrite('audit_events'); A.save(); return ev; };
  const icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-4"/>',
    flow: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6h4a4 4 0 014 4M7 18h4a4 4 0 004-4"/>',
    history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4"/><path d="M3 4v4h4M12 7v5l3 2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    play: '<path d="M7 4l13 8-13 8z"/>', pause: '<path d="M8 5v14M16 5v14"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    power: '<path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1011.2 0"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 114 2c-1 .8-1.5 1.2-1.5 2.5M12 17h.01"/>',
  };
  A.icon = icon;
  const pill = A.pill = (t, c) => `<span class="pill ${c || ''}">${esc(t)}</span>`;
  const STATUS_PILL = { valid: ['Valid', 'green'], expiring: ['Expiring', 'amber'], expired: ['Expired', 'red'] };
  const STATE_PILL = { Managed: 'blue', Discovered: '', Review: 'amber', Failed: 'red', Renewing: 'cyan' };
  const statePill = A.statePill = c => c.paused ? pill('Paused', 'purple') : pill(c.state, STATE_PILL[c.state]);
  const statusPill = c => pill(...STATUS_PILL[status(c)]);
  const JOB_PILL = s => pill(s, /^(Confirmed|Deployed)/.test(s) ? 'green' : /^Rolled/.test(s) ? 'amber' : /^(Failed)/.test(s) ? 'red' : /^(Running)/.test(s) ? 'cyan' : /^(Skipped|Cancelled)/.test(s) ? 'purple' : '');
  A.jobPill = JOB_PILL;
  const stepDots = (steps, order = ['precheck', 'backup', 'install', 'activate', 'verify']) => `<span class="steps" title="${order.map(k => k + ': ' + steps[k]).join(' · ')}">${order.map(k => `<i class="${steps[k]}"></i>`).join('')}</span>`;
  A.stepDots = stepDots;

  // ------------------------------------------------------------------ toasts / modal / drawer
  const toast = A.toast = (msg, kind = '') => {
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg; $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  };
  const layer = () => $('#layer');
  A.closeLayer = () => { layer().innerHTML = ''; };
  A.openModal = html => { layer().innerHTML = `<div class="scrim" data-act="close-layer"></div><div class="modal" role="dialog" aria-modal="true">${html}</div>`; };
  A.openDrawer = html => { layer().innerHTML = `<div class="scrim" data-act="close-layer"></div><aside class="drawer" role="dialog" aria-modal="true">${html}</aside>`; };
  A.confirm = ({ title, body, label = 'Confirm', danger = false, onYes }) => {
    A.openModal(`<h3>${esc(title)}</h3><div class="muted" style="margin:10px 0 20px">${body}</div><div class="row" style="justify-content:flex-end"><button class="btn" data-act="close-layer">Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" id="confirm-yes">${esc(label)}</button></div>`);
    $('#confirm-yes').onclick = () => { A.closeLayer(); onYes(); };
  };
  A.progress = async ({ title, intro = '', steps, failAt = -1, failMsg = '', stepMs = 650 }) => {
    const st = steps.map(() => 'pending');
    const paint = (done, msg) => A.openModal(`<h3>${esc(title)}</h3><p class="muted">${intro}</p>${steps.map((s, i) => `<div class="pstep ${st[i]}"><span class="ic">${st[i] === 'done' ? '✓' : st[i] === 'failed' ? '✕' : i + 1}</span><span>${esc(s)}</span></div>`).join('')}${msg ? `<p style="margin-top:14px">${msg}</p>` : ''}<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn primary" data-act="close-layer" ${done ? '' : 'disabled'}>${done ? 'Close' : 'Working…'}</button></div>`);
    paint(false);
    for (let i = 0; i < steps.length; i++) {
      st[i] = 'running'; paint(false); await A.sleep(stepMs);
      if (i === failAt) { st[i] = 'failed'; paint(true, `<span style="color:var(--red)">${esc(failMsg)}</span>`); return false; }
      st[i] = 'done';
    }
    paint(true, '<span style="color:var(--green)">Completed.</span>'); return true;
  };

  // ------------------------------------------------------------------ stats
  function stats() {
    const c = S.certs, st = { total: c.length, valid: 0, expiring: 0, expired: 0, managed: 0, review: 0, failed: 0, paused: 0, due: 0, unmanagedDue: 0 };
    for (const x of c) {
      st[status(x)]++; if (x.managed) st.managed++; if (x.state === 'Review') st.review++; if (x.state === 'Failed') st.failed++; if (x.paused) st.paused++;
      if (x.managed && isDue(x) && !x.paused) st.due++; if (!x.managed && isDue(x)) st.unmanagedDue++;
    }
    return st;
  }
  A.stats = stats;
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});

  // ------------------------------------------------------------------ chrome
  const NAV = [['overview', 'Overview', 'grid'], ['certificates', 'Certificates', 'shield'], ['servers', 'Servers', 'server'], ['scan', 'Scan', 'radar'], ['pipeline', 'Renewal pipeline', 'flow'],
    ['jobs', 'Jobs & rollback', 'history'], ['approvals', 'Approvals', 'check'], ['audit', 'Audit & compliance', 'link'], ['policies', 'Policies', 'sliders']];
  let view = 'overview';
  A.view = () => view;
  A.go = v => { location.hash = '#/' + v; };
  function renderNav() {
    const st = stats();
    $('#nav').innerHTML = NAV.map(([k, t, i]) => `<button class="nav ${view === k ? 'on' : ''}" data-act="nav" data-v="${k}">${icon(i)}<span>${t}</span>${k === 'approvals' && st.review ? `<span class="count">${st.review}</span>` : ''}</button>`).join('')
      + `<hr><button class="nav" data-act="guide">${icon('help')}<span>Demo guide</span></button><button class="nav" data-act="reset-demo">${icon('undo')}<span>Reset demo data</span></button><div class="foot">CDM v2.0 · prototype<br>Sample data, no real servers are touched.</div>`;
  }
  function renderTop() {
    const R = A.RUN, running = R && ['running', 'paused', 'stopping'].includes(R.status);
    const runChip = running ? `<span class="chip plain"><span class="dot ${R.status === 'paused' ? 'amber' : 'pulse'}"></span>Run ${esc(R.status)}</span>` : '';
    $('#top').innerHTML = `<div class="badge-logo">CDM</div><div><h1>Certificate Deployment Manager</h1><div class="tagline">Automated discovery, renewal, deployment and rollback across Linux, Windows and Java estates</div></div>
      <div class="actions">${runChip}
      <button class="btn" data-act="theme">${icon('sun')}Theme</button>
      <button class="btn ${S.killSwitch ? 'good' : 'danger'}" data-act="killswitch">${icon('power')}${S.killSwitch ? 'Resume renewals' : 'Emergency stop'}</button></div>`;
    $('#banners').innerHTML = S.killSwitch ? `<div class="banner">${icon('power')}<div><b>Emergency stop is active.</b> All renewals and deployments are frozen. Scans and reports still work.</div></div>` : '';
  }
  A.renderTop = renderTop; A.renderNav = renderNav;
  A.renderView = () => {
    const v = A.views[view] || A.views.overview;
    $('#view').innerHTML = v.render(); if (v.after) v.after();
  };
  A.render = () => { document.documentElement.dataset.theme = S.theme; renderTop(); renderNav(); A.renderView(); };
  let uiT = 0;
  A.ui = () => { if (uiT) return; uiT = setTimeout(() => { uiT = 0; renderTop(); renderNav(); const v = A.views[view]; if (v && v.live) v.live(); else if (v && A.live.has(view)) A.renderView(); }, 60); };
  function route() { const v = (location.hash.match(/^#\/(\w+)/) || [])[1]; view = A.views[v] ? v : 'overview'; A.closeLayer(); A.render(); window.scrollTo(0, 0); }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------------ charts
  function donut(segs, size, stroke, center) {
    const r = (size - stroke) / 2, C = 2 * Math.PI * r, total = segs.reduce((a, s) => a + s.v, 0) || 1; let off = 0;
    const arcs = segs.filter(s => s.v > 0).map(s => { const len = C * s.v / total; const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:${s.c}" stroke-width="${stroke}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>`; off += len; return el; }).join('');
    return `<div class="donut" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" style="stroke:var(--line)" stroke-width="${stroke}"/>${arcs}</svg><div class="center"><div>${center}</div></div></div>`;
  }
  const hbar = (label, v, max, color) => `<div class="hbar"><span>${esc(label)}</span><div class="bar"><i style="width:${max ? Math.max(2, v / max * 100) : 0}%;--c:${color}"></i></div><b class="right">${v}</b></div>`;
  const kpi = (lbl, num, color, hint, act, small) => `<${act ? 'button' : 'div'} class="kpi ${small ? 'small' : ''}" style="--c:${color}" ${act ? `data-act="kpi" data-k="${act}"` : ''}><div class="kpi-l"><div class="lbl">${lbl}</div><div class="hint">${hint || ''}</div></div><div class="num">${num}</div></${act ? 'button' : 'div'}>`;

  // ------------------------------------------------------------------ overview
  A.views.overview = {
    render() {
      const st = stats(), now = new Date(), w = S.settings.windowDays;
      const months = []; for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)); months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), n: 0 }); }
      let past = 0; S.certs.forEach(c => { const k = new Date(c.notAfter).toISOString().slice(0, 7), m = months.find(x => x.key === k); if (m) m.n++; else if (c.notAfter < Date.now()) past++; });
      const maxM = Math.max(1, ...months.map(m => m.n));
      const byType = count(S.certs, c => c.type), byOs = count(S.certs, c => { const s = srv(c.serverId); return s.tech === 'java_keystore' ? 'Java keystore' : s.os === 'windows' ? 'Windows' : 'Linux'; });
      const attention = S.certs.filter(c => status(c) === 'expired' || c.state === 'Failed' || c.state === 'Review' || (!c.managed && isDue(c))).sort((a, b) => a.notAfter - b.notAfter).slice(0, 8);
      const events = S.audit.slice(-5).reverse(), lastRun = S.audit.slice().reverse().find(e => e.type === 'run.finished');
      const next = new Date(); next.setHours(S.schedule.hour, 0, 0, 0); if (next < new Date()) next.setDate(next.getDate() + 1);
      const mins = Math.round((next - new Date()) / 60000);
      return `
      <div class="card hero"><div><h2>Certificate compliance at a glance</h2><p>Monitor lifecycle health, find expiring assets across every server, and renew, deploy and roll back without leaving this screen.</p>
        <div class="meta">Scope: <b>${S.servers.length} servers</b> · Renewal window: <b>${w} days</b> · Generated: <b>${fmtDT(Date.now())} UTC</b></div>
        <div class="row" style="margin-top:18px"><button class="btn primary" data-act="run-now">${icon('play')}Run renewal pipeline</button></div></div>
        <div class="donut-wrap">${donut([{ v: st.valid, c: 'var(--green)' }, { v: st.expiring, c: 'var(--amber)' }, { v: st.expired, c: 'var(--red)' }], 190, 24, `${st.total}<small>CERTIFICATES</small>`)}
        <div class="legend"><div><span class="sw" style="background:var(--green)"></span>Valid<b>${st.valid}</b></div><div><span class="sw" style="background:var(--amber)"></span>Expiring<b>${st.expiring}</b></div><div><span class="sw" style="background:var(--red)"></span>Expired<b>${st.expired}</b></div><div class="muted" style="margin-top:6px">${Math.round(st.valid / st.total * 100)}% compliant</div></div></div></div>
      <div class="kpis">${kpi('Total discovered', st.total, 'var(--cyan)', `${S.servers.length} servers scanned`, 'all')}${kpi('Valid', st.valid, 'var(--green)', 'outside the renewal window', 'valid')}${kpi('Expiring soon', st.expiring, 'var(--amber)', `within ${w} days`, 'expiring')}${kpi('Expired', st.expired, 'var(--red)', 'needs immediate action', 'expired')}</div>
      <div class="grid g21"><div class="card fc"><h3>Expiry forecast · next 12 months</h3><div class="sub">Click a month to list those certificates${past ? ` · ${past} already expired` : ''}</div>
        <div class="bars">${months.map((m, i) => `<button class="b" data-act="month" data-k="${m.key}" title="${m.n} expiring in ${m.label}"><span class="v">${m.n}</span><div class="col" style="height:${m.n / maxM * 78 + 2}%;--c:${i === 0 ? 'var(--amber)' : 'var(--blue)'}"></div><small>${m.label}</small></button>`).join('')}</div></div>
        <div class="grid" style="align-content:stretch;grid-template-rows:1fr 1fr"><div class="card"><h3>By certificate type</h3><div class="sub">DV is renewed automatically via ACME</div>${['DV', 'OV', 'EV'].map(k => hbar(k, byType[k] || 0, st.total, k === 'DV' ? 'var(--cyan)' : k === 'OV' ? 'var(--purple)' : 'var(--amber)')).join('')}</div>
        <div class="card"><h3>By platform</h3><div class="sub">One pipeline, three technologies</div>${Object.entries(byOs).map(([k, v]) => hbar(k, v, st.total, k === 'Linux' ? 'var(--green)' : k === 'Windows' ? 'var(--blue)' : 'var(--amber)')).join('')}</div></div></div>
      <div class="grid g21"><div class="card"><h3>Needs attention</h3><div class="sub">Expired, failed, awaiting approval, or unmanaged and due</div>
        <div class="tablewrap" style="border:0"><table><thead><tr><th>Certificate</th><th>Server</th><th>Expires</th><th>Why</th><th></th></tr></thead><tbody>${attention.map(c => `<tr class="clickable" data-act="cert" data-id="${c.id}"><td><div class="cn">${esc(c.cn)}</div></td><td>${esc(srv(c.serverId).name)}</td><td class="nowrap">${statusPill(c)} ${Math.round(dleft(c))}d</td><td class="muted">${esc(c.state === 'Failed' ? c.lastError : c.state === 'Review' ? 'awaiting approval' : status(c) === 'expired' ? 'expired' : 'not managed: ' + (inel(c) || 'run enrolment'))}</td><td><button class="btn sm">Open</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing needs attention.</td></tr>'}</tbody></table></div></div>
        <div class="grid" style="grid-template-rows:auto 1fr"><div class="card"><h3>Scheduled run</h3><div class="sub">${S.schedule.enabled ? `Daily at ${String(S.schedule.hour).padStart(2, '0')}:00 · next in ${Math.floor(mins / 60)} h ${mins % 60} min` : 'Schedule is paused'}</div>
          <div class="muted" style="font-size:.88rem">Last run: ${lastRun ? `${rel(lastRun.ts)} · exit ${lastRun.detail.exit ?? 0}` : '—'}</div><div class="row" style="margin-top:12px"><button class="btn sm" data-act="toggle-schedule">${S.schedule.enabled ? 'Pause schedule' : 'Resume schedule'}</button></div></div>
          <div class="card"><h3>Recent activity</h3><div class="sub">Hash-chained audit trail</div><ul class="tl">${events.map(e => `<li style="--c:${/failed|tamper/.test(e.type) ? 'var(--red)' : /rollback/.test(e.type) ? 'var(--amber)' : 'var(--green)'}"><b>${esc(e.type)}</b> <span class="muted">${esc(e.target)}</span><br><span class="faint">${rel(e.ts)}</span></li>`).join('')}</ul></div></div></div>`;
    },
  };

  // ------------------------------------------------------------------ certificates
  const F = A.F = { q: '', status: '', type: '', os: '', zone: '', state: '', month: '', sort: 'days', dir: 1, limit: 60 };
  function filtered() {
    const q = F.q.trim().toLowerCase();
    let list = S.certs.filter(c => {
      const s = srv(c.serverId);
      if (F.status && status(c) !== F.status) return false;
      if (F.type && c.type !== F.type) return false;
      if (F.os && (F.os === 'java' ? s.tech !== 'java_keystore' : (s.os !== F.os || s.tech === 'java_keystore'))) return false;
      if (F.zone && s.zone !== F.zone) return false;
      if (F.state && (F.state === 'Paused' ? !c.paused : F.state === 'Unmanaged' ? c.managed : c.state !== F.state)) return false;
      if (F.state === 'Due' && !(c.managed && isDue(c))) return false;
      if (F.month && new Date(c.notAfter).toISOString().slice(0, 7) !== F.month) return false;
      if (q && !(c.cn + ' ' + c.san.join(' ') + ' ' + c.thumbprint + ' ' + c.serial + ' ' + s.name + ' ' + s.host + ' ' + c.id + ' ' + c.history.map(h => h.jobId).join(' ')).toLowerCase().includes(q)) return false;
      return true;
    });
    const key = { days: c => c.notAfter, cn: c => c.cn, server: c => srv(c.serverId).name, type: c => c.type }[F.sort] || (c => c.notAfter);
    list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * F.dir); return list;
  }
  const exportCsv = (name, rows) => {
    const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };
  function certRows() {
    const list = filtered(), shown = list.slice(0, F.limit);
    $('#cert-count').textContent = `${list.length} of ${S.certs.length} records`;
    $('#cert-body').innerHTML = shown.map(c => {
      const s = srv(c.serverId), d = dleft(c), life = c.type === 'DV' ? 90 : 365, pct = Math.max(2, Math.min(100, d / life * 100)), col = { valid: 'var(--green)', expiring: 'var(--amber)', expired: 'var(--red)' }[status(c)];
      const can = c.managed && !c.paused && c.state !== 'Review' && isDue(c);
      return `<tr class="clickable" data-act="cert" data-id="${c.id}"><td>${statusPill(c)}</td><td><div class="cn">${esc(c.cn)}</div><div class="sub">${c.san.length > 1 ? c.san.length + ' names · ' : ''}${esc(c.ca)}</div></td><td>${esc(s.name)}<div class="sub">${esc(s.zone)} · ${esc(s.tech.replace('_', ' '))}</div></td><td>${pill(c.type, c.type === 'DV' ? 'cyan' : c.type === 'OV' ? 'purple' : 'amber')}</td>
        <td class="nowrap">${fmtDate(c.notAfter)}<div class="bar" style="margin-top:5px"><i style="width:${pct}%;--c:${col}"></i></div><div class="sub">${d < 0 ? 'expired ' + Math.round(-d) + 'd ago' : Math.round(d) < 1 ? 'expires today' : Math.round(d) + (Math.round(d) === 1 ? ' day left' : ' days left')}</div></td><td>${statePill(c)}</td>
        <td class="nowrap right"><button class="btn sm primary" data-act="renew" data-id="${c.id}" ${can && !S.killSwitch ? '' : 'disabled'} title="${can ? 'Renew this certificate now' : 'Not renewable right now (not due, paused, awaiting approval or unmanaged)'}">Renew</button> <button class="btn sm" data-act="${c.paused ? 'resume' : 'pause'}" data-id="${c.id}" ${c.managed ? '' : 'disabled'}>${c.paused ? 'Resume' : 'Pause'}</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">No certificates match these filters.</td></tr>';
    $('#cert-more').style.display = list.length > F.limit ? '' : 'none';
    $('#cert-more').textContent = `Show ${Math.min(60, list.length - F.limit)} more`;
  }
  const opt = (v, t, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`;
  A.views.certificates = {
    render() {
      return `<div class="card ap-card"><div class="toolbar flat"><input class="input grow" id="f-q" placeholder="Search common name, thumbprint, serial, server or job ID…" value="${esc(F.q)}">
        <select class="input" data-f="status">${opt('', 'All statuses', F.status)}${opt('valid', 'Valid', F.status)}${opt('expiring', 'Expiring', F.status)}${opt('expired', 'Expired', F.status)}</select>
        <select class="input" data-f="state">${opt('', 'All states', F.state)}${['Managed', 'Due', 'Discovered', 'Unmanaged', 'Review', 'Failed', 'Paused'].map(x => opt(x, x === 'Due' ? 'Due for renewal' : x, F.state)).join('')}</select>
        <select class="input" data-f="type">${opt('', 'All types', F.type)}${opt('DV', 'DV', F.type)}${opt('OV', 'OV', F.type)}${opt('EV', 'EV', F.type)}</select>
        <select class="input" data-f="os">${opt('', 'All platforms', F.os)}${opt('linux', 'Linux', F.os)}${opt('windows', 'Windows', F.os)}${opt('java', 'Java keystore', F.os)}</select>
        <select class="input" data-f="zone">${opt('', 'All zones', F.zone)}${[...new Set(S.servers.map(s => s.zone))].map(z => opt(z, z, F.zone)).join('')}</select>
        ${F.month ? `<span class="pill amber">Expiring ${F.month}</span>` : ''}<button class="btn" data-act="reset-filters">Reset</button><button class="btn" data-act="export-certs">${icon('download')}Export CSV</button></div>
        <div class="tablewrap flat"><table><thead><tr><th>Status</th><th class="sort" data-act="sort" data-k="cn">Certificate ↕</th><th class="sort" data-act="sort" data-k="server">Server ↕</th><th class="sort" data-act="sort" data-k="type">Type ↕</th><th class="sort" data-act="sort" data-k="days">Expires ↕</th><th>CDM state</th><th class="right">Actions</th></tr></thead><tbody id="cert-body"></tbody></table></div>
        <div class="ap-foot row spread"><span class="muted" id="cert-count"></span><button class="btn sm" id="cert-more" data-act="more">Show more</button></div></div>`;
    },
    after() {
      certRows();
      $('#f-q').addEventListener('input', e => { F.q = e.target.value; F.limit = 60; certRows(); });
    },
    live() { certRows(); },
  };
  A.handlers['reset-filters'] = () => { Object.assign(F, { q: '', status: '', type: '', os: '', zone: '', state: '', month: '', limit: 60 }); A.renderView(); };
  A.handlers.more = () => { F.limit += 60; certRows(); };
  A.handlers.sort = el => { const k = el.dataset.k; F.dir = F.sort === k ? -F.dir : 1; F.sort = k; certRows(); };
  A.handlers['export-certs'] = () => { exportCsv('cdm-certificates.csv', [['id', 'common_name', 'san', 'type', 'ca', 'server', 'zone', 'location', 'not_after', 'days_left', 'status', 'state', 'thumbprint_sha256', 'serial'],
    ...filtered().map(c => [c.id, c.cn, c.san.join(' '), c.type, c.ca, srv(c.serverId).name, srv(c.serverId).zone, c.location, fmtDate(c.notAfter), Math.round(dleft(c)), status(c), c.paused ? 'Paused' : c.state, c.thumbprint, c.serial])]); toast('CSV exported', 'ok'); };
  A.handlers.kpi = el => {
    Object.assign(F, { q: '', status: '', type: '', os: '', zone: '', state: '', month: '', limit: 60 }); const k = el.dataset.k;
    if (['valid', 'expiring', 'expired'].includes(k)) F.status = k; else if (k === 'managed') F.state = 'Managed'; else if (k === 'due') F.state = 'Due'; else if (k === 'review') { A.go('approvals'); return; } else if (k === 'attention') F.state = 'Failed';
    A.go('certificates');
  };
  A.handlers.month = el => { Object.assign(F, { q: '', status: '', type: '', os: '', zone: '', state: '', month: el.dataset.k, limit: 60 }); A.go('certificates'); };

  // ------------------------------------------------------------------ certificate drawer
  A.certDrawer = id => {
    const c = certById(id); if (!c) return; const s = srv(c.serverId), d = dleft(c);
    const lastJob = S.jobs.find(j => j.certId === c.id && /^(Deployed|Confirmed)$/.test(j.state) && j.newThumb === c.thumbprint);
    const can = c.managed && !c.paused && c.state !== 'Review' && isDue(c) && !S.killSwitch;
    A.openDrawer(`<div class="row spread"><div><h3 style="font-size:1.25rem;word-break:break-all">${esc(c.cn)}</h3><div class="row" style="margin-top:8px">${statusPill(c)}${statePill(c)}${pill(c.type, c.type === 'DV' ? 'cyan' : c.type === 'OV' ? 'purple' : 'amber')}</div></div><button class="btn sm" data-act="close-layer">Close</button></div>
      ${c.lastError ? `<div class="banner" style="margin-top:14px"><div><b>Last error:</b> ${esc(c.lastError)}</div></div>` : ''}${c.paused ? `<div class="banner info" style="margin-top:14px"><div><b>Renewal paused:</b> ${esc(c.pauseReason)}</div></div>` : ''}
      <dl class="kv"><dt>Server</dt><dd>${esc(s.name)} (${esc(s.host)}) · ${esc(s.zone)}</dd><dt>Platform</dt><dd>${esc(s.tech.replace('_', ' '))} via ${s.transport.toUpperCase()}</dd><dt>Binding</dt><dd class="mono">${esc(c.location)}</dd><dt>Issuer</dt><dd>${esc(c.ca)}</dd><dt>Renewal source</dt><dd>${c.managed ? esc(c.source) + (c.source === 'Folder' ? ' (approval policy applies)' : ' (automatic)') : 'Not managed: ' + esc(inel(c) || c.ineligible || 'enrol to manage')}</dd>
      <dt>Key</dt><dd>${esc(c.keyAlg)}</dd><dt>Valid</dt><dd>${fmtDate(c.notBefore)} → ${fmtDate(c.notAfter)} (${d < 0 ? 'expired ' + Math.round(-d) + ' days ago' : Math.round(d) + ' days left'})</dd><dt>SHA-256</dt><dd class="mono">${esc(c.thumbprint)}</dd><dt>Serial</dt><dd class="mono">${esc(c.serial)}</dd><dt>Last scanned</dt><dd>${rel(c.lastScanned)}</dd></dl>
      <div class="muted" style="font-size:.85rem">Names (SAN)</div><div class="chips" style="margin:6px 0 16px">${c.san.map(x => `<span>${esc(x)}</span>`).join('')}</div>
      <div class="row" style="margin:16px 0"><button class="btn primary" data-act="renew" data-id="${c.id}" ${can ? '' : 'disabled'}>${icon('play')}Renew now</button><button class="btn" data-act="${c.paused ? 'resume' : 'pause'}" data-id="${c.id}" ${c.managed ? '' : 'disabled'}>${icon('pause')}${c.paused ? 'Resume renewal' : 'Pause renewal'}</button>
      <button class="btn" data-act="rollback-job" data-id="${lastJob ? lastJob.id : ''}" ${lastJob ? '' : 'disabled'}>${icon('undo')}Roll back last renewal</button><button class="btn" data-act="scan-from" data-id="${s.id}">${icon('radar')}Scan server</button>${!c.managed && !inel(c) ? `<button class="btn good" data-act="enrol-one" data-id="${c.id}">Enrol for auto-renewal</button>` : ''}</div>
      <h4 style="margin-top:20px">Renewal history</h4><ul class="tl">${c.history.length ? c.history.map(h => `<li style="--c:${/Roll/.test(h.outcome) ? 'var(--amber)' : 'var(--green)'}"><b>${esc(h.outcome)}</b> · ${fmtDT(h.at)}<br><span class="mono faint">${esc(h.jobId)} · ${esc(short(h.from, 10))} → ${esc(short(h.to, 10))}</span></li>`).join('') : '<li class="muted">No renewals recorded yet.</li>'}</ul>`);
  };
  A.handlers.cert = el => A.certDrawer(el.dataset.id);
  A.handlers.pause = el => { const c = certById(el.dataset.id); if (!c) return; c.paused = true; c.pauseReason = 'Paused by ' + S.settings.actor + ' (change freeze)'; A.audit('renewal.paused', c.cn, { reason: c.pauseReason }); toast('Renewal paused for ' + c.cn, 'warn'); A.closeLayer(); A.renderView(); A.ui(); };
  A.handlers.resume = el => { const c = certById(el.dataset.id); if (!c) return; c.paused = false; c.pauseReason = null; A.audit('renewal.resumed', c.cn, {}); toast('Renewal resumed for ' + c.cn, 'ok'); A.closeLayer(); A.renderView(); A.ui(); };
  A.handlers['enrol-one'] = el => { const c = certById(el.dataset.id); if (!c) return; c.managed = true; c.state = 'Managed'; c.ineligible = null; A.audit('enrol.enrolled', c.cn, { server: srv(c.serverId).name }); toast(c.cn + ' is now managed', 'ok'); A.closeLayer(); A.renderView(); A.ui(); };

  // ------------------------------------------------------------------ jobs, rollback, backups
  let jobTab = 'jobs';
  A.applyRollback = (job, backup, manual = true) => {
    const c = certById(job.certId); if (!c) return false;
    const src = backup || job;
    c.thumbprint = src.oldThumb; c.notAfter = src.oldNotAfter; c.notBefore = src.oldNotBefore; c.state = 'Managed'; c.lastError = null; c.lastScanned = Date.now();
    c.history.unshift({ at: Date.now(), jobId: job.id, from: job.newThumb, to: src.oldThumb, outcome: 'Rolled back (manual)' });
    job.state = 'Rolled back (manual)'; const b = S.backups.find(x => x.id === (backup ? backup.id : job.backupId)); if (b) b.status = 'restored';
    A.audit('rollback.completed', job.id, { manual, verified: true, restored: short(src.oldThumb, 16) }); return true;
  };
  A.rollbackFlow = job => {
    const c = certById(job.certId); if (!c) return;
    A.confirm({ title: 'Roll back this renewal?', danger: true, label: 'Roll back', body: `CDM will restore the previous certificate for <b>${esc(job.cn)}</b> from backup <span class="mono">${esc(job.backupId || '')}</span>, reactivate the service and verify that the old thumbprint is served again.`,
      onYes: async () => { const ok = await A.progress({ title: 'Rolling back ' + job.cn, steps: ['Locate backup ' + job.backupId, 'Restore previous certificate and key', 'Reactivate ' + srv(job.serverId).tech.replace('_', ' ') + ' (graceful reload)', 'Verify the old thumbprint is served'] });
        if (ok) { A.applyRollback(job); toast('Rollback verified for ' + job.cn, 'ok'); A.closeLayer(); A.renderView(); A.ui(); } } });
  };
  A.handlers['rollback-job'] = el => { const j = S.jobs.find(x => x.id === el.dataset.id); if (j) A.rollbackFlow(j); };
  const canRollback = j => /^(Deployed|Confirmed)$/.test(j.state) && certById(j.certId) && certById(j.certId).thumbprint === j.newThumb;
  A.canRollback = canRollback;
  A.views.jobs = {
    render() {
      const jobsHtml = `<div class="tablewrap"><table><thead><tr><th>Job</th><th>Certificate</th><th>Server</th><th>Started</th><th>Duration</th><th>Steps</th><th>State</th><th></th></tr></thead><tbody>${S.jobs.slice(0, 80).map(j => `<tr><td class="mono">${esc(j.id)}</td><td><div class="cn">${esc(j.cn)}</div>${j.error ? `<div class="sub" style="color:var(--red)">${esc(j.error)}</div>` : ''}</td><td>${esc(srv(j.serverId).name)}<div class="sub">${esc(j.zone)}${j.canary ? ' · canary' : ''}</div></td><td class="nowrap">${rel(j.startedAt)}</td><td>${j.endedAt ? Math.round((j.endedAt - j.startedAt) / 1000) + ' s' : '—'}</td><td>${stepDots(j.steps)}</td><td>${JOB_PILL(j.state)}</td>
        <td class="nowrap"><button class="btn sm" data-act="job-detail" data-id="${j.id}">Details</button> <button class="btn sm danger" data-act="rollback-job" data-id="${j.id}" ${canRollback(j) ? '' : 'disabled'} title="${canRollback(j) ? 'Restore the previous certificate' : 'Only the latest successful renewal of a certificate can be rolled back'}">${icon('undo')}Roll back</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No jobs yet. Run the pipeline to create some.</td></tr>'}</tbody></table></div>`;
      const live = S.backups.filter(b => b.status !== 'deleted');
      const backupsHtml = `<div class="tablewrap"><table><thead><tr><th>Backup</th><th>Certificate</th><th>Server</th><th>Location</th><th>Created</th><th>Retained until</th><th>Integrity</th><th>Status</th><th></th></tr></thead><tbody>${live.slice(0, 80).map(b => `<tr><td class="mono">${esc(b.id)}</td><td><div class="cn">${esc(b.cn)}</div></td><td>${esc(srv(b.serverId).name)}</td><td class="mono">${esc(b.path)}</td><td class="nowrap">${rel(b.createdAt)}</td><td class="nowrap">${fmtDate(b.retainUntil)}</td><td class="mono">${esc(short(b.sha256, 12))}</td><td>${pill(b.status, b.status === 'available' ? 'green' : 'amber')}</td>
        <td class="nowrap"><button class="btn sm" data-act="verify-backup" data-id="${b.id}">Verify</button> <button class="btn sm" data-act="restore-backup" data-id="${b.id}" ${b.status === 'available' ? '' : 'disabled'}>Restore</button> <button class="btn sm danger" data-act="delete-backup" data-id="${b.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">No backups.</td></tr>'}</tbody></table></div>`;
      return `<div class="card"><h3>Jobs & rollback</h3><div class="sub">Every deployment takes a backup first, verifies afterwards, and can be undone in one click. Rollback restores the previous certificate and proves the old thumbprint is served again.</div>
        <div class="tabs"><button class="${jobTab === 'jobs' ? 'on' : ''}" data-act="job-tab" data-k="jobs">Deployment jobs (${S.jobs.length})</button><button class="${jobTab === 'backups' ? 'on' : ''}" data-act="job-tab" data-k="backups">Backups (${live.length})</button></div></div>${jobTab === 'jobs' ? jobsHtml : backupsHtml}`;
    },
  };
  A.live.add('jobs');
  A.handlers['job-tab'] = el => { jobTab = el.dataset.k; A.renderView(); };
  A.handlers['job-detail'] = el => {
    const j = S.jobs.find(x => x.id === el.dataset.id); if (!j) return; const evs = S.audit.filter(e => e.target === j.id);
    A.openModal(`<div class="row spread"><h3 class="mono">${esc(j.id)}</h3><button class="btn sm" data-act="close-layer">Close</button></div><div class="row" style="margin:8px 0">${JOB_PILL(j.state)}</div>
      <dl class="kv"><dt>Certificate</dt><dd>${esc(j.cn)}</dd><dt>Server</dt><dd>${esc(srv(j.serverId).name)} · ${esc(j.zone)}</dd><dt>Old thumbprint</dt><dd class="mono">${esc(short(j.oldThumb, 24))}</dd><dt>New thumbprint</dt><dd class="mono">${esc(short(j.newThumb, 24))}</dd><dt>Backup</dt><dd class="mono">${esc(j.backupId || '—')}</dd>${j.error ? `<dt>Error</dt><dd style="color:var(--red)">${esc(j.error)}</dd>` : ''}</dl>
      ${['precheck', 'backup', 'install', 'activate', 'verify'].map(k => `<div class="pstep ${j.steps[k] === 'done' ? 'done' : j.steps[k] === 'failed' ? 'failed' : ''}"><span class="ic">${j.steps[k] === 'done' ? '✓' : j.steps[k] === 'failed' ? '✕' : j.steps[k] === 'rolled' ? '↩' : '·'}</span><span style="text-transform:capitalize">${k}</span><span class="muted" style="margin-left:auto">${j.steps[k] === 'rolled' ? 'rolled back & verified' : j.steps[k]}</span></div>`).join('')}
      <h4 style="margin-top:16px">Audit events</h4><ul class="tl">${evs.map(e => `<li><b>${esc(e.type)}</b> · ${fmtDT(e.ts)}<br><span class="mono faint">#${e.seq} ${esc(short(e.hash, 16))}</span></li>`).join('') || '<li class="muted">No events.</li>'}</ul>`);
  };
  A.handlers['restore-backup'] = el => {
    const b = S.backups.find(x => x.id === el.dataset.id), j = b && S.jobs.find(x => x.id === b.jobId), c = b && certById(b.certId); if (!b || !j || !c) return toast('Backup cannot be restored (job or certificate not found)', 'err');
    A.confirm({ title: 'Restore this backup?', danger: true, label: 'Restore', body: `The current certificate of <b>${esc(b.cn)}</b> will be replaced by the one saved in <span class="mono">${esc(b.id)}</span>.`,
      onYes: async () => { if (await A.progress({ title: 'Restoring ' + b.id, steps: ['Verify backup integrity (SHA-256)', 'Install certificate and key', 'Reactivate service', 'Verify served thumbprint'] })) { A.applyRollback(j, b); toast('Backup restored: ' + b.cn, 'ok'); A.closeLayer(); A.renderView(); A.ui(); } } });
  };
  A.handlers['verify-backup'] = async el => { const b = S.backups.find(x => x.id === el.dataset.id); if (!b) return; const ok = await A.progress({ title: 'Verifying ' + b.id, steps: ['Read ' + b.path, 'Recompute SHA-256', 'Compare with the recorded digest'], stepMs: 450 }); if (ok) A.audit('backup.verified', b.id, { sha256: short(b.sha256, 16) }); };
  A.handlers['delete-backup'] = el => { const b = S.backups.find(x => x.id === el.dataset.id); if (!b) return; A.confirm({ title: 'Delete this backup?', danger: true, label: 'Delete', body: `You will no longer be able to roll back <b>${esc(b.cn)}</b> to this version.`, onYes: () => { b.status = 'deleted'; A.audit('backup.deleted', b.id, {}); toast('Backup deleted', 'warn'); A.renderView(); } }); };

  // ------------------------------------------------------------------ approvals
  const REVIEW_TEXT = { approval: ['Approval required', 'Policy requires a human approver before an OV/EV certificate is replaced.', 'Approve & renew'], downgrade: ['Type downgrade blocked', 'The replacement candidate is DV but the current certificate is EV. CDM refuses a validation-level downgrade.', 'Override guard & renew'], ambiguous: ['Ambiguous match', 'Two equally valid replacements were found in input_certificates/. Pick one to continue.', 'Choose candidate A & renew'] };
  const AP = { q: '', type: '', zone: '', server: '', status: '', sel: new Set() };
  const apItems = () => {
    const q = AP.q.trim().toLowerCase();
    return S.certs.filter(c => {
      if (c.state !== 'Review') return false; const s = srv(c.serverId);
      if (AP.type && c.type !== AP.type) return false;
      if (AP.zone && s.zone !== AP.zone) return false;
      if (AP.server && s.id !== AP.server) return false;
      if (AP.status && (c.review || 'approval') !== AP.status) return false;
      return !q || (c.cn + ' ' + c.san.join(' ') + ' ' + s.name + ' ' + s.host + ' ' + c.id).toLowerCase().includes(q);
    }).sort((a, b) => a.notAfter - b.notAfter);
  };
  const REASON_COLOR = { approval: 'amber', downgrade: 'red', ambiguous: 'purple' };
  function apList() {
    const all = S.certs.filter(c => c.state === 'Review'), items = apItems();
    for (const id of [...AP.sel]) if (!all.some(c => c.id === id)) AP.sel.delete(id);
    const nSel = items.filter(c => AP.sel.has(c.id)).length;
    $('#ap-count').textContent = `Showing ${items.length} of ${all.length} pending`;
    $('#ap-all').checked = items.length > 0 && nSel === items.length; $('#ap-all').indeterminate = nSel > 0 && nSel < items.length; $('#ap-all').disabled = !items.length;
    $('#ap-bulk').className = 'bulkbar' + (nSel ? ' on' : '');
    $('#ap-bulk').innerHTML = `<b>${nSel} selected</b><span class="muted">Apply a decision to all selected items</span><span style="flex:1"></span><button class="btn sm primary" data-act="ap-bulk" data-do="approve">Approve selected</button><button class="btn sm danger" data-act="ap-bulk" data-do="reject">Reject selected</button><button class="btn sm" data-act="ap-desel">Clear selection</button>`;
    for (const k of ['approval', 'downgrade', 'ambiguous']) { const n = $('#ap-n-' + k); if (n) n.textContent = all.filter(c => (c.review || 'approval') === k).length; }
    $('#ap-body').innerHTML = items.map(c => {
      const t = REVIEW_TEXT[c.review || 'approval'], s = srv(c.serverId), d = Math.round(dleft(c));
      return `<tr class="${AP.sel.has(c.id) ? 'sel' : ''}"><td class="chk"><input type="checkbox" class="ap-chk" data-id="${c.id}" ${AP.sel.has(c.id) ? 'checked' : ''} aria-label="Select ${esc(c.cn)}"></td>
        <td><button class="linkbtn cn" data-act="cert" data-id="${c.id}">${esc(c.cn)}</button><div class="sub">${pill(c.type, c.type === 'EV' ? 'amber' : c.type === 'OV' ? 'purple' : 'cyan')} <span style="margin-left:4px">${esc(c.ca)}</span></div></td>
        <td>${esc(s.name)}<div class="sub">${esc(s.zone)} · ${esc(s.host)}</div></td>
        <td>${pill(t[0], REASON_COLOR[c.review || 'approval'])}<div class="sub reason">${t[1]}</div></td>
        <td class="nowrap">${fmtDate(c.notAfter)}<div class="sub">${d < 0 ? 'expired ' + (-d) + 'd ago' : d + (d === 1 ? ' day left' : ' days left')}</div></td>
        <td class="nowrap right"><button class="btn sm primary" data-act="approve" data-id="${c.id}" data-now="1" title="${esc(t[2])}">Approve &amp; renew</button> <button class="btn sm" data-act="approve" data-id="${c.id}" title="Approve now, renew on the next run">Approve</button> <button class="btn sm danger" data-act="reject" data-id="${c.id}">Reject</button></td></tr>`;
    }).join('') || `<tr><td colspan="6" class="empty">${all.length ? 'No pending items match these filters.' : 'The review queue is empty. Nothing is waiting for a decision.'}</td></tr>`;
  }
  A.views.approvals = {
    render() {
      const pend = S.certs.filter(c => c.state === 'Review');
      const sv = [...new Map(pend.map(c => [c.serverId, srv(c.serverId)])).values()], zones = [...new Set(pend.map(c => srv(c.serverId).zone))];
      const tile = (k, lbl, color) => `<button class="kpi small ${AP.status === k ? 'active' : ''}" style="--c:var(--${color})" data-act="ap-quick" data-k="${k}"><div class="lbl">${lbl}</div><div class="num" id="ap-n-${k}">0</div></button>`;
      return `<div class="card"><h3>Approvals & review queue</h3><div class="sub" style="margin-bottom:0">CDM never guesses. Anything risky waits here for a person, and every decision is written to the audit trail.</div></div>
        <div class="kpis">${tile('approval', 'Approval required', 'amber')}${tile('downgrade', 'Type downgrade blocked', 'red')}${tile('ambiguous', 'Ambiguous match', 'purple')}</div>
        <div class="card ap-card">
          <div class="toolbar flat"><input class="input grow" id="ap-q" placeholder="Search certificate, server or host…" value="${esc(AP.q)}">
            <select class="input" data-ap="type">${opt('', 'All types', AP.type)}${opt('OV', 'OV', AP.type)}${opt('EV', 'EV', AP.type)}${opt('DV', 'DV', AP.type)}</select>
            <select class="input" data-ap="zone">${opt('', 'All zones', AP.zone)}${zones.map(z => opt(z, z, AP.zone)).join('')}</select>
            <select class="input" data-ap="server">${opt('', 'All servers', AP.server)}${sv.map(x => opt(x.id, x.name, AP.server)).join('')}</select>
            <select class="input" data-ap="status">${opt('', 'All statuses', AP.status)}${Object.entries(REVIEW_TEXT).map(([k, t]) => opt(k, t[0], AP.status)).join('')}</select>
            <button class="btn sm" data-act="ap-clear">Reset</button></div>
          <div id="ap-bulk" class="bulkbar"></div>
          <div class="tablewrap flat"><table><thead><tr><th class="chk"><input type="checkbox" id="ap-all" aria-label="Select all"></th><th>Certificate</th><th>Server</th><th>Reason</th><th>Expires</th><th class="right">Decision</th></tr></thead><tbody id="ap-body"></tbody></table></div>
          <div class="ap-foot muted" id="ap-count"></div>
        </div>`;
    },
    after() {
      apList();
      $('#ap-q').addEventListener('input', e => { AP.q = e.target.value; apList(); });
      $('#ap-all').addEventListener('change', e => { apItems().forEach(c => e.target.checked ? AP.sel.add(c.id) : AP.sel.delete(c.id)); apList(); });
      $('#ap-body').addEventListener('change', e => { if (e.target.classList.contains('ap-chk')) { e.target.checked ? AP.sel.add(e.target.dataset.id) : AP.sel.delete(e.target.dataset.id); apList(); } });
    },
  };
  A.handlers['ap-quick'] = el => { AP.status = AP.status === el.dataset.k ? '' : el.dataset.k; A.renderView(); };
  A.handlers['ap-desel'] = () => { AP.sel.clear(); apList(); };
  A.handlers['ap-clear'] = () => { Object.assign(AP, { q: '', type: '', zone: '', server: '', status: '' }); A.renderView(); };
  A.handlers['ap-bulk'] = el => {
    const act = el.dataset.do, list = apItems().filter(c => AP.sel.has(c.id)); if (!list.length) return;
    const risky = list.filter(c => c.review === 'downgrade' || c.review === 'ambiguous').length;
    const verb = act === 'approve' ? 'Approve' : 'Reject';
    A.confirm({ title: `${verb} ${list.length} certificate${list.length > 1 ? 's' : ''}?`, danger: act === 'reject' || risky > 0, label: `${verb} ${list.length}`,
      body: (act === 'approve' ? 'Selected certificates are approved for renewal on the next run (no renewal starts now).' : 'Renewal is paused for the selected certificates.')
        + (act === 'approve' && risky ? `<br><b>${risky}</b> of them are type-downgrade or ambiguous-match items that will be overridden. Review them individually if unsure.` : ''),
      onYes: () => {
        list.forEach(c => { if (act === 'approve') { c.approved = true; c.state = 'Managed'; delete c.review; A.audit('approval.granted', c.cn, { by: S.settings.actor, bulk: true }); } else { c.state = 'Managed'; c.paused = true; c.pauseReason = 'Rejected by ' + S.settings.actor; delete c.review; A.audit('approval.rejected', c.cn, { bulk: true }); } });
        list.forEach(c => AP.sel.delete(c.id)); toast(`${verb}d ${list.length} certificate${list.length > 1 ? 's' : ''}`, act === 'approve' ? 'ok' : 'warn'); A.closeLayer(); A.renderView(); A.ui();
      } });
  };
  A.handlers.approve = el => {
    const c = certById(el.dataset.id); if (!c) return; c.approved = true; c.state = 'Managed'; delete c.review; A.audit('approval.granted', c.cn, { by: S.settings.actor });
    toast('Approved: ' + c.cn, 'ok'); if (el.dataset.now) { A.go('pipeline'); setTimeout(() => A.handlers['renew'] && A.handlers['renew']({ dataset: { id: c.id } }), 80); } else { A.renderView(); A.ui(); }
  };
  A.handlers.reject = el => { const c = certById(el.dataset.id); if (!c) return; c.state = 'Managed'; c.paused = true; c.pauseReason = 'Rejected by ' + S.settings.actor; delete c.review; A.audit('approval.rejected', c.cn, {}); toast('Rejected: renewal paused for ' + c.cn, 'warn'); A.renderView(); A.ui(); };

  // ------------------------------------------------------------------ audit & compliance
  const AU = { q: '', type: '', result: null, tamper: null };
  A.verifyChain = () => {
    let prev = '0'.repeat(64);
    for (const e of S.audit) { if (e.prev !== prev || D.eventHash(prev, e) !== e.hash) return { ok: false, n: S.audit.length, bad: e.seq }; prev = e.hash; }
    return { ok: true, n: S.audit.length };
  };
  A.tamper = () => { if (AU.tamper) return; const e = S.audit[Math.max(0, S.audit.length - 25)]; AU.tamper = { seq: e.seq, target: e.target }; e.target = e.target + ' (edited)'; A.save(); };
  A.untamper = () => { if (!AU.tamper) return; S.audit.find(e => e.seq === AU.tamper.seq).target = AU.tamper.target; AU.tamper = null; A.save(); };
  A.AU = AU;
  function auditRows() {
    const q = AU.q.toLowerCase(), list = S.audit.filter(e => (!AU.type || e.type === AU.type) && (!q || (e.type + ' ' + e.target + ' ' + e.actor + ' ' + JSON.stringify(e.detail)).toLowerCase().includes(q))).slice().reverse().slice(0, 150);
    $('#audit-count').textContent = `${list.length} shown of ${S.audit.length} events`;
    $('#audit-body').innerHTML = list.map(e => `<tr><td class="mono">#${e.seq}</td><td class="nowrap">${fmtDT(e.ts)}</td><td>${pill(e.type, /failed|tamper/.test(e.type) ? 'red' : /rollback|paused|deleted/.test(e.type) ? 'amber' : /approval|policy/.test(e.type) ? 'purple' : 'blue')}</td><td>${esc(e.target)}</td><td class="muted">${esc(e.actor)}</td><td class="mono" title="${e.hash}">${esc(short(e.hash, 14))}</td><td class="mono faint" title="${e.prev}">${esc(short(e.prev, 10))}</td></tr>`).join('');
  }
  A.views.audit = {
    render() {
      const types = [...new Set(S.audit.map(e => e.type))].sort(), r = AU.result, db = S.db;
      return `<div class="grid g21"><div class="card"><h3>Tamper-evident audit trail</h3><div class="sub">Each event stores the hash of the one before it. Edit or delete any record and every later hash stops matching.</div>
        <div class="row"><button class="btn primary" data-act="verify-chain">${icon('check')}Verify hash chain</button><button class="btn" data-act="tamper" ${AU.tamper ? 'disabled' : ''}>Simulate tampering</button><button class="btn" data-act="untamper" ${AU.tamper ? '' : 'disabled'}>Undo tampering</button><button class="btn" data-act="export-audit">${icon('download')}Export JSON</button></div>
        ${r ? `<div class="banner ${r.ok ? 'info' : ''}" style="margin-top:14px"><div>${r.ok ? `<b>Hash chain intact:</b> ${r.n} events verified, no gaps, no edits.` : `<b>TAMPERING DETECTED</b> at event #${r.bad}. Every event from there onward fails verification.`}</div></div>` : ''}</div>
        <div class="card"><h3>PostgreSQL mirror</h3><div class="sub">Append-only table, hash-chained like the local log. An outage never blocks a deployment.</div><div class="row"><span class="dot ${db.outage ? 'red pulse' : ''}"></span><b>${db.outage ? 'Circuit open · writes queued' : 'Connected'}</b><span class="muted">${db.pending} pending</span></div>
        <div class="muted" style="margin:10px 0;font-size:.85rem">${Object.entries(db.rows).map(([k, v]) => `${k}: <b>${v}</b>`).join(' · ')}</div><div class="row"><button class="btn sm" data-act="db-outage">${db.outage ? 'Restore connection' : 'Simulate DB outage'}</button><button class="btn sm primary" data-act="db-sync" ${db.pending ? '' : 'disabled'}>Sync ${db.pending} queued</button></div></div></div>
      <div class="toolbar"><input class="input grow" id="a-q" placeholder="Search events, targets, actors…" value="${esc(AU.q)}"><select class="input" data-au="type"><option value="">All event types</option>${types.map(t => `<option ${t === AU.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><span class="muted" id="audit-count"></span></div>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Time (UTC)</th><th>Event</th><th>Target</th><th>Actor</th><th>Hash</th><th>Prev</th></tr></thead><tbody id="audit-body"></tbody></table></div>`;
    },
    after() { auditRows(); $('#a-q').addEventListener('input', e => { AU.q = e.target.value; auditRows(); }); },
    live() { auditRows(); },
  };
  A.handlers['verify-chain'] = async () => { await A.progress({ title: 'Verifying audit chain', steps: ['Read ' + S.audit.length + ' events', 'Recompute every SHA-256', 'Compare with stored hashes'], stepMs: 500 }); AU.result = A.verifyChain(); A.closeLayer(); A.renderView(); if (!AU.result.ok) toast('Tampering detected at event #' + AU.result.bad, 'err'); else toast('Audit chain verified', 'ok'); };
  A.handlers.tamper = () => { A.tamper(); AU.result = null; toast('A past record was edited. Now verify the chain.', 'warn'); A.renderView(); };
  A.handlers.untamper = () => { A.untamper(); AU.result = null; A.renderView(); toast('Original record restored', 'ok'); };
  A.handlers['export-audit'] = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.audit, null, 2)], { type: 'application/json' })); a.download = 'cdm-audit.json'; document.body.appendChild(a); a.click(); a.remove(); };
  A.handlers['db-outage'] = () => { S.db.outage = !S.db.outage; A.audit(S.db.outage ? 'db.outage' : 'db.restored', 'postgresql', {}); toast(S.db.outage ? 'Database mirror is down. CDM keeps working and queues events.' : 'Database reachable again. Sync the queued events.', S.db.outage ? 'warn' : 'ok'); A.renderView(); A.ui(); };
  A.handlers['db-sync'] = async () => { const n = S.db.pending; await A.progress({ title: 'Backfilling PostgreSQL', steps: ['Read logs/audit.jsonl', `Insert ${n} missing events in chain order`, 'Verify chain continuity'], stepMs: 500 }); S.db.rows.audit_events += n; S.db.pending = 0; A.save(); A.closeLayer(); A.renderView(); A.ui(); toast(n + ' events synced', 'ok'); };

  // ------------------------------------------------------------------ policies
  const tog = (k, t, d) => `<label class="toggle"><input type="checkbox" data-set="${k}" ${S.settings[k] ? 'checked' : ''}><div><b>${t}</b><span>${d}</span></div></label>`;
  A.views.policies = {
    render() {
      const s = S.settings, st = stats();
      return `<div class="card"><h3>Renewal policy</h3><div class="sub">Changes apply immediately to classification and to the next run.</div>
        <div class="ctrl-grid"><div><b>Renewal window: <span id="lbl-windowDays">${s.windowDays}</span> days</b><input type="range" min="7" max="60" value="${s.windowDays}" data-range="windowDays"><div class="muted" style="font-size:.85rem" id="win-preview">${st.due} managed certificates are due now · ${st.expiring} expiring overall</div></div>
        <div><b>Max enrolments per server per run: <span id="lbl-maxPerRun">${s.maxPerRun}</span></b><input type="range" min="1" max="50" value="${s.maxPerRun}" data-range="maxPerRun"><div class="muted" style="font-size:.85rem">Keeps a single run from flooding the CA.</div></div>
        <div><b>Parallel deployments per zone: <span id="lbl-maxParallel">${s.maxParallel}</span></b><input type="range" min="1" max="10" value="${s.maxParallel}" data-range="maxParallel"><div class="muted" style="font-size:.85rem">After the canary succeeds.</div></div></div></div>
      <div class="card"><h3>Safety controls</h3><div class="sub">The defaults are what you would run in production.</div><div class="ctrl-grid">${tog('canary', 'Canary first', 'Deploy one server per zone, then the rest')}${tog('stopOnFailure', 'Halt the zone on first failure', 'Remaining jobs in that zone are skipped')}${tog('approveOvEv', 'Human approval for OV/EV', 'Never auto-replace validated certificates')}${tog('autoEnrol', 'Scan-driven enrolment', 'Enrol every due, ACME-replaceable certificate found')}${tog('autoInstallAdapter', 'Auto-install Linux adapter', 'Copy the reviewed script over SSH when missing')}</div></div>
      <div class="card"><h3>Certificate authority & operator</h3><div class="ctrl-grid"><label><b>ACME environment</b><br><select class="input" data-setsel="acmeEnv" style="margin-top:6px">${opt('staging', "Let's Encrypt staging (lab)", s.acmeEnv)}${opt('production', "Let's Encrypt production", s.acmeEnv)}</select></label>
        <label><b>Operator identity (audit actor)</b><br><input class="input" data-settext="actor" value="${esc(s.actor)}" style="margin-top:6px;width:100%"></label></div></div>`;
    },
  };
  A.setSetting = (k, v) => { S.settings[k] = v; A.save(); };

  // ------------------------------------------------------------------ global events
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const h = A.handlers[el.dataset.act]; if (h) { e.stopPropagation(); h(el, e); }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.range) { $('#lbl-' + t.dataset.range).textContent = t.value; }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.ap) { AP[t.dataset.ap] = t.value; apList(); }
    else if (t.dataset.f) { F[t.dataset.f] = t.value; F.limit = 60; if (A.view() === 'certificates') certRows(); }
    else if (t.dataset.au) { AU.type = t.value; auditRows(); }
    else if (t.dataset.range) { A.setSetting(t.dataset.range, +t.value); A.renderTop(); A.renderNav(); if (t.dataset.range === 'windowDays') { const st = stats(); $('#win-preview').textContent = `${st.due} managed certificates are due now · ${st.expiring} expiring overall`; A.audit('policy.changed', 'renewal.window_days', { to: +t.value }); } }
    else if (t.dataset.set) { A.setSetting(t.dataset.set, t.checked); A.audit('policy.changed', t.dataset.set, { to: t.checked }); toast(t.dataset.set + ': ' + (t.checked ? 'on' : 'off'), 'ok'); }
    else if (t.dataset.setsel) { A.setSetting(t.dataset.setsel, t.value); A.audit('policy.changed', t.dataset.setsel, { to: t.value }); A.renderTop(); toast('Saved', 'ok'); }
    else if (t.dataset.settext) { A.setSetting(t.dataset.settext, t.value.trim() || DEFAULTS.actor); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') A.closeLayer(); });
  Object.assign(A.handlers, {
    'close-layer': () => A.closeLayer(),
    nav: el => A.go(el.dataset.v),
    theme: () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = S.theme; A.save(); },
    'reset-demo': () => A.confirm({ title: 'Reset demo data?', body: 'All changes you made (runs, rollbacks, approvals, policy) are discarded and the original sample estate is restored.', label: 'Reset', danger: true, onYes: () => A.reset() }),
    'toggle-schedule': () => { S.schedule.enabled = !S.schedule.enabled; A.audit('schedule.changed', 'daily-run', { enabled: S.schedule.enabled }); A.renderView(); },
    killswitch: () => {
      if (S.killSwitch) { S.killSwitch = false; A.audit('killswitch.released', 'renewals', {}); toast('Renewals resumed', 'ok'); A.render(); return; }
      A.confirm({ title: 'Engage emergency stop?', danger: true, label: 'Freeze all renewals', body: 'No new renewal or deployment will start. A run that is in progress finishes its in-flight jobs safely and then stops. Scans and reports keep working.',
        onYes: () => { S.killSwitch = true; if (A.RUN && ['running', 'paused'].includes(A.RUN.status)) { A.RUN.stop = true; if (A.RUN.status === 'paused') A.RUN.status = 'running'; } A.audit('killswitch.engaged', 'renewals', {}); toast('Emergency stop engaged', 'err'); A.render(); } });
    },
    guide: () => A.openModal(`<div class="row spread"><h3>Suggested demo walkthrough</h3><button class="btn sm" data-act="close-layer">Close</button></div><ol style="line-height:1.8;padding-left:20px"><li><b>Overview</b>: compliance donut and expiry forecast show the whole estate at a glance.</li><li><b>Scan</b> lnx01 or win01: every certificate is listed; filter to those expiring within 30 days and enrol them.</li><li><b>Renewal pipeline</b>: run it. Watch discover, landing, match, plan, deploy and confirm. Try <i>Pause</i> and <i>Stop</i>.</li><li>Tick <b>Fail the next deployment</b> and run again: CDM rolls the server back automatically and halts that zone.</li><li><b>Jobs & rollback</b>: roll a successful renewal back, or restore a backup.</li><li><b>Approvals</b>: OV/EV replacements wait for a human decision.</li><li><b>Audit</b>: verify the hash chain, then simulate tampering and verify again.</li><li>Hit <b>Emergency stop</b> to freeze everything during a change window.</li></ol>`),
  });
  window.addEventListener('load', () => { if (!location.hash) location.hash = '#/overview'; route(); });
})();
