/**
 * RDAP 引导表（IANA bootstrap）：把「域名后缀 / IP 段」映射到权威 RDAP 服务器。
 * 数据随发行版打包在 src/data/rdap/，超过 30 天自动后台刷新 —— 查询路径完全不经过第三方代理。
 */
import fs from 'node:fs/promises';

const DIR = new URL('../data/rdap/', import.meta.url);
const TTL = 30 * 24 * 3600 * 1000;
const SOURCES = {
  dns: 'https://data.iana.org/rdap/dns.json',
  ipv4: 'https://data.iana.org/rdap/ipv4.json',
  ipv6: 'https://data.iana.org/rdap/ipv6.json',
};
const loaded = new Map();

async function load(kind) {
  if (loaded.has(kind)) return loaded.get(kind);
  let data = null;
  try { data = JSON.parse(await fs.readFile(new URL(kind + '.json', DIR), 'utf8')); } catch { data = null; }
  if (data) loaded.set(kind, data);
  return data;
}

/** 后台刷新（失败无感），启动时调一次即可 */
export async function refreshBootstrap() {
  const done = [];
  for (const [kind, url] of Object.entries(SOURCES)) {
    const file = new URL(kind + '.json', DIR);
    const st = await fs.stat(file).catch(() => null);
    if (st && Date.now() - st.mtimeMs < TTL) { done.push(kind + ':fresh'); continue; }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'DocBox/0.4.3 (+local)' } });
      if (!res.ok) { done.push(kind + ':HTTP ' + res.status); continue; }
      const text = await res.text();
      if (!text.includes('"services"')) { done.push(kind + ':内容异常'); continue; }
      await fs.writeFile(file, text, 'utf8');
      loaded.delete(kind);
      done.push(kind + ':updated');
    } catch (e) {
      done.push(kind + ':' + e.message);
    }
  }
  return done;
}

/** 域名 → 权威 RDAP 基址：取最长匹配的 TLD */
export async function baseForDomain(domain) {
  const table = await load('dns');
  if (!table?.services) return null;
  const labels = String(domain).toLowerCase().split('.').filter(Boolean);
  for (let i = 0; i < labels.length; i += 1) {
    const suffix = labels.slice(i).join('.');
    for (const [tlds, urls] of table.services) {
      if (tlds.includes(suffix)) return urls[0] || null;
    }
  }
  return null;
}

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function ipv6ToBigInt(ip) {
  // 展开 :: 简写后按 16 位一组累加
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':').filter(Boolean) : [];
  const t = tail !== undefined ? (tail ? tail.split(':').filter(Boolean) : []) : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  const groups = [...h, ...Array(Math.max(0, fill)).fill('0'), ...t];
  let n = 0n;
  for (const g of groups) n = (n << 16n) + BigInt(parseInt(g || '0', 16));
  return n;
}

/** IP → 权威 RDAP 基址：最长前缀匹配 */
export async function baseForIp(ip) {
  const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
  const table = await load(isV4 ? 'ipv4' : 'ipv6');
  if (!table?.services) return null;
  let best = null;
  let bestLen = -1;
  for (const [prefixes, urls] of table.services) {
    for (const prefix of prefixes) {
      const [net0, bitsStr] = prefix.split('/');
      const bits = Number(bitsStr);
      try {
        if (isV4) {
          const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
          if ((ipv4ToInt(ip) & mask) === (ipv4ToInt(net0) & mask) && bits > bestLen) { best = urls[0]; bestLen = bits; }
        } else {
          const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
          if ((ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(net0) & mask) && bits > bestLen) { best = urls[0]; bestLen = bits; }
        }
      } catch { /* 跳过解析不了的条目 */ }
    }
  }
  return best;
}

export async function bootstrapInfo() {
  const out = {};
  for (const kind of Object.keys(SOURCES)) {
    const st = await fs.stat(new URL(kind + '.json', DIR)).catch(() => null);
    const table = await load(kind);
    out[kind] = { services: table?.services?.length || 0, updatedAt: st ? new Date(st.mtimeMs).toISOString() : null };
  }
  return out;
}
