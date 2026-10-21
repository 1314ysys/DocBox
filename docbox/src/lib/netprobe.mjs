/**
 * 网络测试与安全体检工具（纯本地实现，无第三方扫描服务）。
 * 所有能力均面向“自有或已获授权”的资产：连通性、指纹、配置审计、被动信息收集。
 */
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';

export class NetError extends Error {}
const fail = (msg) => { throw new NetError(msg); };

const WARN = '仅限自有或已获授权的资产';

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new NetError((label || '操作') + '超时（' + ms + 'ms）')), ms); }),
  ]);
}

// Windows 系统命令在 Linux（容器）里换成等价工具，参数就地翻译
function linuxCmd(cmd, args) {
  switch (cmd) {
    case 'ping.exe': return ['ping', ['-c', args[1], '-W', String(Math.max(1, Math.round(Number(args[3] || 1500) / 1000))), args[4]]];
    case 'tracert.exe': return ['traceroute', ['-n', '-m', args[2], '-w', '2', args[5]]];
    case 'ipconfig.exe': return ['ip', ['addr']];
    case 'arp.exe': return ['ip', ['neigh']];
    case 'netstat.exe': return ['ss', ['-tunap']];
    default: return [cmd.replace(/\.exe$/i, ''), args];
  }
}

function runWin(cmd, args, timeoutMs = 20000) {
  const isWin = process.platform === 'win32';
  const [exe, argv] = isWin ? [cmd, args] : linuxCmd(cmd, args);
  return new Promise((resolve, reject) => {
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/c', 'chcp 65001 >nul && ' + exe + ' ' + argv.map((a) => (a.includes(' ') ? '"' + a + '"' : a)).join(' ')], { windowsHide: true })
      : spawn(exe, argv, { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } reject(new NetError('命令超时')); }, timeoutMs);
    child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c) => { out += c.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); reject(new NetError(e.message)); });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

const normalizeUrl = (input) => {
  let s = String(input || '').trim();
  if (!s) fail('请填写 URL');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try { return new URL(s); } catch { fail('URL 格式不正确：' + input); }
};

const stripHost = (input) => String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

// ------------------------------------------------------------------ DNS
async function dnsLookup(f) {
  const host = stripHost(f.host);
  if (!host) fail('请填写域名');
  const types = String(f.types || 'A,AAAA,MX,TXT,NS,CNAME').split(/[,，\s]+/).filter(Boolean).map((t) => t.toUpperCase());
  const map = { A: dns.resolve4, AAAA: dns.resolve6, MX: dns.resolveMx, TXT: dns.resolveTxt, NS: dns.resolveNs, CNAME: dns.resolveCname, SOA: dns.resolveSoa, PTR: dns.reverse, SRV: dns.resolveSrv };
  const records = {};
  const errors = {};
  await Promise.all(types.map(async (t) => {
    const fn = map[t];
    if (!fn) { errors[t] = '不支持的记录类型'; return; }
    try { records[t] = await withTimeout(fn(host), 8000, t + ' 查询'); } catch (e) { errors[t] = e.code || e.message; }
  }));
  const okTypes = Object.keys(records).filter((k) => records[k] && records[k].length);
  const failed = Object.keys(errors).length;
  return { data: { host, records, errors }, note: `${host}：${okTypes.join('/') || '无记录'}${failed ? '（' + failed + ' 类查询失败，可能是本机 DNS 受限）' : ''}` };
}

// ------------------------------------------------------------------ 端口扫描
const PORT_PRESETS = {
  web: [80, 443, 3000, 3001, 5000, 7001, 8000, 8008, 8080, 8081, 8088, 8443, 8888, 9000, 9090, 9200, 9443],
  top100: [7, 9, 13, 21, 22, 23, 25, 26, 37, 53, 79, 80, 81, 88, 106, 110, 111, 113, 119, 135, 139, 143, 144, 179, 199, 389, 427, 443, 444, 445, 465, 513, 514, 515, 543, 544, 548, 554, 587, 631, 646, 873, 990, 993, 995, 1025, 1026, 1027, 1028, 1029, 1110, 1433, 1720, 1723, 1755, 1900, 2000, 2001, 2049, 2121, 2717, 3000, 3128, 3306, 3389, 3986, 4899, 5000, 5009, 5051, 5060, 5101, 5190, 5357, 5432, 5631, 5666, 5800, 5900, 6000, 6001, 6646, 7070, 8000, 8008, 8009, 8080, 8081, 8443, 8888, 9100, 9999, 10000, 32768, 49152, 49153, 49154],
  top1000: null,
};

function parsePorts(mode, custom) {
  if (mode === 'custom') {
    const out = [];
    for (const part of String(custom || '').split(/[,，;；\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)-(\d+)$/);
      if (m) { const [a, b] = [Number(m[1]), Number(m[2])]; for (let p = Math.max(1, a); p <= Math.min(65535, b); p++) out.push(p); }
      else if (/^\d+$/.test(part)) out.push(Number(part));
    }
    return [...new Set(out)].filter((p) => p >= 1 && p <= 65535).slice(0, 2000);
  }
  if (mode === 'top1000') return Array.from({ length: 1000 }, (_, i) => i + 1);
  return PORT_PRESETS[mode] || PORT_PRESETS.web;
}

function tcpConnect(host, port, timeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const done = (open, extra = {}) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, open, ms: Date.now() - started, ...extra });
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, { reason: 'timeout' }));
    socket.once('error', (e) => done(false, { reason: e.code || 'error' }));
    socket.connect(port, host);
  });
}

const SERVICE = { 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 135: 'RPC', 139: 'NetBIOS', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB', 1433: 'MSSQL', 3000: 'Dev/Node', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt', 9200: 'Elasticsearch', 27017: 'MongoDB' };

async function portScan(f) {
  const host = stripHost(f.host);
  if (!host) fail('请填写目标主机');
  const ports = parsePorts(f.mode || 'web', f.ports);
  if (!ports.length) fail('端口列表为空');
  if (ports.length > 1000) fail('单次最多扫描 1000 个端口');
  const timeout = Math.max(100, Math.min(5000, Number(f.timeout) || 600));
  const results = [];
  const concurrency = 64;
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, async () => {
    while (index < ports.length) {
      const port = ports[index++];
      results.push(await tcpConnect(host, port, timeout));
    }
  }));
  results.sort((a, b) => a.port - b.port);
  const open = results.filter((r) => r.open);
  return {
    data: {
      host,
      scanned: ports.length,
      open: open.map((r) => ({ port: r.port, service: SERVICE[r.port] || '', ms: r.ms })),
      closedSample: results.filter((r) => !r.open).slice(0, 20),
      elapsedMs: results.reduce((m, r) => Math.max(m, r.ms), 0),
      warning: WARN,
    },
    note: `${host} 扫描 ${ports.length} 个端口，开放 ${open.length} 个${open.length ? '：' + open.map((r) => r.port).join(',') : ''}`,
  };
}

// ------------------------------------------------------------------ 连通性
async function pingHost(f) {
  const host = stripHost(f.host);
  const count = Math.max(1, Math.min(10, Number(f.count) || 4));
  const icmp = { ok: false, raw: '' };
  try {
    const out = await runWin('ping.exe', ['-n', String(count), '-w', '1500', host], 25000);
    const times = [...out.matchAll(/[=<](\d+)\s*ms/gi)].map((m) => Number(m[1]));
    const loss = (out.match(/\((\d+)% 丢失\)/) || out.match(/(\d+)% loss/)) || [];
    icmp.ok = /TTL=|ttl=/.test(out);
    icmp.avgMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    icmp.minMs = times.length ? Math.min(...times) : null;
    icmp.maxMs = times.length ? Math.max(...times) : null;
    icmp.lossPct = loss[1] !== undefined ? Number(loss[1]) : null;
    icmp.raw = out.split(/\r?\n/).slice(0, 12).join('\n');
  } catch (e) { icmp.error = e.message; }
  const tcpPorts = [80, 443, 22, 3389, 3000];
  const tcp = [];
  for (const port of tcpPorts) tcp.push(await tcpConnect(host, port, 900));
  return {
    data: { host, icmp, tcp: tcp.map((t) => ({ port: t.port, open: t.open, ms: t.ms })), warning: WARN },
    note: icmp.ok ? `${host} 可连通（平均 ${icmp.avgMs}ms）` : `${host} ICMP 无响应，TCP 开放 ${tcp.filter((t) => t.open).length} 个端口`,
  };
}

async function traceroute(f) {
  const host = stripHost(f.host);
  const hops = Math.max(3, Math.min(30, Number(f.maxHops) || 15));
  const out = await runWin('tracert.exe', ['-d', '-h', String(hops), '-w', '900', host], 60000);
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d+\s/.test(l));
  const parsed = lines.map((l) => {
    const idx = l.match(/^(\d+)/);
    const ips = [...l.matchAll(/(\d{1,3}(?:\.\d{1,3}){3})/g)].map((m) => m[1]);
    const times = [...l.matchAll(/(\d+(?:\.\d+)?)\s*ms/g)].map((m) => Math.round(Number(m[1])));
    return { hop: Number(idx[1]), ips: [...new Set(ips)], ms: times, timeout: /请求超时|timed out/i.test(l) };
  });
  return { data: { host, hops: parsed, raw: out.slice(0, 4000) }, note: `${host}：${parsed.length} 跳` };
}

// ------------------------------------------------------------------ HTTP 审计
const SECURITY_HEADERS = [
  ['content-security-policy', 'CSP', '限制脚本与资源来源，缓解 XSS'],
  ['strict-transport-security', 'HSTS', '强制 HTTPS 访问'],
  ['x-frame-options', 'X-Frame-Options', '防止点击劫持'],
  ['x-content-type-options', 'X-Content-Type-Options', '禁止 MIME 嗅探'],
  ['referrer-policy', 'Referrer-Policy', '控制 Referrer 泄露'],
  ['permissions-policy', 'Permissions-Policy', '限制浏览器特性'],
  ['cross-origin-opener-policy', 'COOP', '隔离跨源窗口'],
  ['x-xss-protection', 'X-XSS-Protection', '老浏览器 XSS 过滤'],
];

async function fetchHeaders(url, method = 'GET', timeout = 15000) {
  const u = normalizeUrl(url);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, { method, timeout, headers: { 'user-agent': 'DocBox/0.1.1 (+local)' }, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (chunks.length < 32) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8').slice(0, 20000), rawHeaders: res.rawHeaders, httpVersion: res.httpVersion }));
    });
    req.on('timeout', () => { req.destroy(new NetError('请求超时')); });
    req.on('error', (e) => reject(new NetError(e.message)));
    req.end();
  });
}

async function httpHeaders(f) {
  const r = await fetchHeaders(f.url);
  const present = [];
  const missing = [];
  for (const [key, label, why] of SECURITY_HEADERS) {
    const val = r.headers[key];
    if (val) present.push({ key: label, value: String(val).slice(0, 200) });
    else missing.push({ key: label, why });
  }
  const score = Math.round((present.length / SECURITY_HEADERS.length) * 100);
  const grade = score >= 85 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : score >= 25 ? 'D' : 'E';
  const server = r.headers.server || '';
  const powered = r.headers['x-powered-by'] || '';
  const issues = [];
  if (powered) issues.push('暴露了 X-Powered-By：' + powered);
  if (!r.headers['strict-transport-security'] && String(f.url).startsWith('https')) issues.push('HTTPS 站点缺少 HSTS');
  if (!r.headers['content-security-policy']) issues.push('缺少 CSP，XSS 风险较高');
  if (/php\/[45]\./i.test(powered) || /php\/[45]\./i.test(server)) issues.push('使用了已停止维护的 PHP 版本');
  return {
    data: {
      url: r.headers.location ? f.url : f.url,
      status: r.status,
      server,
      poweredBy: powered,
      contentType: r.headers['content-type'] || '',
      score,
      grade,
      present,
      missing,
      issues,
      headers: Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v).slice(0, 300)])),
      warning: WARN,
    },
    note: `${f.url} → HTTP ${r.status}，安全头 ${present.length}/${SECURITY_HEADERS.length}（评级 ${grade}）`,
  };
}

async function tlsCheck(f) {
  const host = stripHost(f.host);
  const port = Number(f.port) || 443;
  const result = await new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 12000 }, () => {
      const cert = socket.getPeerCertificate(true);
      const info = {
        protocol: socket.getProtocol(),
        cipher: socket.getCipher(),
        authorized: socket.authorized,
        authorizationError: socket.authorizationError,
        subject: cert.subject,
        issuer: cert.issuer,
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        serialNumber: cert.serialNumber,
        fingerprint256: cert.fingerprint256,
        subjectAltName: cert.subjectaltname,
        chainLength: (() => { let n = 0; let c = cert; while (c && c.issuerCertificate && c.issuerCertificate !== c) { n++; c = c.issuerCertificate; } return n; })(),
      };
      socket.end();
      resolve(info);
    });
    socket.on('timeout', () => { socket.destroy(); reject(new NetError('TLS 连接超时')); });
    socket.on('error', (e) => reject(new NetError(e.message)));
  });
  const expires = new Date(result.validTo);
  const daysLeft = Math.round((expires.getTime() - Date.now()) / 86400000);
  const warnings = [];
  if (!result.authorized) warnings.push('证书校验未通过：' + result.authorizationError);
  if (daysLeft < 0) warnings.push('证书已过期');
  else if (daysLeft < 15) warnings.push('证书将在 ' + daysLeft + ' 天内过期');
  if (/TLSv1(\.1)?$/.test(result.protocol || '')) warnings.push('使用了过时的 TLS 协议：' + result.protocol);
  return {
    data: { host, port, ...result, expiresAt: expires.toISOString(), daysLeft, warnings, warning: WARN },
    note: `${host}:${port} ${result.protocol} · ${daysLeft >= 0 ? '剩余 ' + daysLeft + ' 天' : '已过期'}`,
  };
}

// 公共查询接口（rdap.org / crt.sh 等）经常抽风：同一次调用重试两次，成功率明显更高
async function fetchWithRetry(url, opts = {}, times = 2, gap = 1200) {
  let lastErr = null;
  for (let i = 0; i < times; i += 1) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 20000) });
      if (res.ok) return res;
      lastErr = new Error('HTTP ' + res.status);
      if (res.status < 500 && res.status !== 429) throw lastErr; // 4xx 重试没意义
    } catch (e) {
      lastErr = e;
    }
    if (i < times - 1) await new Promise((r) => setTimeout(r, gap));
  }
  throw lastErr || new Error('网络错误');
}

// ------------------------------------------------------------------ 注册信息
async function rdap(f) {
  const q = String(f.query || '').trim();
  if (!q) fail('请填写域名或 IP');
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(q);
  const url = 'https://rdap.org/' + (isIp ? 'ip/' : 'domain/') + encodeURIComponent(q);
  let res;
  try {
    res = await fetchWithRetry(url, { headers: { accept: 'application/rdap+json', 'user-agent': 'DocBox/0.2.0 (+local)' }, timeout: 20000 }, 3, 1000);
  } catch (e) {
    fail('RDAP 服务暂时不可达（' + e.message + '），请稍后重试；域名拼写错误也会查不到');
  }
  const json = await res.json();
  const events = (json.events || []).map((e) => ({ action: e.eventAction, date: e.eventDate }));
  const nameservers = (json.nameservers || []).map((n) => n.ldhName).filter(Boolean);
  const entities = (json.entities || []).map((e) => ({
    handle: e.handle,
    roles: e.roles || [],
    name: e.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3] || '',
  })).slice(0, 12);
  const status = json.status || [];
  return {
    data: { query: q, handle: json.handle, name: json.ldhName || json.name, status, events, nameservers, entities, warning: WARN },
    note: `${q}：${status.join(',') || '无状态'}；${events.map((e) => e.action + ' ' + String(e.date).slice(0, 10)).join(' / ')}`,
  };
}

async function redirectTrace(f) {
  let url = normalizeUrl(f.url).href;
  const chain = [];
  for (let i = 0; i < 8; i++) {
    const r = await fetchHeaders(url, 'GET', 12000);
    chain.push({ url, status: r.status, location: r.headers.location || null, server: r.headers.server || '' });
    if (!r.headers.location || r.status < 300 || r.status >= 400) break;
    url = new URL(r.headers.location, url).href;
  }
  return { data: { chain, final: chain[chain.length - 1].url, warning: WARN }, note: `${chain.length} 跳，最终 ${chain[chain.length - 1].url}` };
}

async function timing(f) {
  const u = normalizeUrl(f.url);
  const t0 = process.hrtime.bigint();
  const phase = () => Number(process.hrtime.bigint() - t0) / 1e6;
  const out = {};
  const dnsStart = phase();
  try { await withTimeout(dns.lookup(u.hostname), 8000, 'DNS'); } catch (e) { out.dnsError = e.message; }
  out.dns = Math.round(phase() - dnsStart);
  const connStart = phase();
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  const conn = await new Promise((resolve) => {
    const t = Date.now();
    const s = new net.Socket();
    s.setTimeout(8000);
    s.once('connect', () => { s.destroy(); resolve(Date.now() - t); });
    s.once('timeout', () => { s.destroy(); resolve(-1); });
    s.once('error', () => resolve(-1));
    s.connect(port, u.hostname);
  });
  out.tcp = conn;
  const reqStart = phase();
  try {
    const r = await fetchHeaders(u.href, 'HEAD', 15000);
    out.ttfb = Math.round(phase() - reqStart);
    out.status = r.status;
    out.httpVersion = r.httpVersion;
    out.server = r.headers.server || '';
    out.contentLength = Number(r.headers['content-length'] || 0);
  } catch (e) { out.error = e.message; }
  out.total = Math.round(phase());
  out.url = u.href;
  out.warning = WARN;
  return { data: out, note: `${u.hostname}：DNS ${out.dns}ms · TCP ${out.tcp}ms · TTFB ${out.ttfb ?? '-'}ms` };
}

const DIR_WORDLISTS = {
  common: ['/robots.txt', '/sitemap.xml', '/favicon.ico', '/.well-known/security.txt', '/admin', '/login', '/api', '/health', '/status', '/metrics', '/.env', '/.git/HEAD', '/backup.zip', '/phpinfo.php', '/wp-login.php', '/server-status', '/actuator', '/swagger-ui.html', '/debug', '/console', '/config.json', '/crossdomain.xml', '/.htaccess', '/README.md'],
  admin: ['/admin', '/admin/login', '/manager/html', '/wp-admin', '/phpmyadmin', '/adminer.php', '/console', '/actuator/env', '/actuator/health', '/api/admin', '/dashboard', '/login'],
  leak: ['/.env', '/.git/HEAD', '/.svn/entries', '/.DS_Store', '/backup.zip', '/backup.sql', '/db.sql', '/config.json', '/config.yml', '/web.config', '/phpinfo.php', '/server-status', '/.htaccess', '/composer.json', '/package.json', '/Dockerfile', '/docker-compose.yml', '/.aws/credentials', '/id_rsa'],
};

async function dirScan(f) {
  const base = normalizeUrl(f.url).href.replace(/\/$/, '');
  const paths = DIR_WORDLISTS[f.preset || 'common'] || DIR_WORDLISTS.common;
  const results = [];
  const concurrency = 6;
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
    while (i < paths.length) {
      const p = paths[i++];
      try {
        const r = await fetchHeaders(base + p, 'GET', 8000);
        if (r.status !== 404) results.push({ path: p, status: r.status, size: r.body.length, type: r.headers['content-type'] || '', location: r.headers.location || null });
      } catch { /* 跳过不可达路径 */ }
    }
  }));
  results.sort((a, b) => a.status - b.status);
  const exposed = results.filter((r) => r.status >= 200 && r.status < 400);
  return { data: { base, scanned: paths.length, hits: results, exposed: exposed.map((r) => r.path), warning: WARN }, note: `探测 ${paths.length} 条路径，${exposed.length} 条返回有效响应` };
}

async function methodsCheck(f) {
  const url = normalizeUrl(f.url).href;
  const methods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'TRACE', 'PATCH'];
  const results = [];
  for (const m of methods) {
    try {
      const r = await fetchHeaders(url, m, 8000);
      results.push({ method: m, status: r.status, allow: r.headers.allow || '', interesting: [200, 201, 204, 301, 302, 401, 403].includes(r.status) });
    } catch (e) { results.push({ method: m, status: 0, error: e.message }); }
  }
  const dangerous = results.filter((r) => ['PUT', 'DELETE', 'TRACE', 'PATCH'].includes(r.method) && r.status >= 200 && r.status < 300);
  return { data: { url, results, dangerous: dangerous.map((d) => d.method), warning: WARN }, note: `${results.length} 种方法已探测${dangerous.length ? '，暴露危险方法：' + dangerous.map((d) => d.method).join(',') : ''}` };
}

async function banner(f) {
  const host = stripHost(f.host);
  const port = Number(f.port) || 80;
  const started = Date.now();
  const result = await new Promise((resolve) => {
    const socket = new net.Socket();
    let data = '';
    socket.setTimeout(6000);
    const finish = (error) => { socket.destroy(); resolve({ data, error, ms: Date.now() - started }); };
    socket.once('connect', () => {
      if ([80, 8080, 8000, 3000, 8081].includes(port)) socket.write('HEAD / HTTP/1.0\r\nHost: ' + host + '\r\nUser-Agent: DocBox\r\n\r\n');
      else if (port === 443 || port === 8443) socket.write('HEAD / HTTP/1.0\r\nHost: ' + host + '\r\n\r\n');
    });
    socket.on('data', (c) => { data += c.toString('utf8'); if (data.length > 4000) finish(); });
    socket.on('timeout', () => finish('timeout'));
    socket.on('error', (e) => finish(e.code || 'error'));
    socket.on('close', () => finish());
    socket.connect(port, host);
  });
  const headerLines = result.data.split(/\r?\n/).filter(Boolean).slice(0, 20);
  const serverLine = headerLines.find((l) => /^server:/i.test(l)) || '';
  return {
    data: { host, port, banner: result.data.slice(0, 2000), lines: headerLines, server: serverLine, error: result.error || null, elapsedMs: result.ms, warning: WARN },
    note: result.data ? `${host}:${port} 识别到 ${serverLine || '响应头'}` : `${host}:${port} 无 Banner${result.error ? '（' + result.error + '）' : ''}`,
  };
}

async function localNetwork() {
  const [ipconfig, arp, netstat] = await Promise.all([
    runWin('ipconfig.exe', ['/all'], 20000).catch((e) => 'IPCONFIG_ERROR: ' + e.message),
    runWin('arp.exe', ['-a'], 15000).catch((e) => 'ARP_ERROR: ' + e.message),
    runWin('netstat.exe', ['-ano'], 25000).catch((e) => 'NETSTAT_ERROR: ' + e.message),
  ]);
  const adapters = [];
  let current = null;
  for (const line of ipconfig.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/适配器|adapter/i.test(t) && t.endsWith(':')) { current = { name: t.replace(/:$/, ''), fields: {} }; adapters.push(current); continue; }
    const m = t.match(/^([^:]+?)\s*[:：]\s*(.+)$/);
    if (m && current) current.fields[m[1].trim()] = m[2].trim();
  }
  const arpEntries = [];
  for (const line of arp.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f-]{11,17})\s+(\S+)/i);
    if (m) arpEntries.push({ ip: m[1], mac: m[2], type: m[3] });
  }
  const listen = [];
  for (const line of netstat.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+LISTENING\s+(\d+)/i);
    if (m) listen.push({ addr: m[1], port: Number(m[2]), pid: Number(m[5]) });
  }
  return {
    data: { adapters: adapters.slice(0, 8), arp: arpEntries.slice(0, 40), listening: listen.slice(0, 60), warning: WARN },
    note: `${adapters.length} 个网卡 · ${arpEntries.length} 条 ARP · ${listen.length} 个监听端口`,
  };
}

// crt.sh：证书透明度日志，最权威但经常 502/超时
async function fromCrtSh(domain) {
  const res = await fetchWithRetry('https://crt.sh/?q=' + encodeURIComponent('%25.' + domain) + '&output=json', { timeout: 20000, headers: { accept: 'application/json' } }, 2, 1500);
  if (!res.ok) throw new Error('crt.sh HTTP ' + res.status);
  const rows = await res.json();
  const set = new Set();
  for (const r of rows) for (const n of String(r.name_value || '').split(/\n/)) { const v = n.trim().toLowerCase(); if (v && !v.startsWith('*')) set.add(v); }
  return set;
}

// hackertarget：备用源，纯文本 "子域名,IP" 每行一条
async function fromHackerTarget(domain) {
  const res = await fetchWithRetry('https://api.hackertarget.com/hostsearch/?q=' + encodeURIComponent(domain), { timeout: 15000, headers: { accept: 'text/plain' } }, 2, 1000);
  if (!res.ok) throw new Error('hackertarget HTTP ' + res.status);
  const text = await res.text();
  if (/error|API count exceeded|no results/i.test(text)) throw new Error('hackertarget：' + text.trim().slice(0, 60));
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    const host = line.split(',')[0]?.trim().toLowerCase();
    if (host && host.includes('.') && !host.startsWith('*')) set.add(host);
  }
  return set;
}

async function subdomains(f) {
  const domain = stripHost(f.domain);
  if (!domain) fail('请填写域名');
  const providers = [
    { name: 'crt.sh', run: fromCrtSh },
    { name: 'hackertarget', run: fromHackerTarget },
  ];
  const errors = [];
  for (const provider of providers) {
    try {
      const set = await provider.run(domain);
      if (set.size) {
        const list = [...set].sort().slice(0, 300);
        return {
          data: { domain, source: provider.name, count: set.size, subdomains: list, warning: WARN, fallbacks: errors },
          note: `${domain}：发现 ${set.size} 个子域名（来源 ${provider.name}）`,
        };
      }
      errors.push(provider.name + '：没有查到记录');
    } catch (e) {
      errors.push(provider.name + '：' + e.message);
    }
  }
  fail('子域名查询失败，公共查询接口暂时不可用（' + errors.join('；') + '）。crt.sh 经常 502，稍等一两分钟重试通常就好了');
}

function headersRecipe(f) {
  const nginx = [
    '# DocBox 生成 —— 建议按站点实际资源调整 CSP',
    'add_header Strict-Transport-Security "max-age=31536000' + (f.strict !== 'false' ? '; includeSubDomains; preload' : '') + '" always;',
    "add_header X-Frame-Options \"SAMEORIGIN\" always;",
    "add_header X-Content-Type-Options \"nosniff\" always;",
    "add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;",
    "add_header Permissions-Policy \"geolocation=(), microphone=(), camera=()\" always;",
    "add_header Content-Security-Policy \"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'\" always;",
    "server_tokens off;",
  ].join('\n');
  const apache = [
    'Header always set Strict-Transport-Security "max-age=31536000' + (f.strict !== 'false' ? '; includeSubDomains; preload' : '') + '"',
    'Header always set X-Frame-Options "SAMEORIGIN"',
    'Header always set X-Content-Type-Options "nosniff"',
    'Header always set Referrer-Policy "strict-origin-when-cross-origin"',
    'Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"',
    'Header always set Content-Security-Policy "default-src \'self\'; img-src \'self\' data:; style-src \'self\' \'unsafe-inline\'; script-src \'self\'"',
    'ServerTokens Prod',
    'ServerSignature Off',
  ].join('\n');
  const config = f.server === 'apache' ? apache : nginx;
  return { data: { server: f.server || 'nginx', config, tips: ['先用 Content-Security-Policy-Report-Only 观测一周再强制', 'HSTS 预加载一旦提交不可快速回滚，确认全站 HTTPS 后再启用'] }, note: '已生成 ' + (f.server === 'apache' ? 'Apache' : 'Nginx') + ' 配置' };
}

function ipScope(ip) {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts;
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127 || a === 0) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-nat';
  if (a === 224 || a > 239) return 'multicast/reserved';
  return 'public';
}

async function ipInfo(f) {
  const ip = String(f.ip || '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) fail('请填写合法的 IPv4 地址');
  const scope = ipScope(ip);
  let reverse = '';
  try { reverse = (await dns.reverse(ip))[0] || ''; } catch { reverse = ''; }
  if (scope !== 'public') {
    return {
      data: { ip, scope, reverse, note: '内网 / 保留地址，RDAP 无公开注册信息', warning: WARN },
      note: ip + ' 属于' + (scope === 'private' ? '内网' : scope === 'link-local' ? '链路本地' : scope === 'carrier-nat' ? '运营商 NAT' : '保留') + '地址',
    };
  }
  const res = await fetch('https://rdap.org/ip/' + encodeURIComponent(ip), { headers: { accept: 'application/rdap+json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!res || !res.ok) {
    return {
      data: { ip, scope, reverse, note: 'RDAP 查询不可用（' + (res ? 'HTTP ' + res.status : '网络错误') + '），已返回基础信息', warning: WARN },
      note: ip + ' 为公网地址，RDAP 暂不可用',
    };
  }
  const json = await res.json();
  return {
    data: {
      ip,
      handle: json.handle,
      name: json.name,
      country: json.country,
      startAddress: json.startAddress,
      endAddress: json.endAddress,
      type: json.type,
      entities: (json.entities || []).map((e) => ({ handle: e.handle, roles: e.roles, name: e.vcardArray?.[1]?.find((x) => x[0] === 'fn')?.[3] || '' })).slice(0, 8),
      events: (json.events || []).map((e) => ({ action: e.eventAction, date: e.eventDate })),
      warning: WARN,
    },
    note: `${ip} → ${json.name || json.handle || '未知'}（${json.country || '-'}）`,
  };
}

const IMPL = {
  'dns': dnsLookup,
  'portscan': portScan,
  'ping': pingHost,
  'traceroute': traceroute,
  'headers': httpHeaders,
  'tls': tlsCheck,
  'rdap': rdap,
  'redirect': redirectTrace,
  'timing': timing,
  'dirs': dirScan,
  'methods': methodsCheck,
  'banner': banner,
  'local': localNetwork,
  'subdomain': subdomains,
  'headers-gen': headersRecipe,
  'ip-info': ipInfo,
};

export const NET_TOOL_IDS = Object.keys(IMPL);

export async function runNetTool(id, fields) {
  const fn = IMPL[id];
  if (!fn) fail('未知的网络工具：' + id);
  const result = await fn(fields || {});
  return { ...result, data: { ...result.data, generatedAt: new Date().toISOString() } };
}
