/**
 * 成品 / 临时文件保留策略与定时清理
 *
 * - 保留时长存在 settings 表（Redis 无关，重启不丢）：key = outputs_retention_hours
 * - 0 = 永久保存；默认 24 小时
 * - 清理范围：OUTPUT_DIR（成品，/files/... 指向这里）+ TMP_DIR 下的视频中间产物 + 过期任务记录
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import { OUTPUT_DIR, TMP_DIR } from '../config.mjs';
import { getSetting, setSetting, listVideoTasks, deleteVideoTask } from './db.mjs';

export const RETENTION_KEY = 'outputs_retention_hours';
export const DEFAULT_RETENTION_HOURS = 24;
const TEMP_PREFIXES = ['video-', 'video-task-', 'hls-', 'dash-', 'ytdlp-', 'direct-', 'browser-'];
const MAX_HOURS = 24 * 365;

let timer = null;
let lastSweep = null;

/** 读保留时长（小时）；0 表示永久保存 */
export async function getRetentionHours() {
  try {
    const raw = await getSetting(RETENTION_KEY);
    if (raw === null || raw === undefined || raw === '') return DEFAULT_RETENTION_HOURS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_HOURS;
    return Math.min(Math.round(n), MAX_HOURS);
  } catch {
    return DEFAULT_RETENTION_HOURS;
  }
}

export async function setRetentionHours(hours) {
  const raw = Number(hours);
  if (!Number.isFinite(raw) || raw < 0) throw new Error('保留时长必须是不小于 0 的整数（0 = 永久保存）');
  const n = Math.min(Math.round(raw), MAX_HOURS);
  await setSetting(RETENTION_KEY, String(n));
  return n;
}

/** 成品目录用量 */
export async function outputsUsage() {
  let files = 0;
  let bytes = 0;
  const subs = await fsp.readdir(OUTPUT_DIR).catch(() => []);
  for (const sub of subs) {
    const dir = path.join(OUTPUT_DIR, sub);
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isFile()) continue;
      const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
      if (!st) continue;
      files += 1;
      bytes += st.size;
    }
  }
  return { dir: OUTPUT_DIR, files, bytes };
}

function fileUrlToPath(url) {
  const m = String(url || '').match(/^\/files\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return path.join(OUTPUT_DIR, m[1], decodeURIComponent(m[2]));
}

/**
 * 扫一遍并清理
 * @param {{hours?:number, dryRun?:boolean}} opts hours 不传则读设置
 */
export async function sweepOutputs({ hours, dryRun = false } = {}) {
  const h = hours === undefined ? await getRetentionHours() : hours;
  const result = {
    hours: h,
    permanent: h === 0,
    scanned: 0,
    removedFiles: 0,
    removedBytes: 0,
    removedDirs: 0,
    removedTasks: 0,
    at: new Date().toISOString(),
  };
  lastSweep = result;
  if (h === 0) return result;

  const cutoff = Date.now() - h * 3600 * 1000;
  const removed = new Set();

  // 1) 成品目录
  const subs = await fsp.readdir(OUTPUT_DIR).catch(() => []);
  for (const sub of subs) {
    const dir = path.join(OUTPUT_DIR, sub);
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) continue;
    let kept = 0;
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (!e.isFile()) { kept += 1; continue; }
      const st = await fsp.stat(p).catch(() => null);
      if (!st) continue;
      result.scanned += 1;
      if (st.mtimeMs < cutoff) {
        if (!dryRun) await fsp.unlink(p).catch(() => {});
        result.removedFiles += 1;
        result.removedBytes += st.size;
        removed.add(p);
      } else {
        kept += 1;
      }
    }
    if (kept === 0 && !dryRun) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      result.removedDirs += 1;
    }
  }

  // 2) 临时目录里的视频中间产物
  const temps = await fsp.readdir(TMP_DIR).catch(() => []);
  for (const sub of temps) {
    if (!TEMP_PREFIXES.some((p) => sub.startsWith(p))) continue;
    const p = path.join(TMP_DIR, sub);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.mtimeMs < cutoff) {
      if (!dryRun) await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
      result.removedDirs += 1;
    }
  }

  // 3) 过期任务记录（成品已经清掉的、或创建时间早于保留期的已结束任务）
  try {
    const tasks = await listVideoTasks(500);
    for (const t of tasks) {
      const created = new Date(t.created_at).getTime();
      const done = ['done', 'failed', 'canceled'].includes(t.status);
      if (!done) continue;
      const p = fileUrlToPath(t.file_url);
      const fileGone = p ? removed.has(p) : false;
      if (fileGone || created < cutoff) {
        if (!dryRun) await deleteVideoTask(t.id);
        result.removedTasks += 1;
      }
    }
  } catch { /* 数据库不可用时跳过 */ }

  return result;
}

export function lastSweepInfo() {
  return lastSweep;
}

/** 每 30 分钟扫一次；启动后 90 秒先跑一次 */
export function startRetentionTimer() {
  if (timer) return timer;
  const run = () => {
    sweepOutputs().then((r) => {
      if (r.removedFiles || r.removedTasks) {
        console.log('Retention: 清理成品 ' + r.removedFiles + ' 个（' + Math.round(r.removedBytes / 1024) + 'KB）、任务 ' + r.removedTasks + ' 条（保留 ' + r.hours + ' 小时）');
      }
    }).catch(() => {});
  };
  setTimeout(run, 90 * 1000).unref?.();
  timer = setInterval(run, 30 * 60 * 1000);
  timer.unref?.();
  return timer;
}

export function stopRetentionTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}
