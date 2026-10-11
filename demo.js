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
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100"/>',
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
    // one entry for Northwind: its G2 / G3 generations are CA certificates, and belong to the trust store view
    { id: 'nw', name: 'Northwind Issuing CA', root: 'Northwind Root CA', via: 'CA folder', life: 365 },
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
  const ISSUER_MIX = ['le-r11', 'le-r11', 'nw', 'le-r11', 'dc-2020', 'nw', 'le-r11', 'nw', 'le-r11', 'nw'];
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
    errors: [], errSeq: 0, openErr: null, errFilter: 'all',   // errFilter: which tile on the errors page is chosen
    trust: { q: 'G3', scanning: false, progress: 0, results: null, pick: null, deployed: {}, deploying: false },
    // configuration: the path CDM picks a parent CA certificate up from when it deploys it to trust stores. `ca`, `path` and `error` are the add form.
    config: { sources: [{ ca: 'Northwind Root CA G3', path: '/opt/cdm/ca/northwind-root-ca-g3.crt' }], ca: '', path: '', error: '' },   // deployed: 'CA name|server' -> a deployment CDM made
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
      return { lines: ca.via === 'ACME' ? [`New private key and certificate request (CSR) created for ${c.cn}`, `Connected to the ACME service of ${ca.name}`, `Order placed: the CA asks for proof that we control ${c.cn}`, `Proof file published at http://${c.cn}/.well-known/acme-challenge/`, 'The CA fetched the proof file: name validated', 'Order finalised with the CSR: certificate and chain downloaded']
        : [`Connected to the CA folder of ${ca.name}`, `Replacement certificate for ${c.cn} found and picked up`, 'It comes with its private key and chain', 'Private key checked: it belongs to this certificate'] };
    }
    if (key === 'match') return { lines: ['Same name as the certificate on the server', 'Different thumbprint and a later expiry', `Issued by the selected CA, ${ca.name}`] };
    if (key === 'plan') return { lines: [`Deployment job ${job} created for ${s.id}`] };
    if (key === 'deploy') return { lines: ['Precheck: the server still has the certificate the plan was made for', 'Old certificate and key backed up', `New certificate installed and ${s.os === 'Windows' ? 'bound to the service' : 'the web server reloaded'}`, 'Verified: the server presents the new certificate'] };
    if (key === 'confirm') return { lines: ['Logged in again and read the certificate', 'Its thumbprint matches the one that was deployed'] };
    return { lines: ['The replaced certificate stays for 7 days as the way back', 'After that CDM removes it from the server'] };
  }
  // Live Demo: the flow stops here until Next is pressed. S.next is that press.
  const pause = () => new Promise(r => { S.next = () => { S.next = null; r(); }; render(); });
  async function runFlow(id, manual) {
    const c = S.certs.find(x => x.id === id), job = 'JOB-' + hex(id + Date.now(), 8);
    const f = S.flows[id] = { status: 'running', manual: !!manual, at: 0, stages: STAGES.map(() => ({ status: 'pending', lines: [] })), error: null, before: c.notAfter };
    for (let i = 0; i < STAGES.length; i++) {
      const st = f.stages[i]; f.at = i; if (manual) { await pause(); if (f.cancelled) return f; }
      st.status = 'running'; if (manual || S.sel === id) S.stage = i; render(); await wait(800);
      let r = stageWork(c, STAGES[i].key, job);
      if (r.fail) {
        st.status = 'failed'; st.lines = [r.fail.message];
        const e = logError({ code: r.fail.code, stage: STAGES[i].title, cn: c.cn, server: c.server, message: r.fail.message });
        f.error = e.id; f.status = 'agent'; st.status = 'agent'; render();
        if (!(await runAgent(e))) { st.status = 'failed'; f.status = 'failed'; c.failed = true; render(); return f; }
        c.fixed = true; st.lines.push(`Fixed by the AI agent (${e.id}): running this stage again`); st.status = 'running'; f.status = 'running'; render(); await wait(800);
        r = stageWork(c, STAGES[i].key, job);
      }
      for (const line of r.lines) { st.lines.push(line); if (manual) { render(); await wait(750); } }
      st.status = 'done';
      if (STAGES[i].key === 'deploy') { c.thumb = hex(c.cn + job, 40); c.notAfter = Date.now() + issuerOf(c).life * DAY; }
    }
    c.renewed = true; c.failed = false; c.prev = f.before; f.status = 'done'; render(); return f;
  }
  // Renew the given certificates one after another; the page follows the one that is running. `manual` is the Live Demo: one stage per press of Next.
  // locked = a renewal is running right now. A Live Demo that waits for Next does not lock anything: starting another renewal ends it.
  const locked = () => S.busy && !S.next;
  async function startRenewal(ids, manual) {
    if (!ids.length || locked()) return;
    if (S.busy) {
      if (manual && ids[0] === S.sel) { go('renewal'); return; }   // the same certificate: carry on where it stopped
      ACTIONS['stop-demo'](); while (S.busy) await wait(1);
    }
    S.busy = true; S.queue = ids.slice(); S.flows = {}; S.sel = ids[0]; S.stage = 0; go('renewal');
    for (const id of S.queue) { if (!S.follow) S.sel = id; const f = await runFlow(id, manual); if (f.cancelled) { S.queue = []; S.flows = {}; S.sel = null; break; } await wait(300); }
    S.busy = false; render();
  }

  // ------------------------------------------------------------------ trust store scan
  // Where one CA certificate is: a row per scanned server's trust store, found or missing. A server CDM cannot reach is left out.
  function trustState(ca) {
    const rows = SERVERS.filter(s => !s.unreachable).map(s => { const was = (MISSING[ca.name] || []).includes(s.id), dep = S.trust.deployed[ca.name + '|' + s.id];
      return { server: s.id, os: s.os, store: s.store, was, dep, state: !was || (dep && dep.status === 'done') ? 'found' : dep ? 'deploying' : 'missing' }; });
    return { ...ca, thumb: hex(ca.name, 40), rows, scanned: rows.length, found: rows.filter(r => r.state === 'found'), missing: rows.filter(r => r.state !== 'found') };
  }
  // Looks in every trust store for CA certificates whose name contains the text, and reports where each one is and is not.
  async function scanTrust(text) {
    const q = text.trim(); if (!q || S.trust.scanning) return;
    Object.assign(S.trust, { q, scanning: true, progress: 0, results: null, pick: null }); render();
    const list = SERVERS.filter(s => !s.unreachable);
    for (let i = 0; i < list.length; i++) { await wait(260); S.trust.progress = (i + 1) / list.length; S.trust.at = list[i].id; render(); }
    const hits = CA_CERTS.filter(ca => ca.name.toLowerCase().includes(q.toLowerCase())).map(trustState).sort((a, b) => (a.kind === 'Root' ? 0 : 1) - (b.kind === 'Root' ? 0 : 1) || b.missing.length - a.missing.length);   // roots first, then the ones missing in most places
    Object.assign(S.trust, { scanning: false, results: hits, pick: hits.length ? hits[0].name : null }); render();
  }

  // Deploys a CA certificate to trust stores that miss it, one server after another. It is picked up from the path set under
  // Configuration, or without one from a trust store that already has it, checked by thumbprint, and added the way that server's platform adds a trusted CA.
  const sourceOf = name => S.config.sources.find(s => s.ca === name);   // the configured path for a CA certificate, if any
  async function deployTrust(name, servers) {
    const ca = CA_CERTS.find(c => c.name === name); if (!ca || S.trust.deploying) return;
    S.trust.deploying = true;
    for (const server of servers) {
      const hit = trustState(ca), row = hit.rows.find(r => r.server === server), from = hit.rows.find(r => r.state === 'found' && !r.dep);
      const where = sourceOf(name) ? sourceOf(name).path : from && from.server;
      if (!row || row.state !== 'missing' || !where) continue;
      const d = S.trust.deployed[name + '|' + server] = { status: 'running', from: where, line: '' };
      const add = row.os === 'Windows' ? 'Importing with Import-Certificate' : /cacerts$/.test(row.store) ? 'Importing with keytool -importcert' : 'Adding it and rebuilding the CA bundle';
      for (const line of [`Reading it from ${where}`, `Checking the thumbprint ${hit.thumb.slice(0, 12)}…`, 'Backing up the trust store', add, 'Reading the trust store again to verify']) { d.line = line; render(); await wait(450); }
      d.status = 'done'; render();
    }
    S.trust.deploying = false; render();
  }

  // ------------------------------------------------------------------ pages
  // `scope` adds the Issuing CA choice: only for the pages that list certificates, which it limits
  const head = (title, sub, scope) => `<div class="top"><div><h1>${title}</h1><p>${sub}</p></div>${!scope ? '</div>' : `
    <div class="scope"><label for="ca">Issuing CA</label><select id="ca" data-change="ca"><option value="all" ${S.ca === 'all' ? 'selected' : ''}>All issuing CAs</option>${ISSUERS.map(i => `<option value="${i.id}" ${S.ca === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div></div>`}`;
  const stat = (label, n, color, act, on) => `<${act ? `button data-act="${act}" aria-pressed="${!!on}"` : 'div'} class="stat ${color} ${on ? 'on' : ''}"><div class="lbl">${label}</div><div class="num">${n}</div></${act ? 'button' : 'div'}>`;

  // dashboard figure: label and a short hint on the left, the number on the right, and it opens the matching list
  const kpi = (label, hint, n, color, act) => `<button class="kpi ${color}" data-act="${act}"><span><b>${label}</b><small>${hint}</small></span><span class="num">${n}</span></button>`;

  // Everything CDM knows about one certificate, in a panel over the certificates page.
  function certDrawer() {
    const c = S.certs.find(x => x.id === S.cert); if (!c) return '';
    const s = serverOf(c), ca = issuerOf(c), [word, col] = STATUS[statusOf(c)], errs = S.errors.filter(e => e.cn === c.cn), inc = errs.find(e => e.status === 'incident');
    const row = (k, v, mono) => `<dt>${k}</dt><dd ${mono ? 'class="mono"' : ''}>${v}</dd>`, part = (title, rows) => `<h4>${title}</h4><dl class="kv">${rows}</dl>`;
    const state = c.renewed ? `<div class="note green">${icon('check')}<div><b>Renewed by CDM</b><span>The certificate that expired on ${fmtDate(c.prev)} was replaced. The new one is valid until ${fmtDate(c.notAfter)}.</span></div></div>`
      : ca.flag ? `<div class="note red">${icon('alert')}<div><b>${esc(ca.flag)}: CDM does not renew this certificate</b><span>${esc(ca.note)}</span></div></div>`
      : c.failed ? `<div class="note red">${icon('ticket')}<div><b>Renewal failed${inc ? `: incident ${esc(inc.incident)} raised` : ''}</b><span>${inc ? `${esc(inc.message)}. Assigned to ${esc(inc.team)}. ` : ''}The renewal waits for the incident.</span></div></div>`
      : due(c) ? `<div class="note orange">${icon('alert')}<div><b>${daysLeft(c) < 0 ? 'Expired' : 'Due for renewal'}</b><span>${daysLeft(c) < 0 ? `It expired ${expiryText(c)}.` : `It expires ${expiryText(c)}, inside the ${WINDOW_DAYS}-day renewal window.`}</span></div>
          <button class="btn primary" data-act="renew:${c.id}" ${locked() ? 'disabled' : ''}>${icon('play')}${S.next && S.sel === c.id ? 'Continue' : 'Renew'}</button></div>`
      : `<div class="note green">${icon('check')}<div><b>Valid</b><span>It expires ${expiryText(c)}. CDM renews it when ${WINDOW_DAYS} days are left.</span></div></div>`;
    return `<div class="scrim" data-act="cert-close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Certificate details">
      <div class="drawer-top"><div><h2>${esc(c.cn)}</h2><div class="row">${c.failed ? pill('Renewal failed', 'red') : ''}${ca.flag ? pill(ca.flag, 'red') : ''}${pill(word, col)}</div></div><button class="btn sm" data-act="cert-close" id="cert-close">Close</button></div>
      ${state}
      ${part('Certificate', row('Common name', esc(c.cn)) + row('Certificate ID', c.id, true) + row('Expires', `${fmtDate(c.notAfter)} <span class="muted">(${expiryText(c)})</span>`) + row('Status', word) + row('SHA-1 thumbprint', c.thumb.replace(/(.{4})/g, '$1 ').trim(), true))}
      ${part('Where it is installed', row('Server', esc(s.id)) + row('Platform', `${s.os} · ${esc(s.tech)}`) + row('Location', esc(c.location), true) + row('Server trust store', esc(s.store), true))}
      ${part('Who issued it', row('Issuing CA', esc(ca.name)) + (ca.flag ? row('Renewal by CDM', 'Not renewed: replace it with a certificate from an approved issuing CA') : row('Root CA', esc(ca.root)) + row('Renewal method', ca.via === 'ACME' ? 'ACME: CDM orders the replacement from the CA' : 'CA folder: CDM picks up the replacement the CA issued') + row('A renewal is valid for', plural(ca.life, 'day'))))}
      <h4>Errors for this certificate</h4>${errs.length ? `<ul class="plain">${errs.map(e => `<li><button class="linkish" data-act="err-open:${e.id}">${e.id}</button> <span class="mono">${esc(e.code)}</span><small>${esc(e.stage)} · ${fmtDate(e.at)} · ${e.status === 'resolved' ? 'fixed by the AI agent' : e.status === 'incident' ? `incident ${esc(e.incident)}` : 'waiting for the AI agent'}</small></li>`).join('')}</ul>` : '<div class="muted">No errors logged.</div>'}
    </aside>`;
  }

  const PAGES = {
    dashboard() {
      const list = scoped(), dueN = dueList().length, ca = ISSUERS.find(i => i.id === S.ca);
      // chart: one row per issuing CA, the approved CAs first with the largest on top, then the two flagged groups. The axis ends on a round number above the longest bar.
      const bars = ISSUERS.map(i => ({ i, n: S.certs.filter(c => c.issuer === i.id).length, d: S.certs.filter(c => c.issuer === i.id && due(c)).length })).sort((a, b) => !!a.i.flag - !!b.i.flag || b.n - a.n);
      const step = Math.max(1, Math.ceil(Math.max(...bars.map(b => b.n)) / 4 / 5) * 5), axisMax = step * 4, ticks = [0, 1, 2, 3, 4].map(k => k * step);
      const trust = CA_CERTS.map(trustState).sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));   // the ones missing in most places first
      const stores = trust[0].rows.length, tticks = Array.from({ length: Math.floor(stores / 2) + 1 }, (_, k) => k * 2);   // 0, 2, 4 … up to the number of trust stores
      return `${head('Dashboard', !ca ? 'Certificates from every issuing CA' : ca.flag ? esc(ca.note) : `Certificates issued by ${esc(ca.name)}, under ${esc(ca.root)}`)}
        <div class="stack">
          <div class="summary"><div class="total"><div class="num">${list.length}</div><div class="lbl">Total certificates</div></div>
            ${kpi('Expired', 'past their expiry date', count('expired'), 'red', 'filter:expired')}${kpi(`Expiring in ${WINDOW_DAYS} days`, 'inside the renewal window', count('expiring'), 'orange', 'filter:expiring')}${kpi('Renewed', 'by CDM in this session', count('renewed'), 'blue', 'filter:renewed')}${kpi('Open errors', 'waiting, or raised as incidents', openErrors().length, 'violet', 'go:errors')}</div>
          <div class="card next"><div><h3>${dueN ? `${plural(dueN, 'certificate')} need${dueN === 1 ? 's' : ''} renewal` : 'Nothing needs renewal'}</h3><div class="sub">${dueN ? `Expired or expiring within ${WINDOW_DAYS} days${ca ? `, issued by ${esc(ca.name)}` : ''}.` : ca && ca.flag ? 'CDM does not renew these certificates.' : 'Every certificate in scope is valid for more than 30 days.'}</div></div>
            <div class="row"><a class="btn" href="#/certificates" data-act="filter:due">View them</a><button class="btn primary" data-act="renew-all" ${dueN && !locked() ? '' : 'disabled'}>${icon('play')}Renew all</button></div></div>
          <div class="charts"><div class="card chartcard"><div class="row spread"><h3>Certificates by issuing CA</h3>
              <div class="legend"><span><i class="k"></i>Renewed by CDM</span><span><i class="k flag"></i>Not renewed by CDM</span></div></div>
            <div class="hchart" role="group" aria-label="Certificates by issuing CA">${bars.map(b => `<button class="bar ${b.i.flag ? 'flag ' : ''}hrow ${S.ca === b.i.id ? 'on' : ''}" data-act="ca:${S.ca === b.i.id ? 'all' : b.i.id}" aria-pressed="${S.ca === b.i.id}" title="${esc(b.i.name)}: ${plural(b.n, 'certificate')}">
                <span class="hname">${esc(b.i.name)}<small>${b.i.flag ? 'not renewed by CDM' : b.d ? `${b.d} to renew` : 'none to renew'}</small></span>
                <span class="htrack" aria-hidden="true"><i class="col" style="width:${(b.n / axisMax * 100).toFixed(2)}%"></i></span><span class="hval">${b.n}</span></button>`).join('')}
              <div class="haxis" aria-hidden="true"><span></span><span class="hticks">${ticks.map(v => `<i style="left:${v / axisMax * 100}%">${v}</i>`).join('')}</span><span></span></div>
              <div class="haxis"><span></span><span class="hcap">Number of certificates</span><span></span></div></div></div>
            <div class="card trustcard"><div class="row spread"><h3>Trust stores</h3><div class="legend"><span><i class="k found"></i>Found</span><span><i class="k missing"></i>Missing</span></div></div>
              <div class="hchart" role="group" aria-label="CA certificates in trust stores">${trust.map(t => `<button class="hrow" data-act="trust:${esc(t.name)}" title="${esc(t.name)}: found in ${t.found.length} of ${stores} trust stores, missing in ${t.missing.length}">
                <span class="hname">${esc(t.name)}<small>${t.kind} CA</small></span>
                <span class="htrack" aria-hidden="true">${[['seg-ok', t.found.length], ['seg-miss', t.missing.length]].map(([k, n]) => (n ? `<i class="${k}" style="width:${n / stores * 100}%">${n}</i>` : '')).join('')}</span><span class="hval">${t.found.length}<small> of ${stores}</small></span></button>`).join('')}
                <div class="haxis" aria-hidden="true"><span></span><span class="hticks">${tticks.map(v => `<i style="left:${v / stores * 100}%">${v}</i>`).join('')}</span><span></span></div>
                <div class="haxis"><span></span><span class="hcap">Number of server trust stores</span><span></span></div></div></div></div>
        </div>`;
    },

    certificates() {
      const all = scoped(), f = S.filter, q = S.q.trim().toLowerCase();
      const rows = all.filter(c => (f === 'all' || (f === 'due' ? due(c) : statusOf(c) === f)) && (!q || (c.cn + ' ' + c.server + ' ' + issuerOf(c).name).toLowerCase().includes(q))).sort((a, b) => a.notAfter - b.notAfter);
      const fb = (key, label, n) => `<button class="${f === key ? 'on' : ''}" data-act="filter:${key}"><span>${label}</span><b>${n}</b></button>`;
      return `${head('Certificates', 'What is on the servers, and what needs renewing. Select a certificate to see its details.', true)}
        <div class="split"><div class="stack"><div class="total"><div class="num">${all.length}</div><div class="lbl">Total certificates</div></div>
            <div class="card filters"><h4>Show</h4>${fb('all', 'All', all.length)}${fb('due', 'Need renewal', all.filter(due).length)}${fb('expired', 'Expired', count('expired'))}${fb('expiring', `In ${WINDOW_DAYS} days`, count('expiring'))}${fb('valid', 'Valid', count('valid'))}${fb('renewed', 'Renewed', count('renewed'))}</div></div>
          <div class="card tablecard"><div class="bar-top"><label class="search">${icon('search')}<input id="q" placeholder="Search certificates…" value="${esc(S.q)}" data-input="q" aria-label="Search certificates"></label>
              <button class="btn primary" data-act="renew-all" ${all.some(due) && !locked() ? '' : 'disabled'}>${icon('play')}Renew all (${all.filter(due).length})</button></div>
            <div class="scroll"><table class="table"><thead><tr><th>Name</th><th>Issuer</th><th>Expiration</th><th>Status</th><th></th></tr></thead><tbody>
              ${rows.map(c => { const [t, col] = STATUS[statusOf(c)];
                return `<tr class="click ${S.cert === c.id ? 'open' : ''}" data-act="cert:${c.id}"><td><button class="name" data-act="cert:${c.id}" title="Show the details of this certificate">${esc(c.cn)}</button><small>${esc(c.server)} · ${esc(serverOf(c).tech)}</small></td><td>${esc(issuerOf(c).name)}</td><td>${fmtDate(c.notAfter)}<small style="color:var(--${statusOf(c) === 'expired' ? 'red' : 'muted'})">${expiryText(c)}</small></td><td>${c.failed ? pill('Renewal failed', 'red') : issuerOf(c).flag ? pill(issuerOf(c).flag, 'red') : pill(t, col)}</td>
                  <td class="right">${due(c) ? `<button class="btn sm ${S.next && S.sel === c.id ? 'primary' : ''}" data-act="renew:${c.id}" ${locked() ? 'disabled' : ''}>${S.next && S.sel === c.id ? 'Continue' : 'Renew'}</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No certificate matches.</td></tr>'}
            </tbody></table></div></div></div>${certDrawer()}`;
    },

    renewal() {
      if (!S.queue.length) {
        const list = dueList();
        return `${head('Live Demo', 'Renew one certificate by hand and watch every stage, one press of Next at a time', true)}
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
      // Live Demo: what the next press does, and the button for it. While a stage is working the button waits.
      const live = f && f.manual && S.busy, nextBar = !live ? '' : `<div class="nextbar"><div><b>${!S.next ? `Running stage ${f.at + 1} of ${STAGES.length}: ${STAGES[f.at].title}` : f.at ? `Stage ${f.at} of ${STAGES.length} is done. Next: ${STAGES[f.at].title}` : `Ready to renew ${esc(c.cn)}`}</b><span>${S.next ? STAGES[f.at].text : 'Each step appears here as it happens.'}</span></div>
        <div class="row">${S.next ? '<button class="btn" data-act="stop-demo">Stop</button>' : ''}<button class="btn primary" data-act="next" ${S.next ? '' : 'disabled'}>${icon('play')}${!S.next ? 'Working…' : f.at ? `Next: ${STAGES[f.at].title}` : `Start: ${STAGES[0].title}`}</button></div></div>`;
      return `${head('Live Demo', live ? `Stage by stage: ${f.stages.filter(s => s.status === 'done').length} of ${STAGES.length} done` : S.busy ? `Renewing ${plural(S.queue.length, 'certificate')}: ${doneN} done${failN ? `, ${failN} not renewed` : ''}` : `Finished: ${doneN} renewed${failN ? `, ${failN} not renewed` : ''}`)}
        <div class="flow"><div class="card queue"><h4>${S.queue.length === 1 ? 'Certificate' : `Certificates (${S.queue.length})`}</h4>
            ${S.queue.map(id => { const x = S.certs.find(k => k.id === id); return `<button class="${id === S.sel ? 'on' : ''}" data-act="pick:${id}"><span class="dot ${qStatus(id)}"></span><span><b>${esc(x.cn)}</b><small>${WORD[qStatus(id)]}</small></span></button>`; }).join('')}</div>
          <div class="card"><div class="row spread"><div><h3>${esc(c.cn)}</h3><div class="sub">${esc(c.server)} · ${esc(serverOf(c).tech)} · ${esc(issuerOf(c).name)}</div></div>
              ${S.busy ? '' : `<button class="btn" data-act="new-renewal">Renew another</button>`}</div>
            <ol class="steps">${STAGES.map((g, i) => { const s = f ? f.stages[i].status : 'pending'; return `<li><button class="step ${s} ${i === at ? 'sel' : ''}" data-act="stage:${i}" aria-label="${g.title}: ${s}"><span class="n">${s === 'done' ? '✓' : s === 'failed' ? '!' : i + 1}</span><b>${g.title}</b></button></li>`; }).join('')}</ol>
            <div class="detail ${live && st.status !== 'done' ? 'live' : ''}"><h4>${at + 1}. ${STAGES[at].title}</h4><div class="muted">${STAGES[at].text}</div>${st && st.lines.length ? `<ul>${st.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${st && st.status === 'running' ? '<div class="working"><span class="dot running"></span>Working…</div>' : ''}</div>${nextBar}
            ${outcome}</div></div>`;
    },

    errors() {
      const time = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const step = (label, state, color) => `<li class="${state}" ${color ? `style="--c:var(--${color})"` : ''}><i>${state === 'ok' ? '✓' : ''}</i>${label}</li>`;
      // the four tiles are the filter: each shows its count and limits the table to those errors
      const IS = { all: () => true, resolved: e => e.status === 'resolved', incident: e => e.status === 'incident', waiting: e => e.status === 'logged' || e.status === 'agent' }, f = IS[S.errFilter] ? S.errFilter : 'all', list = S.errors.filter(IS[f]);
      const tile = (key, label, color) => stat(label, S.errors.filter(IS[key]).length, color, 'errfilter:' + key, f === key);
      const STATE = e => (e.status === 'resolved' ? pill('Fixed by the AI agent', 'green') : e.status === 'incident' ? `${pill('Incident ' + e.incident, 'red')}<small>assigned to ${esc(e.team)}</small>` : e.status === 'agent' ? pill('AI agent working', 'violet') : pill('Waiting for the agent', 'orange'));
      return `${head('Errors', 'Every error is logged, the AI agent tries to fix it, and what it cannot fix becomes an incident')}
        <div class="stack"><div class="stats" role="group" aria-label="Show errors">${tile('all', 'All logged', 'blue')}${tile('resolved', 'Fixed by the AI agent', 'green')}${tile('incident', 'Incidents raised', 'red')}${tile('waiting', 'Waiting for the agent', 'violet')}</div>
          <div class="card tablecard"><div class="scroll"><table class="table errtable"><thead><tr><th>Error</th><th>Certificate</th><th>Stage</th><th>What happened</th><th>Logged</th><th>Status</th><th></th></tr></thead><tbody>
            ${list.map(e => { const open = S.openErr === e.id, done = e.status === 'resolved' || e.status === 'incident', p = PLAYBOOK[e.code] || {};
              return `<tr class="${open ? 'open' : ''}"><td class="mono nowrap">${e.id}</td><td><span class="name">${esc(e.cn)}</span><small>${esc(e.server)}</small></td><td>${esc(e.stage)}</td>
                  <td><span class="mono">${esc(e.code)}</span><small>${esc(e.message)}</small></td><td class="nowrap">${fmtDate(e.at)}<small>${time(e.at)}</small></td><td>${STATE(e)}</td>
                  <td class="right nowrap">${e.status === 'logged' ? `<button class="btn sm primary" data-act="agent:${e.id}">${icon('bot')}Run AI agent</button> ` : ''}<button class="btn sm" data-act="err:${e.id}" aria-expanded="${open}">${open ? 'Hide' : 'Details'}</button></td></tr>
                ${open ? `<tr class="more"><td colspan="7"><ol class="track">${step('Error logged', 'ok', 'blue')}${step('AI agent', e.status === 'agent' ? 'now' : done ? 'ok' : '', 'violet')}${step(e.status === 'incident' ? `Incident ${esc(e.incident)}` : e.status === 'resolved' ? 'Resolved' : 'Resolved or incident', done ? 'ok' : '', e.status === 'incident' ? 'red' : 'green')}</ol>
                  <h4>What the AI agent did</h4>${e.agent.length ? `<ul>${e.agent.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<div class="muted">The AI agent has not looked at this error yet.</div>'}
                  ${e.status === 'resolved' ? `<div class="note green">${icon('check')}<div><b>Resolved by the AI agent</b><span>${esc(p.outcome || '')}</span></div></div>` : ''}
                  ${e.status === 'incident' ? `<div class="note red">${icon('ticket')}<div><b>Incident ${esc(e.incident)} raised</b><span>${esc(p.outcome || '')} Assigned to ${esc(e.team)}.</span></div></div>` : ''}</td></tr>` : ''}`; }).join('') || `<tr><td colspan="7" class="empty">${S.errors.length ? 'No error of this kind. <button class="linkish" data-act="errfilter:all">Show all</button>' : 'No errors.'}</td></tr>`}
          </tbody></table></div></div></div>`;
    },

    trust() {
      const t = S.trust, results = t.results && t.results.map(trustState), hit = results && results.find(h => h.name === t.pick), STATE = { found: ['Found', 'green'], missing: ['Not found', 'red'] };   // read again on every draw, so a deployment shows at once
      const set = hit && sourceOf(hit.name), from = hit && hit.rows.find(r => r.state === 'found' && !r.dep), miss = hit ? hit.missing.length : 0;   // where it can be picked from (the configured path first), and how many stores still miss it
      return `${head('Trust store scan', 'Find where a CA certificate is, and where it is missing')}
        <div class="stack"><div class="card"><h3>Which CA certificate are you looking for?</h3><div class="sub">Type part of its name. CDM looks in the trust store of every server, and can deploy the certificate wherever it is missing.</div>
            <form class="ask" data-submit="scan"><label class="search">${icon('search')}<input id="tq" value="${esc(t.q)}" placeholder="For example G3" data-input="tq" aria-label="CA certificate name"></label>
              <button class="btn primary" ${t.scanning ? 'disabled' : ''}>${icon('store')}${t.scanning ? 'Scanning…' : 'Scan trust stores'}</button></form>
            <div class="chips">Try: ${['G3', 'G2', 'ISRG', 'DigiCert'].map(x => `<button type="button" data-act="try:${x}">${x}</button>`).join('')}</div>
            ${t.scanning ? `<div class="progress"><i style="width:${t.progress * 100}%"></i></div><div class="sub" style="margin-top:8px">Reading the trust store on ${esc(t.at || SERVERS[0].id)}…</div>` : ''}</div>
          ${!t.results ? '' : !t.results.length ? `<div class="card empty">No CA certificate with "${esc(t.q)}" in its name is in any trust store.</div>` : `
          <div class="split"><div class="card found"><h4>Matches for "${esc(t.q)}" (${results.length})</h4>${results.map(h => `<button class="${h.name === t.pick ? 'on' : ''}" data-act="hit:${esc(h.name)}"><b>${esc(h.name)}</b><small>${h.kind} · in ${h.found.length} of ${h.scanned} trust stores</small></button>`).join('')}</div>
            <div class="stack"><div class="stats">${stat('Trust stores scanned', hit.scanned, 'blue')}${stat('Found in', hit.found.length, 'green')}${stat('Missing in', miss, 'red')}${stat('Deployed by CDM', hit.rows.filter(r => r.dep && r.state === 'found').length, 'violet')}</div>
              <div class="card tablecard">${set || from ? `<div class="source ${miss ? 'todo' : ''}">${icon(miss ? 'pin' : 'check')}<div><b>${miss ? `Missing in ${plural(miss, 'trust store')}. ${esc(hit.name)} can be picked from ${set ? 'the configured path' : esc(from.server)} and deployed to ${miss === 1 ? 'it' : 'them'}.` : `${esc(hit.name)} is in all ${hit.scanned} trust stores`}</b><div class="mono">${esc(set ? set.path : from.store)}</div><div class="sub">${hit.kind} CA · valid until ${hit.expires} · SHA-1 ${hit.thumb.slice(0, 20)}… · ${set ? 'path set in <a href="#/config">Configuration</a>' : 'no path configured: <a href="#/config">set one in Configuration</a>'}</div></div>
                  ${miss ? `<button class="btn primary" data-act="trust-deploy-all" ${t.deploying ? 'disabled' : ''}>${icon('play')}${t.deploying ? 'Deploying…' : `Deploy to all ${miss} missing`}</button>` : ''}</div>` : ''}
                <div class="scroll"><table class="table"><thead><tr><th>Server</th><th>Trust store</th><th>${esc(hit.name)}</th><th></th></tr></thead><tbody>
                  ${hit.rows.slice().sort((a, b) => b.was - a.was).map(r => `<tr><td><span class="name">${esc(r.server)}</span><small>${r.os}</small></td><td class="mono">${esc(r.store)}</td>
                    <td>${r.state === 'deploying' ? `${pill('Deploying', 'violet')}<small>${esc(r.dep.line)}</small>` : r.dep ? `${pill('Deployed', 'blue')}<small>picked from ${esc(r.dep.from)}</small>` : pill(...STATE[r.state])}</td>
                    <td class="right">${r.state === 'missing' ? `<button class="btn sm" data-act="trust-deploy:${r.server}" ${t.deploying ? 'disabled' : ''}>Deploy</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div></div></div>`}
        </div>`;
    },

    config() {
      const cfg = S.config, free = CA_CERTS.filter(c => !sourceOf(c.name));   // a CA certificate has one path
      return `${head('Configuration', 'Where CDM picks up the CA certificates it deploys to trust stores')}
        <div class="stack"><div class="card"><h3>Trust store certificate path</h3><div class="sub">Choose the parent CA certificate, for example Northwind Root CA G3, and give the path of its file. The trust store scan picks the certificate up from this path when it deploys it to the stores that miss it.</div>
            <form class="ask" data-submit="cfg-add"><select id="cfg-ca" class="field" data-change="cfg-ca" aria-label="CA certificate" ${free.length ? '' : 'disabled'}>${free.map(c => `<option ${c.name === cfg.ca ? 'selected' : ''}>${esc(c.name)}</option>`).join('') || '<option>Every CA certificate has a path</option>'}</select>
              <label class="search">${icon('pin')}<input id="cfg-path" value="${esc(cfg.path)}" placeholder="For example /opt/cdm/ca/northwind-root-ca-g2.crt" data-input="cfg-path" aria-label="Path of the certificate file"></label>
              <button class="btn primary" ${free.length ? '' : 'disabled'}>Add path</button></form>
            ${cfg.error ? `<div class="form-err">${esc(cfg.error)}</div>` : ''}</div>
          <div class="card tablecard"><div class="scroll"><table class="table"><thead><tr><th>CA certificate</th><th>Picked up from</th><th></th></tr></thead><tbody>
            ${cfg.sources.map(s => { const ca = CA_CERTS.find(c => c.name === s.ca);
              return `<tr><td><span class="name">${esc(s.ca)}</span><small>${ca.kind} CA · valid until ${ca.expires}</small></td><td class="mono">${esc(s.path)}</td><td class="right"><button class="btn sm" data-act="cfg-remove:${esc(s.ca)}">Remove</button></td></tr>`; }).join('') || '<tr><td colspan="3" class="empty">No path configured. CDM picks each certificate from a server trust store that already has it.</td></tr>'}
          </tbody></table></div></div></div>`;
    },
  };

  // ------------------------------------------------------------------ shell, routing, events
  // Live Demo (the renewal page) is not in the rail: Renew on a certificate opens it stage by stage, Renew all runs there on its own.
  const NAV = [['dashboard', 'Dashboard', 'dashboard'], ['certificates', 'Certificates', 'cert'], /* ['renewal', 'Live Demo', 'play'], */ ['errors', 'Errors', 'alert'], ['trust', 'Trust store', 'store'], ['config', 'Configuration', 'gear']];
  let page = 'dashboard';
  const go = p => { if (location.hash !== '#/' + p) location.hash = '#/' + p; else render(); };
  function render() {
    const waiting = openErrors().length;
    $('#rail').innerHTML = `<div class="logo">CDM</div>${NAV.map(([k, label, ic]) => `<a href="#/${k}" class="${k === page ? 'on' : ''}" ${k === page ? 'aria-current="page"' : ''}>${icon(ic)}${k === 'errors' && waiting ? `<span class="badge">${waiting}</span>` : ''}<span>${label}</span></a>`).join('')}`;
    // Not shown to the client. To show it again, add this to the end of the rail:
    // <div class="grow"></div><div class="foot">Demo · sample data<br><a href="full.html">Detailed prototype</a></div>
    const el = $('#view'), html = PAGES[page](), active = document.activeElement, id = active && active.id, pos = id && active.selectionStart;
    if (el._h !== html) { el.innerHTML = html; el._h = html; if (id && $('#' + id)) { const again = $('#' + id); again.focus(); if (pos != null && again.setSelectionRange) again.setSelectionRange(pos, pos); } }
  }
  function route() { const p = (location.hash.match(/^#\/(\w+)/) || [])[1]; page = PAGES[p] ? p : 'dashboard'; S.cert = null; render(); window.scrollTo(0, 0); }

  const ACTIONS = {
    ca: v => { S.ca = v; render(); },
    filter: v => { S.filter = v; go('certificates'); },
    go: v => go(v),
    renew: id => startRenewal([id], true),   // one certificate: the Live Demo, stage by stage
    next: () => { if (S.next) S.next(); },
    'stop-demo': () => { const f = S.flows[S.sel]; if (S.next && f) { f.cancelled = true; S.next(); } },
    'renew-all': () => startRenewal(dueList().map(c => c.id)),
    'new-renewal': () => { S.queue = []; S.flows = {}; S.sel = null; S.follow = false; render(); },
    pick: id => { S.sel = id; S.follow = S.busy; const f = S.flows[id]; S.stage = f ? Math.max(0, f.stages.map(s => s.status).lastIndexOf('done')) : 0; if (f && f.status !== 'done') S.stage = Math.max(0, f.stages.findIndex(s => s.status !== 'done')); render(); },
    stage: i => { S.stage = +i; render(); },
    agent: id => { const e = S.errors.find(x => x.id === id); if (e && e.status === 'logged') runAgent(e); },
    err: id => { S.openErr = S.openErr === id ? null : id; render(); },
    try: v => scanTrust(v),
    trust: name => { go('trust'); scanTrust(name); },   // from the dashboard: open the scan for that CA certificate
    hit: v => { S.trust.pick = v; render(); },
    cert: id => { S.cert = id; render(); const x = $('#cert-close'); if (x) x.focus(); },
    'cert-close': () => { S.cert = null; render(); },
    'err-open': id => { S.openErr = id; S.errFilter = 'all'; go('errors'); },
    errfilter: v => { S.errFilter = S.errFilter === v ? 'all' : v; render(); },   // pressing the chosen tile again shows all
    'cfg-remove': name => { S.config.sources = S.config.sources.filter(s => s.ca !== name); render(); },
    'cfg-add': () => { const cfg = S.config, ca = cfg.ca || (CA_CERTS.find(c => !sourceOf(c.name)) || {}).name, path = cfg.path.trim(); if (!ca) return;
      if (!path) cfg.error = 'Enter the path of the certificate file.'; else { cfg.sources.push({ ca, path }); Object.assign(cfg, { ca: '', path: '', error: '' }); } render(); },
    'trust-deploy': server => deployTrust(S.trust.pick, [server]),   // one trust store
    'trust-deploy-all': () => deployTrust(S.trust.pick, trustState(CA_CERTS.find(c => c.name === S.trust.pick)).missing.map(r => r.server)),
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const [name, ...rest] = el.dataset.act.split(':'), fn = ACTIONS[name]; if (!fn) return;
    if (el.tagName !== 'A') e.preventDefault(); fn(rest.join(':'));
  });
  document.addEventListener('change', e => { const k = e.target.dataset.change; if (k === 'ca') ACTIONS.ca(e.target.value); else if (k === 'cfg-ca') S.config.ca = e.target.value; });
  document.addEventListener('input', e => { const k = e.target.dataset.input; if (k === 'q') { S.q = e.target.value; render(); } else if (k === 'tq') S.trust.q = e.target.value; else if (k === 'cfg-path') S.config.path = e.target.value; });
  document.addEventListener('submit', e => { const k = e.target.dataset.submit; if (k) e.preventDefault(); if (k === 'scan') scanTrust($('#tq').value); else if (k === 'cfg-add') ACTIONS['cfg-add'](); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.cert) ACTIONS['cert-close'](); });
  window.addEventListener('hashchange', route);
  window.addEventListener('load', () => { route(); if (/[?&]check/.test(location.search)) setTimeout(selfCheck, 50); });

  // ------------------------------------------------------------------ self-check (open the page with ?check)
  async function selfCheck() {
    const out = [], t = (name, ok, extra) => out.push({ name, ok: !!ok, extra });
    try {
      SPEED = 0;
      t('every page renders', Object.keys(PAGES).every(k => { page = k; return PAGES[k]().length > 200; }));
      { render(); const rail = $('#rail').innerHTML; t('the rail has Configuration, and no Live Demo entry or demo footer', !/Renewal|Live Demo|sample data|full\.html/.test(rail) && /#\/config/.test(rail)); }
      t('there are certificates to renew', dueList().length >= 10, dueList().length);
      { const html = PAGES.dashboard(), flagged = S.certs.filter(c => issuerOf(c).flag);
        t('the chart has a bar for every issuing CA and highlights self-signed and unapproved', (html.match(/class="bar /g) || []).length === ISSUERS.length && (html.match(/class="bar flag /g) || []).length === 2 && /Self-signed/.test(html) && /Unapproved CA/.test(html));
        t('the dashboard has a separate trust store chart with a row per CA certificate', /class="card trustcard"/.test(html) && (html.match(/class="hrow"/g) || []).length === CA_CERTS.length && (html.match(/<i class="seg-miss"/g) || []).length === Object.keys(MISSING).length && /Number of server trust stores/.test(html) && !/Not scanned/.test(html) && html.indexOf('class="summary"') < html.indexOf('class="charts"'));
        t('self-signed and unapproved certificates are listed but never offered for renewal', flagged.length > 5 && flagged.every(c => !due(c)) && !dueList().some(c => issuerOf(c).flag)); }
      t('the Issuing CA choice is only on the pages it limits', ['certificates', 'renewal'].every(k => /id="ca"/.test(PAGES[k]())) && ['dashboard', 'errors', 'trust', 'config'].every(k => !/id="ca"/.test(PAGES[k]())));
      { page = 'certificates'; render(); const sel = $('#ca'), all = document.querySelectorAll('#view tbody tr').length; sel.value = 'dc-2020'; sel.dispatchEvent(new Event('change', { bubbles: true }));
        const rows = [...document.querySelectorAll('#view tbody tr')]; t('choosing an issuing CA in the dropdown filters the list on screen', S.ca === 'dc-2020' && rows.length > 0 && rows.length < all && rows.every(r => /DigiCert TLS/.test(r.textContent)) && $('#ca').value === 'dc-2020', [all, rows.length]); }
      { page = 'errors'; render(); const rows = () => document.querySelectorAll('#view .errtable tbody tr').length, all = rows(), tiles = document.querySelectorAll('#view button.stat').length;
        $('#view [data-act="errfilter:incident"]').click(); const inc = rows(), on = $('#view .stat.on').textContent, only = [...document.querySelectorAll('#view .errtable tbody tr')].every(r => /Incident INC/.test(r.textContent));
        $('#view [data-act="errfilter:incident"]').click();
        t('the tiles on the errors page filter the table, and pressing one again shows all', tiles === 4 && all === S.errors.length && inc === S.errors.filter(e => e.status === 'incident').length && inc < all && only && /Incidents raised/.test(on) && rows() === all && S.errFilter === 'all', [all, inc]); }
      { const html = PAGES.errors(); t('the errors are one table with a row per error, and Details opens the agent steps under the row', /class="table errtable"/.test(html) && (html.match(/data-act="err:/g) || []).length === S.errors.length && (ACTIONS.err(S.errors[0].id), /class="more"/.test(PAGES.errors())) && (ACTIONS.err(S.errors[0].id), !/class="more"/.test(PAGES.errors()))); }
      { const c = S.certs.find(x => due(x) && !x.trouble), flagged = S.certs.find(x => issuerOf(x).flag), s = serverOf(c); page = 'certificates'; ACTIONS.ca('all'); const closed = !$('.drawer');
        $(`#view tr[data-act="cert:${c.id}"]`).click(); const d = $('.drawer'), text = d ? d.textContent : '';
        const full = [c.cn, c.id, s.id, s.tech, c.location, s.store, issuerOf(c).name, issuerOf(c).root, fmtDate(c.notAfter), c.thumb.slice(0, 4)].every(x => text.includes(x)) && !!d.querySelector(`[data-act="renew:${c.id}"]`);
        ACTIONS.cert(flagged.id); const flagOk = /CDM does not renew this certificate/.test($('.drawer').textContent) && !$('.drawer [data-act^="renew:"]');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        t('selecting a certificate shows all its details, and Escape closes them', closed && full && flagOk && !$('.drawer') && S.cert === null); }
      const total = S.certs.length; ACTIONS.ca('nw');
      t('choosing an issuing CA limits what is shown', scoped().length > 0 && scoped().length < total && scoped().every(c => c.issuer === 'nw') && PAGES.dashboard().includes('under Northwind Root CA'));
      const one = dueList()[0]; await startRenewal([one.id]);
      t('a certificate renews through all seven stages', S.flows[one.id].status === 'done' && S.flows[one.id].stages.every(s => s.status === 'done' && s.lines.length) && one.renewed && !due(one) && statusOf(one) === 'renewed', S.flows[one.id].stages.map(s => s.status).join());
      ACTIONS['new-renewal'](); ACTIONS.ca('all');
      { const x = dueList().find(c => !c.trouble && issuerOf(c).via === 'ACME'); ACTIONS.renew(x.id); let clicks = 0, bar = false, early = false;
        while (S.busy && clicks < 20) { await wait(1); if (S.next) { bar = bar || /data-act="next"/.test(PAGES.renewal()); early = early || x.renewed; clicks++; ACTIONS.next(); } }
        const f = S.flows[x.id]; t('Live Demo renews a certificate one stage per press of Next, and shows the ACME steps', clicks === STAGES.length && bar && !early && page === 'renewal' && f.status === 'done' && x.renewed && f.stages[1].lines.some(l => /ACME service/.test(l)) && !/data-act="next"/.test(PAGES.renewal()), clicks);
        ACTIONS['new-renewal'](); const y = dueList().find(c => !c.trouble); ACTIONS.renew(y.id); await wait(1); ACTIONS.next(); while (!S.next) await wait(1); ACTIONS['stop-demo'](); while (S.busy) await wait(1);
        { const [a, b] = dueList().filter(c => !c.trouble); ACTIONS.renew(a.id); await wait(1); ACTIONS.next(); while (!S.next) await wait(1);   // a demo left waiting after its first stage
          go('certificates'); await wait(1); page = 'certificates'; const list = PAGES.certificates(), open = !/data-act="renew:[^"]*" disabled/.test(list) && />Continue</.test(list);
          ACTIONS.renew(a.id); await wait(1); const resumed = S.sel === a.id && S.flows[a.id].stages[0].status === 'done' && !!S.next;
          ACTIONS.renew(b.id); while (S.sel !== b.id || !S.next) await wait(1);
          t('a Live Demo left waiting does not block Renew: the same certificate continues, another one starts', open && resumed && S.busy && S.queue.length === 1 && S.queue[0] === b.id && !a.renewed && due(a) && S.flows[b.id].at === 0);
          ACTIONS['stop-demo'](); while (S.busy) await wait(1); }
        t('a Live Demo can be stopped between stages, leaving the certificate as it was', !y.renewed && due(y) && !S.queue.length && /Choose a certificate/.test(PAGES.renewal())); }
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
      { const name = 'Northwind Root CA G3', state = () => trustState(CA_CERTS.find(c => c.name === name)), first = g3.missing[0].server;
        S.trust.pick = name; const before = PAGES.trust(); await deployTrust(name, [first]); const one = state();
        t('a missing CA certificate can be deployed to one trust store', /Deploy to all 3 missing/.test(before) && (before.match(/data-act="trust-deploy:/g) || []).length === 3 && one.found.length === 5 && one.missing.length === 2 && /picked from the configured path/.test(before) && one.rows.find(r => r.server === first).dep.from === sourceOf(name).path);
        await ACTIONS['trust-deploy-all'](); const all = state(), html = PAGES.trust();
        t('Deploy to all puts it in every trust store that missed it', all.found.length === 7 && all.missing.length === 0 && /is in all 7 trust stores/.test(html) && !/data-act="trust-deploy/.test(html) && (html.match(/picked from \/opt\/cdm/g) || []).length === 3); }
      { const name = 'Northwind Issuing CA G3', n = S.config.sources.length; await scanTrust('G3'); S.trust.pick = name; const noPath = PAGES.trust();
        S.config.ca = name; ACTIONS['cfg-add'](); const refused = S.config.sources.length === n && /Enter the path/.test(PAGES.config());
        S.config.path = '/opt/cdm/ca/issuing-g3.crt'; ACTIONS['cfg-add'](); const added = PAGES.trust();
        t('a path added under Configuration is where the trust store scan picks the certificate up', refused && /set one in Configuration/.test(noPath) && sourceOf(name).path === '/opt/cdm/ca/issuing-g3.crt' && /picked from the configured path/.test(added) && added.includes('/opt/cdm/ca/issuing-g3.crt') && PAGES.config().includes('/opt/cdm/ca/issuing-g3.crt'));
        ACTIONS['cfg-remove'](name); t('a configured path can be removed', !sourceOf(name) && S.config.sources.length === n); }
      await scanTrust('nothing-like-this'); t('a name that is in no trust store says so', S.trust.results.length === 0 && /in any trust store/.test(PAGES.trust()));
    } catch (err) { t('exception', false, String(err && err.stack || err)); }
    const pre = document.createElement('pre'); pre.id = 'check-out'; pre.hidden = true; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
    document.title = 'CHECK ' + (out.every(o => o.ok) ? 'PASS ' : 'FAIL ') + out.filter(o => o.ok).length + '/' + out.length;
  }
})();
