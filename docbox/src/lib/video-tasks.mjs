/**
 * 视频批量下载任务队列（后台自动跑）
 * - 用户贴多条 URL -> 建任务 -> 队列串行/并发解析 + 下载
 * - 状态：queued / resolving / downloading / done / failed / canceled
 * - 进度：HLS 用分片计数，直链用字节数；失败可重试，可取消、可删除
 * - 落库（video_tasks 表）以便重启后仍能看到历史；启动时把中断的任务标记为失败
 */
import crypto from 'node:crypto';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { TMP_DIR } from '../config.mjs';
import { saveOutputs } from './files.mjs';
import { resolveSource, download } from './video.mjs';
import { saveVideoTask, listVideoTasks, deleteVideoTask, clearVideoTasks } from './db.mjs';

const MAX_PARALLEL = Number(process.env.DOCBOX_VIDEO_PARALLEL) || 2;
const MAX_TASKS = 200;

const tasks = new Map();
const queue = [];
const controllers = new Map();
let running = 0;

function nowIso() { return new Date().toISOString(); }

function publicTask(t) {
  return {
    id: t.id,
    url: t.url,
    site: t.site || '',
    title: t.title || '',
    status: t.status,
    engine: t.engine || '',
    progress: Math.round(t.progress || 0),
    bytes: t.bytes || 0,
    total: t.total || 0,
    format: t.format || '',
    file: t.file || null,
    error: t.error || '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function listTasks() {
  return [...tasks.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(publicTask);
}

export function getTask(id) {
  const t = tasks.get(String(id));
  return t ? publicTask(t) : null;
}

function persist(t) {
  saveVideoTask({ id: t.id, url: t.url, title: t.title, status: t.status, engine: t.engine, progress: t.progress, file: t.file, error: t.error }).catch(() => {});
}

function touch(t, patch = {}) {
  if (!tasks.has(t.id)) return; // 任务已被删除：不要再写回数据库
  Object.assign(t, patch, { updatedAt: nowIso() });
  persist(t);
}

export function createTasks(urls, opts = {}) {
  const clean = [...new Set((urls || []).map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u)))];
  const created = [];
  for (const url of clean) {
    if (tasks.size >= MAX_TASKS) break;
    const t = {
      id: crypto.randomBytes(6).toString('hex'),
      url,
      site: '',
      title: '',
      status: 'queued',
      engine: '',
      progress: 0,
      bytes: 0,
      total: 0,
      format: String(opts.format || ''),
      file: null,
      error: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    tasks.set(t.id, t);
    queue.push(t.id);
    persist(t);
    created.push(publicTask(t));
  }
  pump();
  return created;
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const id = queue.shift();
    const t = tasks.get(id);
    if (!t || t.status === 'canceled') continue;
    running += 1;
    runTask(t).catch(() => {}).finally(() => { running -= 1; pump(); });
  }
}

async function runTask(t) {
  const ctrl = new AbortController();
  controllers.set(t.id, ctrl);
  const signal = ctrl.signal;
  const workdir = path.join(TMP_DIR, 'video-task-' + t.id);
  try {
    touch(t, { status: 'resolving', progress: 2, error: '' });
    const info = await resolveSource(t.url, { signal });
    if (signal.aborted) throw new Error('已取消');
    t.site = info.site || '';
    t.title = info.title || '';
    t.engine = info.engine || info.kind || '';
    if (!info.formats || !info.formats.length) {
      throw new Error(info.reason || '没有解析到可下载的视频流');
    }
    const picked = pickFormat(info, t.format);
    touch(t, { status: 'downloading', progress: 5, format: picked.url || picked.id || '' });

    await fsp.mkdir(workdir, { recursive: true });
    const result = await download({
      url: picked.type === 'hls' ? picked.url : t.url,
      format: picked.type === 'hls' ? t.format || '' : picked.id,
      manifest: picked.type === 'hls' ? picked.url : info.manifest,
      dir: workdir,
      signal,
      onProgress: (done, total) => {
        const pct = total ? Math.min(95, 5 + Math.round((done / total) * 90)) : 50;
        t.bytes = done;
        t.total = total || 0;
        t.progress = pct;
        t.updatedAt = nowIso();
      },
    });

    const buffer = await fsp.readFile(result.path);
    const name = (info.title ? info.title.slice(0, 80) + ' - ' : '') + (result.name || 'video.mp4');
    const [saved] = await saveOutputs([{ name: name.replace(/[\\/:*?"<>|]/g, '_'), buffer, kind: 'video/mp4' }]);
    touch(t, { status: 'done', progress: 100, bytes: buffer.length, total: buffer.length, engine: result.via, file: saved });
  } catch (err) {
    const canceled = signal.aborted || /取消/.test(String(err && err.message));
    touch(t, { status: canceled ? 'canceled' : 'failed', error: String((err && err.message) || '下载失败').slice(0, 400) });
  } finally {
    controllers.delete(t.id);
    if (!tasks.has(t.id)) { fsp.rm(workdir, { recursive: true, force: true }).catch(() => {}); return; }
    fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

function pickFormat(info, format) {
  const formats = info.formats || [];
  if (!formats.length) return { type: 'file', id: '', url: '' };
  if (format) {
    const hit = formats.find((f) => String(f.id) === String(format) || String(f.url) === String(format));
    if (hit) return hit;
  }
  const hls = formats.find((f) => f.type === 'hls');
  if (hls) return hls;
  const withHeight = formats.filter((f) => f.height).sort((a, b) => b.height - a.height)[0];
  return withHeight || formats[0];
}

export function cancelTask(id) {
  const t = tasks.get(String(id));
  if (!t) return false;
  if (t.status === 'done' || t.status === 'failed' || t.status === 'canceled') return false;
  const ctrl = controllers.get(t.id);
  if (ctrl) ctrl.abort();
  const idx = queue.indexOf(t.id);
  if (idx >= 0) queue.splice(idx, 1);
  touch(t, { status: 'canceled', error: '已取消' });
  return true;
}

export function retryTask(id) {
  const t = tasks.get(String(id));
  if (!t) return false;
  if (t.status === 'queued' || t.status === 'resolving' || t.status === 'downloading') return false;
  touch(t, { status: 'queued', progress: 0, error: '', file: t.file && t.status === 'done' ? t.file : null });
  queue.push(t.id);
  pump();
  return true;
}

export async function removeTask(id) {
  const t = tasks.get(String(id));
  if (!t) return false;
  if (t.status === 'downloading' || t.status === 'resolving') cancelTask(id);
  tasks.delete(t.id);
  await deleteVideoTask(t.id);
  return true;
}

export async function clearTasks() {
  for (const t of [...tasks.values()]) {
    if (t.status === 'downloading' || t.status === 'resolving') cancelTask(t.id);
  }
  tasks.clear();
  queue.length = 0;
  await clearVideoTasks();
  return true;
}

/** 启动时恢复历史任务：把上次没跑完的标记为失败（进程已重启） */
export async function restoreTasks() {
  const rows = await listVideoTasks(MAX_TASKS);
  for (const row of rows) {
    const t = {
      id: row.id,
      url: row.url,
      site: '',
      title: row.title || '',
      status: row.status,
      engine: row.engine || '',
      progress: row.progress || 0,
      bytes: Number(row.file_size) || 0,
      total: Number(row.file_size) || 0,
      format: '',
      file: row.file_url ? { name: row.file_name, url: row.file_url, size: Number(row.file_size) || 0 } : null,
      error: row.error || '',
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at || row.created_at).toISOString(),
    };
    if (t.status === 'queued' || t.status === 'resolving' || t.status === 'downloading') {
      t.status = 'failed';
      t.error = '服务重启，任务中断（可点重试）';
      persist(t);
    }
    tasks.set(t.id, t);
  }
  return tasks.size;
}
