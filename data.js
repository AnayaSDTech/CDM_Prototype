/* Sample data for the CDM prototype. The two lab servers carry the real lab certificates; the rest is a synthetic estate. */
(function () {
  'use strict';
  const DAY = 86400000, HOUR = 3600000;

  // ---- synchronous SHA-256 (the audit chain must be recomputable on click) ----
  function sha256(str) {
    if (!sha256.K) {
      const K = [], H = [];
      for (let n = 2; K.length < 64; n++) {
        let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; }
        if (!p) continue;
        K.push((Math.pow(n, 1 / 3) % 1 * 4294967296) | 0);
        if (H.length < 8) H.push((Math.pow(n, 1 / 2) % 1 * 4294967296) | 0);
      }
      sha256.K = K; sha256.H = H;
    }
    const K = sha256.K, bytes = new TextEncoder().encode(str), l = bytes.length;
    const buf = new Uint8Array(((l + 9 + 63) >> 6) << 6); buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor(l * 8 / 4294967296)); dv.setUint32(buf.length - 4, (l * 8) >>> 0);
    const H = sha256.H.slice(), w = new Int32Array(64);
    for (let off = 0; off < buf.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + ((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ (a >>> 3)) + w[i - 7] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  function eventHash(prev, e) {
    return sha256([prev, e.seq, e.ts, e.type, e.target, e.actor, JSON.stringify(e.detail || {})].join('|'));
  }

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const SERVERS = [
    { id: 'lnx01', name: 'lnx01', host: '13.216.248.154', os: 'linux', tech: 'linux_apache', zone: 'lab', env: 'AWS lab', cred: 'lab/lnx' },
    { id: 'win01', name: 'win01', host: '34.233.126.190', os: 'windows', tech: 'windows_store', zone: 'lab', env: 'AWS lab', cred: 'WinDeploy/web01' },
    { id: 'web-prod-01', name: 'web-prod-01', host: '10.20.1.11', os: 'linux', tech: 'linux_nginx', zone: 'prod-eu', env: 'Frankfurt DC' },
    { id: 'web-prod-02', name: 'web-prod-02', host: '10.20.1.12', os: 'linux', tech: 'linux_nginx', zone: 'prod-eu', env: 'Frankfurt DC' },
    { id: 'api-gw-01', name: 'api-gw-01', host: '10.20.2.21', os: 'linux', tech: 'linux_nginx', zone: 'prod-eu', env: 'Frankfurt DC' },
    { id: 'erp-java-01', name: 'erp-java-01', host: '10.20.3.14', os: 'linux', tech: 'java_keystore', zone: 'prod-eu', env: 'Frankfurt DC' },
    { id: 'crm-iis-01', name: 'crm-iis-01', host: '10.20.5.41', os: 'windows', tech: 'windows_iis', zone: 'prod-eu', env: 'Frankfurt DC' },
    { id: 'crm-iis-02', name: 'crm-iis-02', host: '10.20.5.42', os: 'windows', tech: 'windows_iis', zone: 'prod-eu', env: 'Frankfurt DC' },
    { id: 'sql-win-01', name: 'sql-win-01', host: '10.20.6.8', os: 'windows', tech: 'windows_store', zone: 'prod-eu', env: 'Frankfurt DC' },
    { id: 'pay-gw-01', name: 'pay-gw-01', host: '10.40.1.31', os: 'linux', tech: 'linux_nginx', zone: 'prod-us', env: 'Virginia DC' },
    { id: 'cdn-origin-01', name: 'cdn-origin-01', host: '10.40.1.45', os: 'linux', tech: 'linux_apache', zone: 'prod-us', env: 'Virginia DC' },
    { id: 'portal-iis-01', name: 'portal-iis-01', host: '10.40.5.11', os: 'windows', tech: 'windows_iis', zone: 'prod-us', env: 'Virginia DC' },
    { id: 'edge-lb-01', name: 'edge-lb-01', host: '10.30.0.5', os: 'linux', tech: 'linux_apache', zone: 'dmz', env: 'Perimeter', unreachable: 'Connection timed out (port 22)' },
    { id: 'mail-gw-01', name: 'mail-gw-01', host: '10.30.0.9', os: 'linux', tech: 'linux_nginx', zone: 'dmz', env: 'Perimeter' },
    { id: 'vpn-win-01', name: 'vpn-win-01', host: '10.30.0.20', os: 'windows', tech: 'windows_store', zone: 'dmz', env: 'Perimeter' },
    { id: 'uat-web-01', name: 'uat-web-01', host: '10.11.1.20', os: 'linux', tech: 'linux_apache', zone: 'uat', env: 'UAT' },
    { id: 'uat-win-01', name: 'uat-win-01', host: '10.11.1.30', os: 'windows', tech: 'windows_iis', zone: 'uat', env: 'UAT' },
    { id: 'intranet-01', name: 'intranet-01', host: '10.10.1.7', os: 'windows', tech: 'windows_iis', zone: 'dev', env: 'Dev' },
  ].map(s => ({
    transport: s.os === 'windows' ? 'winrm' : 'ssh', port: s.os === 'windows' ? 5986 : 22,
    adapter: s.os === 'windows' ? 'n/a' : (s.id === 'lnx01' ? 'pending' : 'installed'),
    paused: false, status: s.unreachable ? 'unreachable' : 'online', error: s.unreachable || null, lab: s.zone === 'lab', ...s,
  }));

  const BASES = { 'prod-eu': 'northwind-demo.com', 'prod-us': 'contoso-labs.net', dmz: 'fabrikam-demo.org', uat: 'tailspin-demo.io', dev: 'tailspin-demo.io' };
  const SUBS = ['www', 'portal', 'app', 'api', 'shop', 'mail', 'sso', 'crm', 'erp', 'pay', 'cdn', 'intra', 'hr', 'billing', 'status', 'docs', 'support', 'partners', 'vpn', 'auth', 'files', 'reports', 'booking', 'checkout'];
  const LAB = [['expired', -3], ['critical', 4], ['soon', 12], ['renew', 20], ['due', 29], ['edge', 30], ['ok', 45], ['later', 90], ['far', 200]];
  const CAS = { DV: "Let's Encrypt R11", OV: 'DigiCert TLS RSA SHA256 2020 CA1', EV: 'Entrust Extended Validation CA - L1M' };
  const REASON = {
    wildcard: 'wildcard (ACME HTTP-01 cannot issue wildcards)',
    multi: 'multi-name or SAN-less certificate (ACME source orders single-name certificates only)',
    nokey: 'no private key found next to the certificate',
    notdue: 'not due yet (renewal window not reached)',
  };

  function locationFor(s, cn, label) {
    if (s.tech === 'windows_store') return 'Cert:\\LocalMachine\\My';
    if (s.tech === 'windows_iis') return "IIS site 'Default Web Site' https:443 host " + cn;
    if (s.tech === 'java_keystore') return '/opt/erp/conf/keystore.p12 (alias ' + label + ')';
    if (s.lab) return '/etc/letsencrypt/live/' + label + '/fullchain.pem';
    return (s.tech === 'linux_nginx' ? '/etc/nginx/ssl/' : '/etc/ssl/certs/') + cn + '.crt';
  }

  function buildSeed() {
    const now = Date.now(), r = rng(20261006);
    const hex = n => Array.from({ length: n }, () => '0123456789ABCDEF'[Math.floor(r() * 16)]).join('');
    const pick = a => a[Math.floor(r() * a.length)];
    const between = (a, b) => a + Math.floor(r() * (b - a + 1));
    const certs = []; let seq = 1;

    function add(o) {
      const life = o.type === 'DV' ? 90 : 365;
      const notAfter = now + o.daysLeft * DAY + between(0, 20) * HOUR;
      const c = {
        id: 'C' + String(seq++).padStart(4, '0'), cn: o.cn, san: o.san || [o.cn], type: o.type, wildcard: !!o.wildcard,
        ca: o.lab && o.type === 'DV' ? "Let's Encrypt (staging)" : CAS[o.type], source: o.type === 'DV' ? 'ACME' : 'Folder',
        serverId: o.s.id, location: locationFor(o.s, o.cn, o.label || o.cn), keyAlg: o.type === 'DV' && r() < .45 ? 'ECDSA P-256' : (r() < .2 ? 'RSA-3072' : 'RSA-2048'),
        thumbprint: hex(64), serial: hex(32), notBefore: notAfter - life * DAY, notAfter,
        managed: o.managed, state: o.state || (o.managed ? 'Managed' : 'Discovered'), ineligible: o.ineligible || null,
        paused: false, pauseReason: null, approved: false, lastError: null, history: [], lastScanned: now - between(1, 40) * HOUR,
      };
      certs.push(c); return c;
    }

    for (const s of SERVERS) {
      if (s.lab) {
        const ip = s.host.replace(/\./g, '-');
        for (const [label, days] of LAB) {
          const cn = label + '-' + ip + '.nip.io', due = days <= 30;
          add({ s, cn, label, type: 'DV', daysLeft: days, lab: true, managed: due, ineligible: due ? null : REASON.notdue });
        }
        continue;
      }
      const base = BASES[s.zone], subs = SUBS.slice().sort(() => r() - .5);
      const n = between(6, 11);
      for (let i = 0; i < n; i++) {
        const sub = subs[i], roll = r(), cn = sub + '.' + base;
        let type = roll < .70 ? 'DV' : roll < .88 ? 'OV' : roll < .95 ? 'EV' : 'OV', wildcard = false, san = [cn];
        if (roll >= .95) { wildcard = true; san = ['*.' + sub + '.' + base]; }
        const cname = wildcard ? san[0] : cn;
        const d = r(), days = d < .045 ? -between(1, 40) : d < .15 ? between(0, 30) : (type === 'DV' ? between(31, 89) : between(31, 364));
        let managed = true, ineligible = null;
        if (wildcard) { managed = false; ineligible = REASON.wildcard; }
        else if (type === 'DV' && r() < .16) { managed = false; san = [cn, 'www.' + cn]; ineligible = REASON.multi; }
        else if (type === 'DV' && r() < .06) { managed = false; ineligible = REASON.nokey; }
        add({ s, cn: cname, label: sub, san, type, wildcard, daysLeft: days, managed, ineligible });
      }
    }

    // curated demo situations
    const find = (f) => certs.filter(f);
    const ovDue = find(c => c.managed && c.type !== 'DV' && !c.lab);
    const reviews = [['approval', 9], ['approval', 17], ['downgrade', 12], ['ambiguous', 21]];
    reviews.forEach(([kind, days], i) => {
      const c = ovDue[i * 3]; if (!c) return;
      c.notAfter = now + days * DAY; c.notBefore = c.notAfter - 365 * DAY; c.state = 'Review'; c.review = kind;
    });
    const dvManaged = find(c => c.managed && c.type === 'DV' && !c.lab && c.state === 'Managed');
    if (dvManaged[2]) { dvManaged[2].paused = true; dvManaged[2].pauseReason = 'Change freeze CHG0087888 until 2026-10-14'; }
    if (dvManaged[5]) { dvManaged[5].state = 'Failed'; dvManaged[5].lastError = 'ACME validation failed: proof not reachable on port 80 (firewall)'; dvManaged[5].notAfter = now + 6 * DAY; dvManaged[5].notBefore = dvManaged[5].notAfter - 90 * DAY; }
    const winLab = certs.find(c => c.serverId === 'win01' && c.cn.startsWith('critical'));
    if (winLab) winLab.lastScanned = now - 5 * 60000;

    // past renewals, jobs, backups, audit
    const jobs = [], backups = [], events = [];
    const ev = (ts, type, target, actor, detail) => events.push({ ts, type, target, actor, detail: detail || {} });
    const SVC = 'svc-cdm@cdm-ctrl-01', HUMAN = 'a.sharma@pki-ops';
    const renewed = certs.filter(c => c.managed && c.type === 'DV' && !c.lab && c.state === 'Managed' && !c.paused);
    for (let i = 0; i < 18 && i < renewed.length; i++) {
      const c = renewed[i], s = SERVERS.find(x => x.id === c.serverId);
      const start = now - between(2, 27) * DAY - between(0, 20) * HOUR, id = 'JOB-' + hex(10);
      const failed = i === 6, oldT = hex(64), newT = c.thumbprint, oldAfter = start + between(2, 20) * DAY;
      const job = {
        id, certId: c.id, cn: c.cn, serverId: s.id, zone: s.zone, tech: s.tech, startedAt: start, endedAt: start + between(40, 140) * 1000,
        steps: { precheck: 'done', backup: 'done', install: 'done', activate: failed ? 'failed' : 'done', verify: failed ? 'rolled' : 'done' },
        state: failed ? 'Rolled back' : 'Confirmed', oldThumb: oldT, newThumb: failed ? hex(64) : newT, oldNotAfter: oldAfter, oldNotBefore: oldAfter - 90 * DAY,
        error: failed ? (s.os === 'windows' ? 'Restart-Service failed: service did not start' : 'nginx -t failed after install: ssl_certificate key mismatch') : null,
        canary: true, backupId: 'BK-' + id.slice(4), run: 'RUN-' + new Date(start).toISOString().slice(0, 10).replace(/-/g, ''),
      };
      jobs.push(job);
      backups.push({ id: job.backupId, jobId: id, certId: c.id, cn: c.cn, serverId: s.id, createdAt: start + 20000, retainUntil: start + 30 * DAY,
        path: s.os === 'windows' ? 'C:\\ProgramData\\CDM\\backups\\' + id : '/var/backups/cdm/' + id, sha256: sha256(id + oldT),
        oldThumb: oldT, oldNotAfter: oldAfter, oldNotBefore: oldAfter - 90 * DAY, status: 'available' });
      if (!failed) c.history.push({ at: start, jobId: id, from: oldT, to: newT, outcome: 'Confirmed' });
      ev(start, 'acme.issued', c.cn, SVC, { ca: c.ca, jobId: id });
      ev(start + 15000, 'deploy.started', id, SVC, { target: c.cn, host: s.host });
      ev(start + 21000, 'deploy.backup', id, SVC, { path: backups[backups.length - 1].path });
      if (failed) { ev(start + 52000, 'deploy.failed', id, SVC, { step: 'activate', error: job.error }); ev(start + 70000, 'rollback.completed', id, SVC, { verified: true }); }
      else { ev(start + 52000, 'deploy.deployed', id, SVC, { thumbprint: newT.slice(0, 16) }); ev(start + 90000, 'orchestrator.confirmed', id, SVC, { thumbprint: newT.slice(0, 16) }); }
    }
    for (let d = 7; d >= 1; d--) {
      const t = new Date(now - d * DAY); t.setHours(2, 0, 0, 0); const ts = t.getTime();
      ev(ts, 'run.started', 'RUN-' + t.toISOString().slice(0, 10).replace(/-/g, ''), SVC, { command: 'run', scheduled: true });
      SERVERS.filter(s => !s.lab).slice(0, 3).forEach((s, k) => ev(ts + (k + 1) * 4000, 'discovery.scanned', s.name, SVC, { certificates: between(6, 11) }));
      ev(ts + 120000, 'run.finished', 'RUN-' + t.toISOString().slice(0, 10).replace(/-/g, ''), SVC, { problems: d === 3 ? 1 : 0, exit: d === 3 ? 2 : 0 });
    }
    ev(now - 30 * HOUR, 'policy.changed', 'renewal.window_max_days', HUMAN, { from: 45, to: 30 });
    ev(now - 52 * HOUR, 'approval.granted', 'ovcert', HUMAN, { reason: 'Quarterly OV replacement approved (CHG0087611)' });
    events.sort((a, b) => a.ts - b.ts);

    const weekly = Array.from({ length: 12 }, (_, i) => ({ ok: between(9, 34) + i, failed: between(0, 2), rolled: between(0, 2) }));
    return { servers: SERVERS.map(s => ({ ...s })), certs, jobs: jobs.sort((a, b) => b.startedAt - a.startedAt), backups, events, weekly };
  }

  window.CDM_DATA = { sha256, eventHash, buildSeed, rng, DAY, HOUR, REASON, CAS };
})();
