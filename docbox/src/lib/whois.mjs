/**
 * WHOIS 直连客户端（TCP 43），不经过任何第三方 Web 接口。
 * 服务器发现：先问 whois.iana.org（权威），结果按 TLD/RIR 缓存 30 天；再不行用内置兜底表。
 */
import net from 'node:net';
import { cacheGet, cachePut } from './netcache.mjs';

const FALLBACK = {
  com: 'whois.verisign-grs.com', net: 'whois.verisign-grs.com', org: 'whois.pir.org',
  info: 'whois.afilias.net', biz: 'whois.biz', io: 'whois.nic.io', co: 'whois.nic.co',
  cn: 'whois.cnnic.cn', top: 'whois.nic.top', xyz: 'whois.nic.xyz', me: 'whois.nic.me',
  tv: 'whois.nic.tv', cc: 'ccwhois.verisign-grs.com', uk: 'whois.nic.uk', de: 'whois.denic.de',
  jp: 'whois.jprs.jp', hk: 'whois.hkirc.hk', tw: 'whois.twnic.net.tw', ru: 'whois.tcinet.ru',
  arin: 'whois.arin.net', ripe: 'whois.ripe.net', apnic: 'whois.apnic.net',
  lacnic: 'whois.lacnic.net', afrinic: 'whois.afrinic.net',
};

function tcpQuery(server, q, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const socket = net.connect({ host: server, port: 43 });
    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err); else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    socket.setTimeout(timeout, () => finish(new Error(server + ' 响应超时（' + timeout + 'ms）')));
    socket.on('connect', () => socket.write(q + '\r\n'));
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => finish(null));
    socket.on('close', () => finish(null));
    socket.on('error', (e) => finish(e));
  });
}

function parseBlocks(text) {
  const map = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%') || line.startsWith('#') || line.startsWith('>>>')) continue;
    const m = line.match(/^([A-Za-z][A-Za-z0-9 /_-]{0,40}):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m[2].trim());
  }
  return map;
}

const pick = (map, ...keys) => {
  for (const k of keys) { const v = map.get(k); if (v && v.length) return v[0]; }
  return '';
};
const collect = (map, ...keys) => keys.flatMap((k) => map.get(k) || []);

/** 问 IANA 要权威 whois 服务器；结果缓存 30 天 */
export async function discoverServer(query, isIp = false) {
  const key = isIp ? 'ip:' + query : 'tld:' + String(query).split('.').pop().toLowerCase();
  const cached = await cacheGet('whois-server', key);
  if (cached) return cached;
  let server = '';
  try {
    const raw = await tcpQuery('whois.iana.org', isIp ? query : String(query).split('.').pop(), 10000);
    const map = parseBlocks(raw);
    server = (pick(map, 'refer', 'whois') || '').split(/\s+/)[0];
  } catch { /* 落到内置表 */ }
  if (!server) {
    const tld = String(query).split('.').pop().toLowerCase();
    server = FALLBACK[tld] || '';
  }
  if (server) await cachePut('whois-server', key, server, 30 * 24 * 3600 * 1000);
  return server;
}

export async function whoisLookup(query, { server } = {}) {
  const isIp = /^[0-9.]+$/.test(query) || query.includes(':');
  const host = server || await discoverServer(query, isIp);
  if (!host) throw new Error('没有找到该后缀的 WHOIS 服务器，可手动指定 server');
  const raw = await tcpQuery(host, query);
  if (!raw || raw.trim().length < 10) throw new Error(host + ' 返回内容为空');
  if (/no match|not found|no entries found|no data found|not allocated/i.test(raw.slice(0, 4000))) {
    throw new Error('未注册或没有公开注册信息（' + host + '）');
  }
  return { server: host, raw };
}

/** 把 whois 原始文本整理成和 RDAP 一致的结构 */
export function whoisToRecord(query, raw, server) {
  const map = parseBlocks(raw);
  const status = collect(map, 'domain status', 'status', 'statuses');
  const nameservers = collect(map, 'name server', 'nserver', 'nameserver', 'name servers', 'dns')
    .map((s) => s.split(/\s+/)[0].toLowerCase())
    .filter((s) => s.includes('.') || s.length > 2);
  const events = [];
  const created = pick(map, 'creation date', 'created', 'created on', 'registration time', 'domain registration date', 'registered on', 'registration date');
  const updated = pick(map, 'updated date', 'last updated', 'last-modified', 'changed', 'last modified');
  const expiry = pick(map, 'registry expiry date', 'expiry date', 'expiration date', 'expiration time', 'registrar registration expiration date', 'paid-till');
  if (created) events.push({ action: 'registration', date: created });
  if (updated) events.push({ action: 'last changed', date: updated });
  if (expiry) events.push({ action: 'expiration', date: expiry });
  const entities = [];
  const registrar = pick(map, 'registrar', 'sponsoring registrar', 'registrar name');
  if (registrar) entities.push({ handle: '', roles: ['registrar'], name: registrar });
  const holder = pick(map, 'registrant organization', 'registrant', 'registrant name', 'org', 'owner', 'netname');
  if (holder) entities.push({ handle: '', roles: ['registrant'], name: holder });
  return {
    query,
    source: 'whois',
    server,
    handle: pick(map, 'registry domain id', 'domain id', 'nic-hdl'),
    name: pick(map, 'domain name', 'domain', 'netname', 'inetnum') || query,
    status,
    events,
    nameservers: [...new Set(nameservers)],
    entities,
    raw: raw.slice(0, 20000),
  };
}
