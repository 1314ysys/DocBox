/**
 * 浏览器本机发起的网络探测引擎（net-client）
 *
 * 设计目标：网络体检从「用户浏览器所在电脑」发起，服务器不再作为跳板去探测内网/外网目标。
 * 浏览器沙箱限制：无 ICMP、无原始 TCP、跨域读不到响应头/证书 —— 这些项会明确标注「浏览器受限」。
 */
const DOH = ['https://1.1.1.1/dns-query', 'https://dns.alidns.com/resolve'];

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA'];

function stripHost(v) {
  return String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

/** 不同工具的字段名不同（host / url / query / domain / ip），统一取目标 */
function targetOf(f) {
  return String((f && (f.host || f.url || f.query || f.domain || f.ip)) || '').trim();
}


async function doh(name, type) {
  const errors = [];
  for (const base of DOH) {
    try {
      const url = base + '?name=' + encodeURIComponent(name) + '&type=' + type;
      const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { errors.push(base + ' HTTP ' + res.status); continue; }
      const json = await res.json();
      return { ok: true, status: json.Status, answer: json.Answer || [], authority: json.Authority || [], server: base };
    } catch (e) {
      errors.push(base + ' ' + (e.name === 'TimeoutError' ? '超时' : e.message));
    }
  }
  throw new Error('DNS 查询失败（浏览器 DoH 不可用）：' + errors.join('；'));
}

function answerRows(answer) {
  return (answer || []).map((a) => ({ name: a.name, type: a.type, ttl: a.TTL, data: a.data }));
}

const TYPE_NAME = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA' };

async function dns(f) {
  const host = stripHost(targetOf(f));
  const rows = [];
  const wanted = String(f.types || '').split(/[,\s]+/).map((x) => x.toUpperCase()).filter((x) => TYPES.includes(x));
  for (const t of (wanted.length ? wanted : TYPES)) {
    try {
      const r = await doh(host, t);
      for (const a of r.answer) rows.push({ type: TYPE_NAME[a.type] || String(a.type), name: a.name, ttl: a.TTL, data: a.data });
    } catch { /* 单个类型失败忽略 */ }
  }
  if (!rows.length) throw new Error('没有查到任何记录（域名不存在或 DoH 被拦截）');
  return { data: { host, via: 'DoH（Cloudflare / AliDNS）', records: rows }, note: host + '：' + rows.length + ' 条记录（浏览器本机查询）' };
}

async function ping(f) {
  const host = stripHost(targetOf(f));
  const count = Math.max(1, Math.min(10, Number(f.count) || 4));
  const raw = targetOf(f);
  const target = /^https?:/i.test(raw) ? raw : 'https://' + host + '/';
  const times = [];
  let ok = 0;
  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    try {
      await fetch(target + (target.includes('?') ? '&' : '?') + '_t=' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) });
      ok++;
      times.push(Math.round(performance.now() - t0));
    } catch {
      times.push(null);
    }
  }
  const valid = times.filter((t) => t !== null);
  return {
    data: {
      host, samples: times, reachable: ok > 0, kind: 'HTTP 建连延迟（浏览器无法发 ICMP，非 ping 包）',
      avgMs: valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null,
      minMs: valid.length ? Math.min(...valid) : null,
      maxMs: valid.length ? Math.max(...valid) : null,
    },
    note: ok ? host + ' 可连通，平均 ' + Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) + 'ms（HTTP 延迟）' : host + ' 无法连通（浏览器侧）',
  };
}

function wsProbe(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let done = false;
    let ws;
    const finish = (state) => {
      if (done) return;
      done = true;
      try { ws && ws.close(); } catch { /* ignore */ }
      resolve({ port, state, ms: Math.round(performance.now() - t0) });
    };
    const timer = setTimeout(() => finish('filtered'), timeout);
    try {
      ws = new WebSocket((port === 443 ? 'wss' : 'ws') + '://' + host + ':' + port + '/');
      ws.onopen = () => { clearTimeout(timer); finish('open'); };
      ws.onerror = () => { clearTimeout(timer); finish('closed'); };
    } catch {
      clearTimeout(timer);
      finish('closed');
    }
  });
}

const PRESETS = {
  web: '80,443,8080,8443,8000,8888,3000,5000',
  top100: '21,22,23,25,53,80,110,111,135,139,143,443,445,587,631,993,995,1080,1433,1521,1723,2049,2375,3000,3128,3306,3389,5432,5555,5601,5672,5900,5984,6379,7001,8000,8080,8443,8888,9000,9090,9200,9300,11211,27017',
  top1000: '21,22,23,25,53,80,110,143,443,445,587,993,995,1433,1521,2375,3000,3306,3389,5432,5900,5984,6379,8080,8443,8888,9000,9200,11211,27017',
};
async function portscan(f) {
  const host = stripHost(targetOf(f));
  const raw = String(f.ports || '').trim() || PRESETS[f.mode] || PRESETS.top100;
  const ports = raw.split(/[,\s]+/).map((p) => Number(p)).filter((p) => p > 0 && p < 65536).slice(0, 40);
  const results = [];
  for (let i = 0; i < ports.length; i += 6) {
    const batch = ports.slice(i, i + 6);
    const part = await Promise.all(batch.map((p) => wsProbe(host, p)));
    results.push(...part);
  }
  const open = results.filter((r) => r.state === 'open');
  return {
    data: { host, ports: results, open: open.map((r) => r.port), method: 'WebSocket 握手探测（浏览器本机发起）' },
    note: host + '：开放 ' + open.length + ' / ' + results.length + ' 个端口（WebSocket 方式）',
  };
}

function unsupported(name, why) {
  return { data: { supported: false, tool: name, reason: why }, note: name + '：浏览器沙箱无法完成（' + why + '），请用系统自带命令' };
}

function headersGen(f) {
  const host = stripHost(targetOf(f)) || 'example.com';
  const strict = String(f.strict ?? 'true') !== 'false';
  const apache = String(f.server || 'nginx') === 'apache';
  if (apache) {
    const h = [
      'Header always set X-Content-Type-Options "nosniff"',
      'Header always set X-Frame-Options "SAMEORIGIN"',
      'Header always set Referrer-Policy "strict-origin-when-cross-origin"',
      'Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"',
      'Header always set Content-Security-Policy "default-src \'self\'; img-src \'self\' data: https:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; object-src \'none\'; frame-ancestors \'self\'"',
      strict ? 'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"' : '# 未开启 HSTS（strict=false）',
    ];
    return { data: { host, server: 'apache', config: h.join('\n'), grade: strict ? 'A 级（严格）' : 'B 级' }, note: host + ' Apache 安全头配置已生成' };
  }
  const https = true;
  const lines = [
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header X-Frame-Options "SAMEORIGIN" always;',
    'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    'add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;',
    'add_header Content-Security-Policy "default-src \'self\'; img-src \'self\' data: https:; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; object-src \'none\'; base-uri \'self\'; frame-ancestors \'self\'" always;',
    strict ? 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;' : '# strict=false：未启用 HSTS 预加载',
  ];
  return {
    data: { host, server: 'nginx', https, nginx: lines.join('\n'), grade: strict ? 'A 级安全响应头模板（严格）' : 'B 级模板' },
    note: host + ' 的安全响应头模板已生成（可直接粘贴到 Nginx）',
  };
}

async function timing(f) {
  const raw = targetOf(f);
  const host = stripHost(raw);
  const url = /^https?:/i.test(raw) ? raw : 'https://' + host + '/';
  const t0 = performance.now();
  let status = null;
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    status = res.status;
    await res.arrayBuffer().catch(() => null);
  } catch { /* 跨域失败也能量到时间 */ }
  const total = Math.round(performance.now() - t0);
  const nav = performance.getEntriesByType('resource').filter((e) => e.name.startsWith(url.split('?')[0]));
  const last = nav[nav.length - 1];
  return {
    data: {
      url, status, totalMs: total,
      dnsMs: last ? Math.round(last.domainLookupEnd - last.domainLookupStart) : null,
      tcpMs: last ? Math.round(last.connectEnd - last.connectStart) : null,
      tlsMs: last && last.secureConnectionStart ? Math.round(last.connectEnd - last.secureConnectionStart) : null,
      ttfbMs: last ? Math.round(last.responseStart - last.requestStart) : null,
      downloadMs: last ? Math.round(last.responseEnd - last.responseStart) : null,
      note: last ? '' : '跨域站点拿不到细分阶段，只给总耗时',
    },
    note: url + ' 总耗时 ' + total + 'ms',
  };
}

const SECURITY_HEADERS = [
  ['strict-transport-security', 'HSTS'],
  ['content-security-policy', 'CSP'],
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'X-Frame-Options'],
  ['referrer-policy', 'Referrer-Policy'],
  ['permissions-policy', 'Permissions-Policy'],
];

async function headers(f) {
  const raw = targetOf(f);
  const url = /^https?:/i.test(raw) ? raw : 'https://' + stripHost(raw) + '/';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const list = [];
    res.headers.forEach((v, k) => list.push({ name: k, value: v.slice(0, 200) }));
    const found = SECURITY_HEADERS.map(([k, label]) => ({ header: label, present: res.headers.has(k), value: res.headers.get(k) || '' }));
    const score = found.filter((x) => x.present).length;
    return { data: { url, status: res.status, headers: list, security: found, score: score + '/' + found.length }, note: url + '：' + score + '/' + found.length + ' 项安全响应头（CORS 放行才读得到）' };
  } catch (e) {
    return {
      data: { url, supported: false, reason: '目标站点未允许跨域（CORS），浏览器本机读不到响应头' },
      note: '该站点未开放 CORS，浏览器读不到响应头；可改用「响应头生成」或本地代理',
    };
  }
}

async function rdap(f) {
  const domain = stripHost(targetOf(f));
  try {
    const res = await fetch('https://rdap.org/domain/' + encodeURIComponent(domain), { headers: { accept: 'application/rdap+json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const events = (j.events || []).map((e) => ({ action: e.eventAction, date: e.eventDate }));
    const ns = (j.nameservers || []).map((n) => n.ldhName).filter(Boolean);
    const status = j.status || [];
    return { data: { domain: j.ldhName || domain, status, nameservers: ns, events, registrar: (j.entities || []).map((e) => (e.vcardArray?.[1] || []).find((v) => v[0] === 'fn')?.[3]).filter(Boolean) }, note: domain + '：RDAP 查询成功（浏览器本机）' };
  } catch (e) {
    return { data: { domain, supported: false, reason: e.message }, note: 'RDAP 接口未放行跨域或网络不可达：' + e.message };
  }
}

const COMMON_SUBS = ['www', 'mail', 'api', 'dev', 'test', 'admin', 'blog', 'shop', 'm', 'app', 'cdn', 'static', 'img', 'vpn', 'git'];

async function subdomain(f) {
  const domain = stripHost(targetOf(f));
  const extra = String(f.extra || '').split(/[,\s]+/).filter(Boolean);
  const list = [...new Set([...COMMON_SUBS, ...extra])].slice(0, 40);
  const found = [];
  for (let i = 0; i < list.length; i += 8) {
    const batch = list.slice(i, i + 8);
    const part = await Promise.all(batch.map(async (sub) => {
      const name = sub + '.' + domain;
      try {
        const r = await doh(name, 'A');
        const ips = r.answer.filter((a) => a.type === 1).map((a) => a.data);
        return ips.length ? { name, ips } : null;
      } catch { return null; }
    }));
    found.push(...part.filter(Boolean));
  }
  return { data: { domain, checked: list.length, found }, note: domain + '：发现 ' + found.length + ' 个子域（浏览器 DoH 枚举）' };
}

async function ipInfo(f) {
  const target = String(f.ip || f.host || '').trim();
  try {
    const url = target ? 'https://ipwho.is/' + encodeURIComponent(target) : 'https://ipwho.is/';
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const j = await res.json();
    if (j.success === false) throw new Error(j.message || '查询失败');
    return { data: { ip: j.ip, country: j.country, region: j.region, city: j.city, isp: j.connection?.isp, asn: j.connection?.asn, timezone: j.timezone?.id, latitude: j.latitude, longitude: j.longitude }, note: (j.ip || '') + ' · ' + [j.country, j.region, j.city].filter(Boolean).join(' ') };
  } catch (e) {
    return { data: { supported: false, reason: e.message }, note: 'IP 归属查询失败：' + e.message };
  }
}

function local() {
  const nav = navigator;
  return {
    data: {
      origin: '浏览器本机',
      userAgent: nav.userAgent,
      platform: nav.platform || nav.userAgentData?.platform || '',
      language: nav.language,
      languages: nav.languages,
      cores: nav.hardwareConcurrency || null,
      memoryGB: nav.deviceMemory || null,
      screen: (window.screen ? window.screen.width + 'x' + window.screen.height : ''),
      pixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      online: nav.onLine,
      connection: nav.connection ? { effectiveType: nav.connection.effectiveType, downlinkMbps: nav.connection.downlink, rttMs: nav.connection.rtt } : null,
    },
    note: '已读取本机浏览器环境（数据不出本机）',
  };
}

async function redirect(f) {
  const raw = targetOf(f);
  const url = /^https?:/i.test(raw) ? raw : 'https://' + stripHost(raw) + '/';
  const chain = [];
  let current = url;
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(current, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    } catch (e) {
      chain.push({ url: current, error: '请求失败（可能是跨域或网络不可达）' });
      break;
    }
    chain.push({ url: current, status: res.status, finalUrl: res.url, ms: Math.round(performance.now() - t0) });
    if (!res.url || res.url === current) break;
    current = res.url;
  }
  return { data: { start: url, chain, finalUrl: chain[chain.length - 1]?.finalUrl || url }, note: '共 ' + chain.length + ' 跳（浏览器跟随重定向）' };
}

const DIR_DICTS = {
  common: 'robots.txt,sitemap.xml,favicon.ico,login,admin,api,dashboard,register,upload,static,assets,index.php,.git/config,backup.zip,config.json',
  admin: 'admin,admin/login,administrator,manage,manager,console,login,wp-admin,wp-login.php,adminer.php,phpmyadmin',
  leak: '.git/config,.env,.svn/entries,backup.zip,www.zip,db.sql,config.php.bak,composer.json,package.json,.DS_Store',
};
async function dirs(f) {
  const raw = targetOf(f);
  const base = (/^https?:/i.test(raw) ? raw : 'https://' + stripHost(raw)).replace(/\/$/, '');
  const words = String(f.words || '').trim()
    ? String(f.words).split(/[,\s]+/).filter(Boolean).slice(0, 30)
    : (DIR_DICTS[f.preset] || DIR_DICTS.common).split(',');
  const rows = [];
  for (let i = 0; i < words.length; i += 5) {
    const batch = words.slice(i, i + 5);
    const part = await Promise.all(batch.map(async (w) => {
      const url = base + '/' + w;
      const t0 = performance.now();
      try {
        const res = await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) });
        return { path: '/' + w, ms: Math.round(performance.now() - t0), reachable: true, note: '有响应（浏览器看不到状态码）' };
      } catch {
        return { path: '/' + w, ms: Math.round(performance.now() - t0), reachable: false, note: '无响应' };
      }
    }));
    rows.push(...part);
  }
  return { data: { base, rows, limitation: '浏览器拿不到状态码，只能区分「有响应 / 无响应」' }, note: base + '：探测 ' + rows.length + ' 个路径（结果仅作参考）' };
}

async function methods(f) {
  const raw = targetOf(f);
  const url = /^https?:/i.test(raw) ? raw : 'https://' + stripHost(raw) + '/';
  const list = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];
  const rows = [];
  for (const m of list) {
    const t0 = performance.now();
    try {
      const res = await fetch(url, { method: m === 'GET' ? 'GET' : m, signal: AbortSignal.timeout(8000) });
      rows.push({ method: m, status: res.status, allow: res.headers.get('allow') || '', ms: Math.round(performance.now() - t0) });
    } catch (e) {
      rows.push({ method: m, error: e.name === 'TimeoutError' ? '超时' : '被 CORS 拦截 / 请求失败', ms: Math.round(performance.now() - t0) });
    }
  }
  return { data: { url, rows }, note: url + '：' + rows.filter((r) => r.status).length + ' 个方法拿到响应（其余被 CORS 限制）' };
}

const TOOLS = {
  dns, ping, portscan, timing, headers, rdap, subdomain, 'ip-info': ipInfo, local, redirect, dirs, methods, 'headers-gen': headersGen,
  traceroute: () => unsupported('路由追踪', '浏览器不能发送 TTL 递增的 UDP/ICMP 包'),
  tls: () => unsupported('TLS 证书检查', '浏览器不暴露对端证书内容'),
  banner: () => unsupported('服务 banner 抓取', '浏览器不能建立裸 TCP 连接'),
};

/** 执行一个网络工具（全部在浏览器本机发起） */
export async function runNetClient(action, fields) {
  const fn = TOOLS[action];
  if (!fn) throw new Error('未知网络工具：' + action);
  return fn(fields || {});
}

export const CLIENT_NET_ACTIONS = Object.keys(TOOLS);
