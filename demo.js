/* CDM first demo. Five pages: dashboard, certificates, renewal flow, errors, trust store.
   Everything is sample data held in memory: nothing real is contacted, and a page reload starts the demo again. */
(function () {
  'use strict';
  const DAY = 86400000, WINDOW_DAYS = 30;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms * SPEED));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const fmtDate = ms => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const hex = (seed, n) => { let x = 0; for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0; let out = ''; while (out.length < n) { x = (x * 1664525 + 1013904223) >>> 0; out += x.toString(16).padStart(8, '0'); } return out.slice(0, n).toUpperCase(); };
  let SPEED = 1;   // the self-check sets this to 0 so flows finish at once

  const ICON = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    cert: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.500-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    flow: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h8a3 3 0 010 6H9a3 3 0 000 6h8"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.500 4.500"/>',
    store: '<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13v2M15 13v2"/>',
    ticket: '<path d="M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4z"/><path d="M10 9h4M10 15h4"/>',
    pin: '<path d="M12 21s7-6.500 7-12a7 7 0 10-14 0c0 5.500 7 12 7 12z"/><circle cx="12" cy="9" r="2.500"/>',
  };
  const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;

  // ------------------------------------------------------------------ sample data
  const SERVERS = [
    { id: 'web-prod-01', os: 'Linux', tech: 'Nginx', store: '/etc/ssl/certs/ca-certificates.crt' },
    { id: 'web-prod-02', os: 'Linux', tech: 'Apache', store: '/etc/ssl/certs/ca-certificates.crt' },
    { id: 'app-win-01', os: 'Windows', tech: 'IIS', store: 'Cert:\\LocalMachine\\Root' },
    { id: 'app-win-02', os: 'Windows', tech: 'IIS', store: 'Cert:\\LocalMachine\\Root' },
    { id: 'sql-win-01', os: 'Windows', tech: 'Windows store', store: 'Cert:\\LocalMachine\\Root' },
    { id: 'erp-java-01', os: 'Linux', tech: 'Java keystore', store: '/opt/erp/jre/lib/security/cacerts' },
    { id: 'mail-gw-01', os: 'Linux', tech: 'Nginx', store: '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem' },
    { id: 'edge-lb-01', os: 'Linux', tech: 'Apache', store: '/etc/ssl/certs/ca-certificates.crt', unreachable: true },
  ];
  // Issuing CAs, each under its root CA. `via` is how CDM obtains a replacement from it.
  const ISSUERS = [
    { id: 'le-r11', name: "Let's Encrypt R11", root: 'ISRG Root X1', via: 'ACME', life: 90 },
    { id: 'nw-g3', name: 'Northwind Issuing CA G3', root: 'Northwind Root CA G3', via: 'CA folder', life: 365 },
    { id: 'nw-g2', name: 'Northwind Issuing CA G2', root: 'Northwind Root CA G2', via: 'CA folder', life: 365 },
    { id: 'dc-2020', name: 'DigiCert TLS RSA SHA256 2020 CA1', root: 'DigiCert Global Root CA', via: 'CA folder', life: 365 },
    // not issuing CAs CDM renews from: these two groups are shown so they can be found and replaced
    { id: 'self', name: 'Self-signed', flag: 'Self-signed', note: 'Certificates that no CA issued. CDM cannot renew them: replace them with one from an approved issuing CA.' },
    { id: 'unapproved', name: 'Unapproved CA', flag: 'Unapproved', note: 'Certificates from a CA that is not on the approved list. CDM does not renew them.' },
  ];
  const issuerOf = c => ISSUERS.find(i => i.id === c.issuer);
  const serverOf = c => SERVERS.find(s => s.id === c.server);

  const NAMES = ['www', 'portal', 'api', 'shop', 'pay', 'sso', 'mail', 'crm', 'erp', 'hr', 'billing', 'docs', 'support', 'vpn', 'files', 'reports', 'booking', 'checkout', 'intranet', 'status',
    'login', 'orders', 'gateway', 'metrics', 'assets', 'search', 'notify', 'invoices', 'helpdesk', 'wiki', 'vault', 'media', 'news', 'chat', 'store', 'track'];
  const DAYS = [-9, 4, 11, 19, 26, 48, 75, 140, 230, 310, -2, 7, 15, 23, 29, 62, 95, 180, 270, 340, 2, 9, 17, 25, 54, 88, 160, 210, 300, 21, 13, 6, 44, 120, 250, 28];
  const ISSUER_MIX = ['le-r11', 'le-r11', 'nw-g3', 'le-r11', 'dc-2020', 'nw-g3', 'le-r11', 'nw-g2', 'le-r11', 'nw-g3'];
  const FLAGGED = [['printer-gw.local', 'self', 410], ['ilo-rack3.local', 'self', 900], ['test-app.internal', 'self', 120], ['jenkins.internal', 'self', 300], ['nas-01.local', 'self', 1500], ['dev-api.internal', 'self', 75],
    ['kiosk-07.local', 'self', 640], ['lab-proxy.internal', 'self', 210], ['grafana.internal', 'self', 365], ['old-crm.northwind-demo.com', 'unapproved', 95], ['partner-sftp.northwind-demo.com', 'unapproved', 180],
    ['legacy-pay.northwind-demo.com', 'unapproved', 260], ['survey.northwind-demo.com', 'unapproved', 50]];
  function locationFor(s, cn) {
    if (s.tech === 'IIS') return `IIS site "Default Web Site" · https:443 · ${cn}`;
    if (s.tech === 'Windows store') return 'Cert:\\LocalMachine\\My';
    if (s.tech === 'Java keystore') return `/opt/erp/conf/keystore.p12 (alias ${cn.split('.')[0]})`;
    return `${s.tech === 'Nginx' ? '/etc/nginx/ssl/' : '/etc/ssl/certs/'}${cn}.crt`;
  }
  function buildCerts() {
    const now = Date.now(), reachable = SERVERS.filter(s => !s.unreachable);
    const list = NAMES.map((n, i) => {
      const s = reachable[i % reachable.length], issuer = ISSUER_MIX[i % ISSUER_MIX.length], cn = `${n}.northwind-demo.com`;
      return { id: 'C' + String(i + 1).padStart(3, '0'), cn, server: s.id, issuer, location: locationFor(s, cn), notAfter: now + DAYS[i] * DAY + 5 * 3600000, thumb: hex(cn, 40), renewed: false, failed: false };
    });
    // two certificates that do not renew cleanly, to show the error path: one the AI agent fixes, one that becomes an incident
    const pay = list.find(c => c.cn.startsWith('pay.')), web = SERVERS[0]; Object.assign(pay, { server: web.id, location: locationFor(web, pay.cn), issuer: 'le-r11', notAfter: now + 5 * DAY, trouble: 'acme' });
    const edge = SERVERS.find(s => s.unreachable);
    list.push({ id: 'C900', cn: 'edge.northwind-demo.com', server: edge.id, issuer: 'le-r11', location: locationFor(edge, 'edge.northwind-demo.com'), notAfter: now + 8 * DAY, thumb: hex('edge', 40), renewed: false, failed: false, trouble: 'unreachable' });
    // certificates outside the approved CAs: found on the servers, listed, never renewed by CDM
    FLAGGED.forEach(([name, issuer, days], i) => { const s = reachable[(i * 3) % reachable.length];
      list.push({ id: 'X' + String(i + 1).padStart(3, '0'), cn: name, server: s.id, issuer, location: locationFor(s, name), notAfter: now + days * DAY, thumb: hex(name, 40), renewed: false, failed: false }); });
    return list;
  }

  // CA certificates and the trust stores that hold them. A few are missing on purpose so the scan has something to find.
  const CA_CERTS = [
    { name: 'ISRG Root X1', kind: 'Root', expires: '04 Jun 2035' },
    { name: 'DigiCert Global Root CA', kind: 'Root', expires: '10 Nov 2031' },
    { name: 'DigiCert Global Root G2', kind: 'Root', expires: '15 Jan 2038' },
    { name: 'DigiCert Global Root G3', kind: 'Root', expires: '15 Jan 2038' },
    { name: 'Northwind Root CA G2', kind: 'Root', expires: '02 Mar 2029' },
    { name: 'Northwind Root CA G3', kind: 'Root', expires: '18 Sep 2041' },
    { name: 'Northwind Issuing CA G2', kind: 'Intermediate', expires: '02 Mar 2027' },
    { name: 'Northwind Issuing CA G3', kind: 'Intermediate', expires: '18 Sep 2033' },
  ];
  const MISSING = {
    'Northwind Root CA G3': ['erp-java-01', 'sql-win-01', 'mail-gw-01'],
    'Northwind Issuing CA G3': ['erp-java-01', 'sql-win-01', 'mail-gw-01', 'app-win-02'],
    'DigiCert Global Root G3': ['erp-java-01'],
    'Northwind Issuing CA G2': ['mail-gw-01'],
  };

  // What the AI agent does with each kind of error, and whether that fixes it. An error it cannot fix becomes an incident.
  const PLAYBOOK = {
    ACME_VALIDATION_FAILED: { fix: true, steps: ['Read the CA response: the proof file was not reachable on port 80', 'Found the web server blocks /.well-known/acme-challenge/', 'Allowed that path and reloaded the web server', 'Asked the CA to validate again: passed'], outcome: 'The challenge path was opened and the validation passed.' },
    BACKUP_FAILED: { fix: true, steps: ['Checked the backup volume: 100% full', 'Removed CDM backups older than the 30-day retention', 'Free space is back to 41%: backup written'], outcome: 'Expired backups were removed, so the backup could be written.' },
    SERVICE_RELOAD_FAILED: { fix: true, steps: ['Read the service log: the binding still pointed at the old thumbprint', 'Re-applied the HTTPS binding and restarted the service', 'The service presents the new certificate'], outcome: 'The binding was re-applied and the service restarted.' },
    SCAN_UNREACHABLE: { fix: false, team: 'Network Operations', steps: ['Tried to connect three times: timed out each time', 'Name resolves, but port 22 does not answer', 'This needs someone with network access'], outcome: 'The server does not answer on its management port.' },
    KEYSTORE_PASSWORD_REJECTED: { fix: false, team: 'Application Support', steps: ['Fetched the keystore password from the vault again', 'The keystore still rejects it: the password was changed outside the vault', 'This needs the application owner'], outcome: 'The vault holds an outdated keystore password.' },
  };

  const STAGES = [
    { key: 'discover', title: 'Discover', text: 'Log in to the server and read the certificate it uses now.' },
    { key: 'landing', title: 'Landing', text: 'Obtain the replacement certificate from the issuing CA.' },
    { key: 'match', title: 'Match', text: 'Check the replacement is the same identity and expires later.' },
    { key: 'plan', title: 'Plan', text: 'Create the deployment job.' },
    { key: 'deploy', title: 'Deploy', text: 'Back up, install, activate and verify on the server.' },
    { key: 'confirm', title: 'Confirm', text: 'Log in again and check the server serves the new certificate.' },
    { key: 'retire', title: 'Retire', text: 'Remove the replaced certificate after the rollback window.' },
  ];

  const now0 = Date.now();
  const S = {
    ca: 'all',                       // the issuing CA in scope ('all' or an issuer id)
    certs: buildCerts(),
    filter: 'all', q: '',            // certificates page
    flows: {}, queue: [], sel: null, stage: null, busy: false,   // renewal page
    errors: [], errSeq: 0, openErr: null,
    trust: { q: 'G3', scanning: false, progress: 0, results: null, pick: null },
  };
  // errors that were already there when the demo starts: one fixed by the agent, one incident, one waiting for the agent.
  // Each belongs to a real certificate on a server of the right kind.
  const pickCert = (server, wantDue) => S.certs.find(c => c.server === server && !c.trouble && ((c.notAfter - now0) / DAY <= WINDOW_DAYS) === wantDue);
  [['SERVICE_RELOAD_FAILED', pickCert('app-win-02', false), 'The service did not start with the new certificate', 30, 'resolved'],
    ['KEYSTORE_PASSWORD_REJECTED', pickCert('erp-java-01', true), 'keytool: keystore password was incorrect', 22, 'incident'],
    ['BACKUP_FAILED', pickCert('web-prod-02', true), 'Cannot write the backup: no space left on device', 2, 'logged']].forEach(([code, c, message, hoursAgo, status]) => {
    const e = logError({ code, stage: 'Deploy', cn: c.cn, server: c.server, message, at: now0 - hoursAgo * 3600000 }), p = PLAYBOOK[code];
    if (status !== 'logged') { e.agent = p.steps.slice(); e.status = status; }
    if (status === 'incident') { e.incident = 'INC0041872'; e.team = p.team; c.failed = true; }   // its renewal waits for the incident
  });

  // ------------------------------------------------------------------ derived values
  const daysLeft = c => (c.notAfter - Date.now()) / DAY;
  const statusOf = c => (c.renewed ? 'renewed' : daysLeft(c) < 0 ? 'expired' : daysLeft(c) <= WINDOW_DAYS ? 'expiring' : 'valid');
  // due = needs renewal and can be started. A certificate whose renewal ended in an incident waits for that incident.
  const due = c => !c.renewed && !c.failed && !issuerOf(c).flag && daysLeft(c) <= WINDOW_DAYS;
  const scoped = () => S.certs.filter(c => S.ca === 'all' || c.issuer === S.ca);
  const dueList = () => scoped().filter(due).sort((a, b) => a.notAfter - b.notAfter);
  const count = st => scoped().filter(c => statusOf(c) === st).length;
  const openErrors = () => S.errors.filter(e => e.status === 'logged' || e.status === 'agent' || e.status === 'incident');
  const STATUS = { expired: ['Expired', 'red'], expiring: [`Expiring in ${WINDOW_DAYS} days`, 'orange'], valid: ['Valid', 'green'], renewed: ['Renewed', 'blue'] };
  const pill = (text, color) => `<span class="pill ${color}">${esc(text)}</span>`;
  const expiryText = c => { const d = Math.round(daysLeft(c)); return d < 0 ? `${plural(-d, 'day')} ago` : `in ${plural(d, 'day')}`; };

  // ------------------------------------------------------------------ errors and the AI agent
  function logError(o) {
    const e = { id: 'ERR-' + String(++S.errSeq).padStart(4, '0'), at: o.at || Date.now(), code: o.code, stage: o.stage, cn: o.cn, server: o.server, message: o.message, status: 'logged', agent: [], incident: null, team: null };
    S.errors.unshift(e); return e;
  }
  // The agent works through its steps for this kind of error. Returns true when the error is fixed; otherwise an incident is raised.
  async function runAgent(e) {
    const p = PLAYBOOK[e.code] || { fix: false, team: 'PKI Operations', steps: ['No known fix for this error'], outcome: '' };
    e.status = 'agent'; e.agent = []; S.openErr = e.id; render();
    for (const line of p.steps) { await wait(750); e.agent.push(line); render(); }
    await wait(500);
    if (p.fix) e.status = 'resolved';
    else { e.status = 'incident'; e.incident = 'INC00' + (41873 + S.errors.filter(x => x.incident).length); e.team = p.team; }
    render(); return p.fix;
  }

  // ------------------------------------------------------------------ renewal flow
  // The lines a stage reports when it succeeds, or the error it ends with.
  function stageWork(c, key, job) {
    const s = serverOf(c), ca = issuerOf(c), d = Math.round(daysLeft(c));
    if (key === 'discover') {
      if (c.trouble === 'unreachable') return { fail: { code: 'SCAN_UNREACHABLE', message: `Could not connect to ${s.id}: connection timed out` } };
      return { lines: [`Logged in to ${s.id} (${s.os}, ${s.tech}), read-only`, `Found the certificate at ${c.location}`, d < 0 ? `It expired ${plural(-d, 'day')} ago: due for renewal` : `${plural(d, 'day')} left, inside the ${WINDOW_DAYS}-day renewal window`] };
    }
    if (key === 'landing') {
      if (c.trouble === 'acme' && !c.fixed) return { fail: { code: 'ACME_VALIDATION_FAILED', message: `The CA could not reach the proof file on http://${c.cn}/ (port 80)` } };
      return { lines: ca.via === 'ACME' ? ['New private key and CSR created', `Ordered from ${ca.name} over ACME`, 'Name validated and certificate issued'] : [`Replacement issued by ${ca.name} picked up from the CA folder`, 'It comes with its private key and chain'] };
    }
    if (key === 'match') return { lines: ['Same name as the certificate on the server', 'Different thumbprint and a later expiry', `Issued by the selected CA, ${ca.name}`] };
    if (key === 'plan') return { lines: [`Deployment job ${job} created for ${s.id}`] };
    if (key === 'deploy') return { lines: ['Precheck: the server still has the certificate the plan was made for', 'Old certificate and key backed up', `New certificate installed and ${s.os === 'Windows' ? 'bound to the service' : 'the web server reloaded'}`, 'Verified: the server presents the new certificate'] };
    if (key === 'confirm') return { lines: ['Logged in again and read the certificate', 'Its thumbprint matches the one that was deployed'] };
    return { lines: ['The replaced certificate stays for 7 days as the way back', 'After that CDM removes it from the server'] };
  }
  async function runFlow(id) {
    const c = S.certs.find(x => x.id === id), job = 'JOB-' + hex(id + Date.now(), 8);
    const f = S.flows[id] = { status: 'running', stages: STAGES.map(() => ({ status: 'pending', lines: [] })), error: null, before: c.notAfter };
    for (let i = 0; i < STAGES.length; i++) {
      const st = f.stages[i]; st.status = 'running'; if (S.sel === id) S.stage = i; render(); await wait(800);
      let r = stageWork(c, STAGES[i].key, job);
      if (r.fail) {
        st.status = 'failed'; st.lines = [r.fail.message];
        const e = logError({ code: r.fail.code, stage: STAGES[i].title, cn: c.cn, server: c.server, message: r.fail.message });
        f.error = e.id; f.status = 'agent'; st.status = 'agent'; render();
        if (!(await runAgent(e))) { st.status = 'failed'; f.status = 'failed'; c.failed = true; render(); return f; }
        c.fixed = true; st.lines.push(`Fixed by the AI agent (${e.id}): running this stage again`); st.status = 'running'; f.status = 'running'; render(); await wait(800);
        r = stageWork(c, STAGES[i].key, job);
      }
      st.lines.push(...r.lines); st.status = 'done';
      if (STAGES[i].key === 'deploy') { c.thumb = hex(c.cn + job, 40); c.notAfter = Date.now() + issuerOf(c).life * DAY; }
    }
    c.renewed = true; c.failed = false; f.status = 'done'; render(); return f;
  }
  // Renew the given certificates one after another; the page follows the one that is running.
  async function startRenewal(ids) {
    if (S.busy || !ids.length) return;
    S.busy = true; S.queue = ids.slice(); S.flows = {}; S.sel = ids[0]; S.stage = 0; go('renewal');
    for (const id of S.queue) { if (!S.follow) S.sel = id; await runFlow(id); await wait(300); }
    S.busy = false; render();
  }

  // ------------------------------------------------------------------ trust store scan
  // Where one CA certificate is: a row per server's trust store, found, missing, or not scanned (server unreachable).
  function trustState(ca) {
    const rows = SERVERS.map(s => ({ server: s.id, os: s.os, store: s.store, state: s.unreachable ? 'unknown' : (MISSING[ca.name] || []).includes(s.id) ? 'missing' : 'found' }));
    return { ...ca, thumb: hex(ca.name, 40), rows, scanned: rows.filter(r => r.state !== 'unknown').length, found: rows.filter(r => r.state === 'found'), missing: rows.filter(r => r.state === 'missing') };
  }
  // Looks in every trust store for CA certificates whose name contains the text, and reports where each one is and is not.
  async function scanTrust(text) {
    const q = text.trim(); if (!q || S.trust.scanning) return;
    Object.assign(S.trust, { q, scanning: true, progress: 0, results: null, pick: null }); render();
    for (let i = 0; i < SERVERS.length; i++) { await wait(260); S.trust.progress = (i + 1) / SERVERS.length; S.trust.at = SERVERS[i].id; render(); }
    const hits = CA_CERTS.filter(ca => ca.name.toLowerCase().includes(q.toLowerCase())).map(trustState).sort((a, b) => (a.kind === 'Root' ? 0 : 1) - (b.kind === 'Root' ? 0 : 1) || b.missing.length - a.missing.length);   // roots first, then the ones missing in most places
    Object.assign(S.trust, { scanning: false, results: hits, pick: hits.length ? hits[0].name : null }); render();
  }

  // ------------------------------------------------------------------ pages
  const head = (title, sub) => `<div class="top"><div><h1>${title}</h1><p>${sub}</p></div>
    <div class="scope"><label for="ca">Issuing CA</label><select id="ca" data-change="ca"><option value="all" ${S.ca === 'all' ? 'selected' : ''}>All issuing CAs</option>${ISSUERS.map(i => `<option value="${i.id}" ${S.ca === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div></div>`;
  const stat = (label, n, color, act) => `<${act ? `button data-act="${act}"` : 'div'} class="stat ${color}"><div class="lbl">${label}</div><div class="num">${n}</div></${act ? 'button' : 'div'}>`;

  // dashboard figure: label and a short hint on the left, the number on the right, and it opens the matching list
  const kpi = (label, hint, n, color, act) => `<button class="kpi ${color}" data-act="${act}"><span><b>${label}</b><small>${hint}</small></span><span class="num">${n}</span></button>`;

  const PAGES = {
    dashboard() {
      const list = scoped(), dueN = dueList().length, ca = ISSUERS.find(i => i.id === S.ca);
      // chart: one bar per issuing CA plus the two flagged groups. The axis ends on a round number above the tallest bar.
      const bars = ISSUERS.map(i => ({ i, n: S.certs.filter(c => c.issuer === i.id).length, d: S.certs.filter(c => c.issuer === i.id && due(c)).length }));
      const top = Math.max(...bars.filter(b => !b.i.flag).map(b => b.n)), step = Math.max(1, Math.ceil(Math.max(...bars.map(b => b.n)) / 4 / 5) * 5), axisMax = step * 4;
      const ticks = [0, 1, 2, 3, 4].map(k => k * step), initials = name => name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
      const kind = b => (b.i.flag ? 'flag' : b.n === top ? 'lead' : '');
      const tticks = Array.from({ length: Math.floor(SERVERS.length / 2) + 1 }, (_, k) => k * 2);   // 0, 2, 4 … up to the number of trust stores
      const trust = CA_CERTS.map(trustState).sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));   // the ones missing in most places first
      return `${head('Dashboard', !ca ? 'Certificates from every issuing CA' : ca.flag ? esc(ca.note) : `Certificates issued by ${esc(ca.name)}, under ${esc(ca.root)}`)}
        <div class="stack">
          <div class="summary"><div class="total"><div class="num">${list.length}</div><div class="lbl">Total certificates</div></div>
            ${kpi('Expired', 'past their expiry date', count('expired'), 'red', 'filter:expired')}${kpi(`Expiring in ${WINDOW_DAYS} days`, 'inside the renewal window', count('expiring'), 'orange', 'filter:expiring')}${kpi('Renewed', 'by CDM in this session', count('renewed'), 'blue', 'filter:renewed')}${kpi('Open errors', 'waiting, or raised as incidents', openErrors().length, 'violet', 'go:errors')}</div>
          <div class="card next"><div><h3>${dueN ? `${plural(dueN, 'certificate')} need${dueN === 1 ? 's' : ''} renewal` : 'Nothing needs renewal'}</h3><div class="sub">${dueN ? `Expired or expiring within ${WINDOW_DAYS} days${ca ? `, issued by ${esc(ca.name)}` : ''}.` : ca && ca.flag ? 'CDM does not renew these certificates.' : 'Every certificate in scope is valid for more than 30 days.'}</div></div>
            <div class="row"><a class="btn" href="#/certificates" data-act="filter:due">View them</a><button class="btn primary" data-act="renew-all" ${dueN && !S.busy ? '' : 'disabled'}>${icon('play')}Renew all</button></div></div>
          <div class="charts"><div class="card chartcard"><div class="row spread"><h3>Certificates by issuing CA</h3>
              <div class="legend"><span><i class="k"></i>Issuing CA</span><span><i class="k lead"></i>Most certificates</span><span><i class="k flag"></i>Needs attention</span></div></div>
            <div class="chart" role="group" aria-label="Certificates by issuing CA"><div class="axis" aria-hidden="true">${ticks.map(v => `<span style="bottom:${v / axisMax * 100}%">${v}</span>`).join('')}</div>
              <div class="plotarea"><div class="lines" aria-hidden="true">${ticks.map(v => `<i style="bottom:${v / axisMax * 100}%"></i>`).join('')}</div>
                <div class="bars">${bars.map(b => `<button class="bar ${kind(b)} ${S.ca === b.i.id ? 'on' : ''}" data-act="ca:${S.ca === b.i.id ? 'all' : b.i.id}" aria-pressed="${S.ca === b.i.id}" title="${esc(b.i.name)}: ${plural(b.n, 'certificate')}">
                  <span class="plot"><span class="col" style="--h:${(b.n / axisMax).toFixed(4)}"><span class="v">${b.n}</span></span></span>
                  <span class="tag">${esc(initials(b.i.name))}</span><small><b>${esc(b.i.name)}</b>${b.i.flag ? 'not renewed by CDM' : b.d ? `${b.d} to renew` : 'none to renew'}</small></button>`).join('')}</div></div></div></div>
            <div class="card trustcard"><div class="row spread"><h3>Trust stores</h3><div class="legend"><span><i class="k found"></i>Found</span><span><i class="k missing"></i>Missing</span><span><i class="k unknown"></i>Not scanned</span></div></div>
              <div class="hchart" role="group" aria-label="CA certificates in trust stores">${trust.map(t => `<button class="hrow" data-act="trust:${esc(t.name)}" title="${esc(t.name)}: found in ${t.found.length} of ${t.scanned} scanned trust stores, missing in ${t.missing.length}">
                <span class="hname">${esc(t.name)}</span>
                <span class="htrack" aria-hidden="true">${[['seg-ok', t.found.length], ['seg-miss', t.missing.length], ['seg-na', t.rows.length - t.scanned]].map(([k, n]) => (n ? `<i class="${k}" style="width:${n / t.rows.length * 100}%">${n}</i>` : '')).join('')}</span></button>`).join('')}
                <div class="haxis" aria-hidden="true"><span></span><span class="hticks">${tticks.map(v => `<i style="left:${v / SERVERS.length * 100}%">${v}</i>`).join('')}</span></div>
                <div class="hcap">Number of server trust stores</div></div></div></div>
        </div>`;
    },

    certificates() {
      const all = scoped(), f = S.filter, q = S.q.trim().toLowerCase();
      const rows = all.filter(c => (f === 'all' || (f === 'due' ? due(c) : statusOf(c) === f)) && (!q || (c.cn + ' ' + c.server + ' ' + issuerOf(c).name).toLowerCase().includes(q))).sort((a, b) => a.notAfter - b.notAfter);
      const fb = (key, label, n) => `<button class="${f === key ? 'on' : ''}" data-act="filter:${key}"><span>${label}</span><b>${n}</b></button>`;
      return `${head('Certificates', 'What is on the servers, and what needs renewing')}
        <div class="split"><div class="stack"><div class="total"><div class="num">${all.length}</div><div class="lbl">Total certificates</div></div>
            <div class="card filters"><h4>Show</h4>${fb('all', 'All', all.length)}${fb('due', 'Need renewal', all.filter(due).length)}${fb('expired', 'Expired', count('expired'))}${fb('expiring', `In ${WINDOW_DAYS} days`, count('expiring'))}${fb('valid', 'Valid', count('valid'))}${fb('renewed', 'Renewed', count('renewed'))}</div></div>
          <div class="card tablecard"><div class="bar-top"><label class="search">${icon('search')}<input id="q" placeholder="Search certificates…" value="${esc(S.q)}" data-input="q" aria-label="Search certificates"></label>
              <button class="btn primary" data-act="renew-all" ${all.some(due) && !S.busy ? '' : 'disabled'}>${icon('play')}Renew all (${all.filter(due).length})</button></div>
            <div class="scroll"><table class="table"><thead><tr><th>Name</th><th>Issuer</th><th>Expiration</th><th>Status</th><th></th></tr></thead><tbody>
              ${rows.map(c => { const [t, col] = STATUS[statusOf(c)];
                return `<tr><td><span class="name">${esc(c.cn)}</span><small>${esc(c.server)} · ${esc(serverOf(c).tech)}</small></td><td>${esc(issuerOf(c).name)}</td><td>${fmtDate(c.notAfter)}<small style="color:var(--${statusOf(c) === 'expired' ? 'red' : 'muted'})">${expiryText(c)}</small></td><td>${c.failed ? pill('Renewal failed', 'red') : issuerOf(c).flag ? pill(issuerOf(c).flag, 'red') : pill(t, col)}</td>
                  <td class="right">${due(c) ? `<button class="btn sm" data-act="renew:${c.id}" ${S.busy ? 'disabled' : ''}>Renew</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No certificate matches.</td></tr>'}
            </tbody></table></div></div></div>`;
    },

    renewal() {
      if (!S.queue.length) {
        const list = dueList();
        return `${head('Renewal', 'One certificate, start to finish, in seven stages')}
          <div class="card tablecard"><div class="bar-top"><div style="flex:1"><h3>Choose a certificate to renew</h3><div class="sub">${list.length ? `${plural(list.length, 'certificate')} in scope ${list.length === 1 ? 'is' : 'are'} expired or expiring within ${WINDOW_DAYS} days.` : 'No certificate in scope needs renewal. Choose another issuing CA, or reload the page to start the demo again.'}</div></div>
              <button class="btn primary" data-act="renew-all" ${list.length ? '' : 'disabled'}>${icon('play')}Renew all (${list.length})</button></div>
            ${list.length ? `<div class="scroll"><table class="table"><tbody>${list.slice(0, 6).map(c => `<tr><td><span class="name">${esc(c.cn)}</span><small>${esc(c.server)} · ${esc(serverOf(c).tech)}</small></td><td>${esc(issuerOf(c).name)}</td><td>${pill(...STATUS[statusOf(c)])}<small>${expiryText(c)}</small></td><td class="right"><button class="btn sm primary" data-act="renew:${c.id}">Renew</button></td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
      }
      const c = S.certs.find(x => x.id === S.sel), f = S.flows[c.id], at = S.stage == null ? 0 : S.stage, st = f ? f.stages[at] : null, err = f && f.error ? S.errors.find(e => e.id === f.error) : null;
      const doneN = S.queue.filter(id => (S.flows[id] || {}).status === 'done').length, failN = S.queue.filter(id => (S.flows[id] || {}).status === 'failed').length;
      const qStatus = id => (S.flows[id] ? S.flows[id].status : 'pending'), WORD = { pending: 'Waiting', running: 'Renewing', agent: 'AI agent working', done: 'Renewed', failed: 'Incident raised' };
      const outcome = !f ? '' : f.status === 'done' ? `<div class="note green">${icon('check')}<div><b>Renewed and confirmed</b><span>${esc(c.cn)} is now valid until ${fmtDate(c.notAfter)}${err ? `. An error on the way (${err.id}) was fixed by the AI agent.` : '.'}</span></div></div>`
        : f.status === 'failed' ? `<div class="note red">${icon('ticket')}<div><b>Not renewed: incident ${esc(err.incident)} raised</b><span>${esc(err.message)}. The AI agent could not fix it, so it is assigned to ${esc(err.team)}. <a href="#/errors">See the error</a></span></div></div>`
        : f.status === 'agent' ? `<div class="note violet">${icon('bot')}<div><b>The AI agent is working on ${esc(err.id)}</b><span>${esc(err.agent[err.agent.length - 1] || err.message)}</span></div></div>` : '';
      return `${head('Renewal', S.busy ? `Renewing ${plural(S.queue.length, 'certificate')}: ${doneN} done${failN ? `, ${failN} not renewed` : ''}` : `Finished: ${doneN} renewed${failN ? `, ${failN} not renewed` : ''}`)}
        <div class="flow"><div class="card queue"><h4>${S.queue.length === 1 ? 'Certificate' : `Certificates (${S.queue.length})`}</h4>
            ${S.queue.map(id => { const x = S.certs.find(k => k.id === id); return `<button class="${id === S.sel ? 'on' : ''}" data-act="pick:${id}"><span class="dot ${qStatus(id)}"></span><span><b>${esc(x.cn)}</b><small>${WORD[qStatus(id)]}</small></span></button>`; }).join('')}</div>
          <div class="card"><div class="row spread"><div><h3>${esc(c.cn)}</h3><div class="sub">${esc(c.server)} · ${esc(serverOf(c).tech)} · ${esc(issuerOf(c).name)}</div></div>
              ${S.busy ? '' : `<button class="btn" data-act="new-renewal">Renew another</button>`}</div>
            <ol class="steps">${STAGES.map((g, i) => { const s = f ? f.stages[i].status : 'pending'; return `<li><button class="step ${s} ${i === at ? 'sel' : ''}" data-act="stage:${i}" aria-label="${g.title}: ${s}"><span class="n">${s === 'done' ? '✓' : s === 'failed' ? '!' : i + 1}</span><b>${g.title}</b></button></li>`; }).join('')}</ol>
            <div class="detail"><h4>${at + 1}. ${STAGES[at].title}</h4><div class="muted">${STAGES[at].text}</div>${st && st.lines.length ? `<ul>${st.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div>
            ${outcome}</div></div>`;
    },

    errors() {
      const n = st => S.errors.filter(e => e.status === st).length;
      const step = (label, state, color) => `<li class="${state}" ${color ? `style="--c:var(--${color})"` : ''}><i>${state === 'ok' ? '✓' : ''}</i>${label}</li>`;
      return `${head('Errors', 'Every error is logged, the AI agent tries to fix it, and what it cannot fix becomes an incident')}
        <div class="stack"><div class="stats">${stat('Logged', S.errors.length, 'blue')}${stat('Fixed by the AI agent', n('resolved'), 'green')}${stat('Incidents raised', n('incident'), 'red')}${stat('Waiting for the agent', n('logged') + n('agent'), 'violet')}</div>
          ${S.errors.map(e => { const open = S.openErr === e.id, done = e.status === 'resolved' || e.status === 'incident';
            return `<div class="card err"><div class="err-head"><div><b>${esc(e.cn)}</b><small>${e.id} · ${esc(e.stage)} · ${esc(e.server)} · ${fmtDate(e.at)}</small></div>
                <ol class="track">${step('Error logged', 'ok', 'blue')}${step('AI agent', e.status === 'agent' ? 'now' : done ? 'ok' : '', 'violet')}${step(e.status === 'incident' ? `Incident ${esc(e.incident)}` : e.status === 'resolved' ? 'Resolved' : 'Resolved or incident', done ? 'ok' : '', e.status === 'incident' ? 'red' : 'green')}</ol>
                <div class="row">${e.status === 'logged' ? `<button class="btn sm primary" data-act="agent:${e.id}">${icon('bot')}Run AI agent</button>` : ''}<button class="btn sm" data-act="err:${e.id}">${open ? 'Hide' : 'Details'}</button></div></div>
              ${open ? `<div class="err-body"><b class="mono">${esc(e.code)}</b> · ${esc(e.message)}
                ${e.agent.length ? `<ul>${e.agent.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<div class="muted" style="margin-top:6px">The AI agent has not looked at this error yet.</div>'}
                ${e.status === 'resolved' ? `<div class="note green">${icon('check')}<div><b>Resolved by the AI agent</b><span>${esc((PLAYBOOK[e.code] || {}).outcome || '')}</span></div></div>` : ''}
                ${e.status === 'incident' ? `<div class="note red">${icon('ticket')}<div><b>Incident ${esc(e.incident)} raised</b><span>${esc((PLAYBOOK[e.code] || {}).outcome || '')} Assigned to ${esc(e.team)}.</span></div></div>` : ''}</div>` : ''}</div>`; }).join('') || '<div class="card empty">No errors.</div>'}
        </div>`;
    },

    trust() {
      const t = S.trust, hit = t.results && t.results.find(h => h.name === t.pick), STATE = { found: ['Found', 'green'], missing: ['Not found', 'red'], unknown: ['Not scanned', 'grey'] };
      return `${head('Trust store scan', 'Find where a CA certificate is, and where it is missing')}
        <div class="stack"><div class="card"><h3>Which CA certificate are you looking for?</h3><div class="sub">Type part of its name. CDM looks in the trust store of every server.</div>
            <form class="ask" data-submit="scan"><label class="search">${icon('search')}<input id="tq" value="${esc(t.q)}" placeholder="For example G3" data-input="tq" aria-label="CA certificate name"></label>
              <button class="btn primary" ${t.scanning ? 'disabled' : ''}>${icon('store')}${t.scanning ? 'Scanning…' : 'Scan trust stores'}</button></form>
            <div class="chips">Try: ${['G3', 'G2', 'ISRG', 'DigiCert'].map(x => `<button type="button" data-act="try:${x}">${x}</button>`).join('')}</div>
            ${t.scanning ? `<div class="progress"><i style="width:${t.progress * 100}%"></i></div><div class="sub" style="margin-top:8px">Reading the trust store on ${esc(t.at || SERVERS[0].id)}…</div>` : ''}</div>
          ${!t.results ? '' : !t.results.length ? `<div class="card empty">No CA certificate with "${esc(t.q)}" in its name is in any trust store.</div>` : `
          <div class="split"><div class="card found"><h4>Matches for "${esc(t.q)}" (${t.results.length})</h4>${t.results.map(h => `<button class="${h.name === t.pick ? 'on' : ''}" data-act="hit:${esc(h.name)}"><b>${esc(h.name)}</b><small>${h.kind} · in ${h.found.length} of ${h.scanned} trust stores</small></button>`).join('')}</div>
            <div class="stack"><div class="stats">${stat('Trust stores scanned', hit.scanned, 'blue')}${stat('Found in', hit.found.length, 'green')}${stat('Missing in', hit.missing.length, 'red')}</div>
              <div class="card tablecard">${hit.found.length ? `<div class="source">${icon('pin')}<div><b>${esc(hit.name)} can be picked from ${esc(hit.found[0].server)}</b><div class="mono">${esc(hit.found[0].store)}</div><div class="sub">${hit.kind} CA · valid until ${hit.expires} · SHA-1 ${hit.thumb.slice(0, 20)}…</div></div></div>` : ''}
                <div class="scroll"><table class="table"><thead><tr><th>Server</th><th>Trust store</th><th>${esc(hit.name)}</th></tr></thead><tbody>
                  ${hit.rows.slice().sort((a, b) => 'missing found unknown'.indexOf(a.state) - 'missing found unknown'.indexOf(b.state)).map(r => `<tr><td><span class="name">${esc(r.server)}</span><small>${r.os}</small></td><td class="mono">${esc(r.store)}</td><td>${pill(...STATE[r.state])}${r.state === 'unknown' ? '<small>server unreachable</small>' : ''}</td></tr>`).join('')}</tbody></table></div></div></div></div>`}
        </div>`;
    },
  };

  // ------------------------------------------------------------------ shell, routing, events
  const NAV = [['dashboard', 'Dashboard', 'dashboard'], ['certificates', 'Certificates', 'cert'], ['renewal', 'Renewal', 'flow'], ['errors', 'Errors', 'alert'], ['trust', 'Trust store', 'store']];
  let page = 'dashboard';
  const go = p => { if (location.hash !== '#/' + p) location.hash = '#/' + p; else render(); };
  function render() {
    const waiting = openErrors().length;
    $('#rail').innerHTML = `<div class="logo">CDM</div>${NAV.map(([k, label, ic]) => `<a href="#/${k}" class="${k === page ? 'on' : ''}" ${k === page ? 'aria-current="page"' : ''}>${icon(ic)}${k === 'errors' && waiting ? `<span class="badge">${waiting}</span>` : ''}<span>${label}</span></a>`).join('')}
      <div class="grow"></div><div class="foot">Demo · sample data<br><a href="full.html">Detailed prototype</a></div>`;
    const el = $('#view'), html = PAGES[page](), active = document.activeElement, id = active && active.id, pos = id && active.selectionStart;
    if (el._h !== html) { el.innerHTML = html; el._h = html; if (id && $('#' + id)) { const again = $('#' + id); again.focus(); if (pos != null && again.setSelectionRange) again.setSelectionRange(pos, pos); } }
  }
  function route() { const p = (location.hash.match(/^#\/(\w+)/) || [])[1]; page = PAGES[p] ? p : 'dashboard'; render(); window.scrollTo(0, 0); }

  const ACTIONS = {
    ca: v => { S.ca = v; render(); },
    filter: v => { S.filter = v; go('certificates'); },
    go: v => go(v),
    renew: id => startRenewal([id]),
    'renew-all': () => startRenewal(dueList().map(c => c.id)),
    'new-renewal': () => { S.queue = []; S.flows = {}; S.sel = null; S.follow = false; render(); },
    pick: id => { S.sel = id; S.follow = S.busy; const f = S.flows[id]; S.stage = f ? Math.max(0, f.stages.map(s => s.status).lastIndexOf('done')) : 0; if (f && f.status !== 'done') S.stage = Math.max(0, f.stages.findIndex(s => s.status !== 'done')); render(); },
    stage: i => { S.stage = +i; render(); },
    agent: id => { const e = S.errors.find(x => x.id === id); if (e && e.status === 'logged') runAgent(e); },
    err: id => { S.openErr = S.openErr === id ? null : id; render(); },
    try: v => scanTrust(v),
    trust: name => { go('trust'); scanTrust(name); },   // from the dashboard: open the scan for that CA certificate
    hit: v => { S.trust.pick = v; render(); },
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const [name, ...rest] = el.dataset.act.split(':'), fn = ACTIONS[name]; if (!fn) return;
    if (el.tagName !== 'A') e.preventDefault(); fn(rest.join(':'));
  });
  document.addEventListener('change', e => { if (e.target.dataset.change === 'ca') ACTIONS.ca(e.target.value); });
  document.addEventListener('input', e => { const k = e.target.dataset.input; if (k === 'q') { S.q = e.target.value; render(); } else if (k === 'tq') S.trust.q = e.target.value; });
  document.addEventListener('submit', e => { if (e.target.dataset.submit === 'scan') { e.preventDefault(); scanTrust($('#tq').value); } });
  window.addEventListener('hashchange', route);
  window.addEventListener('load', () => { route(); if (/[?&]check/.test(location.search)) setTimeout(selfCheck, 50); });

  // ------------------------------------------------------------------ self-check (open the page with ?check)
  async function selfCheck() {
    const out = [], t = (name, ok, extra) => out.push({ name, ok: !!ok, extra });
    try {
      SPEED = 0;
      t('every page renders', NAV.every(([k]) => { page = k; return PAGES[k]().length > 200; }));
      t('there are certificates to renew', dueList().length >= 10, dueList().length);
      { const html = PAGES.dashboard(), flagged = S.certs.filter(c => issuerOf(c).flag);
        t('the chart has a bar for every issuing CA and highlights self-signed, unapproved and the largest CA', (html.match(/class="bar /g) || []).length === ISSUERS.length && (html.match(/class="bar flag /g) || []).length === 2 && (html.match(/class="bar lead /g) || []).length === 1 && /Self-signed/.test(html) && /Unapproved CA/.test(html));
        t('the dashboard has a separate trust store chart with a row per CA certificate', /class="card trustcard"/.test(html) && (html.match(/class="hrow"/g) || []).length === CA_CERTS.length && (html.match(/<i class="seg-miss"/g) || []).length === Object.keys(MISSING).length && /Number of server trust stores/.test(html) && !/Select a bar/.test(html) && html.indexOf('class="summary"') < html.indexOf('class="charts"'));
        t('self-signed and unapproved certificates are listed but never offered for renewal', flagged.length > 5 && flagged.every(c => !due(c)) && !dueList().some(c => issuerOf(c).flag)); }
      const total = S.certs.length; ACTIONS.ca('nw-g3');
      t('choosing an issuing CA limits what is shown', scoped().length > 0 && scoped().length < total && scoped().every(c => c.issuer === 'nw-g3') && PAGES.dashboard().includes('Northwind Root CA G3'));
      const one = dueList()[0]; await startRenewal([one.id]);
      t('a certificate renews through all seven stages', S.flows[one.id].status === 'done' && S.flows[one.id].stages.every(s => s.status === 'done' && s.lines.length) && one.renewed && !due(one) && statusOf(one) === 'renewed', S.flows[one.id].stages.map(s => s.status).join());
      ACTIONS['new-renewal'](); ACTIONS.ca('all');
      const pay = S.certs.find(c => c.trouble === 'acme'), before = S.errors.length; await startRenewal([pay.id]);
      const fixed = S.errors.find(e => e.cn === pay.cn);
      t('an error the AI agent can fix is logged, fixed, and the renewal completes', S.errors.length === before + 1 && fixed.status === 'resolved' && fixed.agent.length > 2 && S.flows[pay.id].status === 'done' && pay.renewed);
      ACTIONS['new-renewal']();
      const edge = S.certs.find(c => c.trouble === 'unreachable'); await startRenewal([edge.id]);
      const inc = S.errors.find(e => e.cn === edge.cn);
      t('an error the AI agent cannot fix becomes an incident', inc.status === 'incident' && /^INC\d+/.test(inc.incident) && inc.team && S.flows[edge.id].status === 'failed' && !edge.renewed && /incident/i.test(PAGES.renewal()));
      const waitingErr = S.errors.find(e => e.status === 'logged'); await runAgent(waitingErr);
      t('Run AI agent resolves a logged error', waitingErr.status === 'resolved');
      ACTIONS['new-renewal'](); const n = dueList().length; await startRenewal(dueList().map(c => c.id));
      t('Renew all renews every remaining certificate', n > 5 && dueList().filter(c => !c.failed).length === 0 && S.queue.every(id => S.flows[id].status === 'done'), [n, dueList().length]);
      await scanTrust('G3');
      const g3 = S.trust.results.find(h => h.name === 'Northwind Root CA G3');
      t('the trust store scan finds where a CA certificate is and is missing', S.trust.results.length === 3 && g3.found.length === 4 && g3.missing.length === 3 && /can be picked from/.test(PAGES.trust()), S.trust.results.map(h => h.name + ':' + h.found.length + '/' + h.missing.length));
      await scanTrust('nothing-like-this'); t('a name that is in no trust store says so', S.trust.results.length === 0 && /in any trust store/.test(PAGES.trust()));
    } catch (err) { t('exception', false, String(err && err.stack || err)); }
    const pre = document.createElement('pre'); pre.id = 'check-out'; pre.hidden = true; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
    document.title = 'CHECK ' + (out.every(o => o.ok) ? 'PASS ' : 'FAIL ') + out.filter(o => o.ok).length + '/' + out.length;
  }
})();
