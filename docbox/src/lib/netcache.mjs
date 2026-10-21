/**
 * 网络工具查询缓存：同一目标重复查询时直接走本地，不再打外网。
 * 有数据库就用 settings 表持久化（重启不丢），没有数据库就退化为进程内内存缓存。
 */
import { getSetting, setSetting } from './db.mjs';

const PREFIX = 'netcache:';
const MEM = new Map();
const MEM_MAX = 800;
const stats = { hit: 0, miss: 0, write: 0 };

function prune() {
  const now = Date.now();
  for (const [k, v] of MEM) if (v.exp <= now) MEM.delete(k);
  if (MEM.size > MEM_MAX) {
    for (const k of [...MEM.keys()].slice(0, MEM.size - MEM_MAX)) MEM.delete(k);
  }
}

export async function cacheGet(kind, key) {
  const id = PREFIX + kind + ':' + key;
  const hit = MEM.get(id);
  if (hit) {
    if (hit.exp > Date.now()) { stats.hit += 1; return hit.val; }
    MEM.delete(id);
  }
  try {
    const raw = await getSetting(id);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj?.exp > Date.now()) {
        MEM.set(id, obj);
        stats.hit += 1;
        return obj.val;
      }
    }
  } catch { /* 数据库不可用就走纯内存 */ }
  stats.miss += 1;
  return null;
}

export async function cachePut(kind, key, val, ttlMs) {
  const id = PREFIX + kind + ':' + key;
  const obj = { exp: Date.now() + ttlMs, val };
  MEM.set(id, obj);
  prune();
  stats.write += 1;
  try { await setSetting(id, JSON.stringify(obj)); } catch { /* 忽略：内存里还有 */ }
  return true;
}

export async function cacheDelete(kind, key) {
  const id = PREFIX + kind + ':' + key;
  MEM.delete(id);
  try { await setSetting(id, JSON.stringify({ exp: 0, val: null })); } catch { /* ignore */ }
  return true;
}

export function cacheStats() {
  return { ...stats, mem: MEM.size };
}
