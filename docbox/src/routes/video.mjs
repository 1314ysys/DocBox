import express from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ah } from '../lib/async.mjs';
import { TMP_DIR } from '../config.mjs';
import { resolveSource, download, ytdlpStatus, installYtdlp } from '../lib/video.mjs';
import { createTasks, listTasks, getTask, cancelTask, retryTask, removeTask, clearTasks } from '../lib/video-tasks.mjs';
import { logJob } from '../lib/track.mjs';
import { sendResult } from '../lib/files.mjs';

export const videoRouter = express.Router();

const isUrl = (u) => /^https?:\/\//i.test(String(u || '').trim());

videoRouter.post('/api/video/ytdlp/install', ah(async (_req, res) => {
  const r = await installYtdlp();
  res.json({ ok: r.ok, data: r, note: r.ok ? 'yt-dlp ' + (r.version || '') + ' 安装完成（' + r.via + '）' : '安装失败：' + ((r.steps || []).map((s) => s.via + ':' + s.detail).join(' | ') || '') });
}));

videoRouter.get('/api/video/status', ah(async (_req, res) => {
  const ytdlp = await ytdlpStatus(true);
  res.json({
    ok: true,
    ytdlp,
    note: ytdlp.available
      ? 'yt-dlp ' + ytdlp.version + ' 可用（B 站 / YouTube / 爱奇艺 / 腾讯 等）；m3u8 一律走内置 HLS 下载器'
      : '未检测到 yt-dlp，支持网页 m3u8 抓取 + m3u8 / 直链下载',
  });
}));

/** 解析：网页 -> m3u8 -> 码率列表 */
videoRouter.post('/api/video/probe', ah(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!isUrl(url)) return res.status(400).json({ error: '请填写完整的 http(s) 视频链接' });
  const info = await resolveSource(url);
  logJob(req, { suite: 'video', tool: 'video-probe', note: info.title || info.site, status: 'ok' });
  res.json({ ok: true, data: info, note: info.title || info.site || '解析完成' });
}));

/** 单条下载（同步返回文件） */
videoRouter.post('/api/video/download', ah(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const format = req.body?.format; // 可以是格式对象（含 dash/headers），也可以是 id 字符串
  const manifest = String(req.body?.manifest || '').trim();
  if (!isUrl(url)) return res.status(400).json({ error: '请填写完整的 http(s) 视频链接' });
  const dir = path.join(TMP_DIR, 'video-' + Date.now().toString(36));
  try {
    const result = await download({ url, format, manifest, dir });
    const buffer = await fsp.readFile(result.path);
    const name = (result.name || 'video.mp4').replace(/[\\/:*?"<>|]/g, '_');
    logJob(req, { suite: 'video', tool: 'video-download', note: url.slice(0, 120), outputs: 1, status: 'ok' });
    await sendResult(res, [{ name, buffer, kind: 'video/mp4' }], '下载完成（' + result.via + '）');
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}));

/** 批量：多条 URL 建任务，后台自动解析 + 下载 */
videoRouter.post('/api/video/batch', ah(async (req, res) => {
  const raw = req.body?.urls;
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\r\n\s]+/);
  const urls = list.map((u) => String(u).trim()).filter(isUrl);
  if (!urls.length) return res.status(400).json({ error: '请至少填写一条 http(s) 链接' });
  if (urls.length > 50) return res.status(400).json({ error: '一次最多 50 条，请分批添加' });
  const created = createTasks(urls, { format: req.body?.format });
  logJob(req, { suite: 'video', tool: 'video-batch', note: urls.length + ' 条', status: 'ok' });
  res.json({ ok: true, created, count: created.length, note: '已加入下载队列（' + created.length + ' 条），可离开页面后台继续' });
}));

videoRouter.get('/api/video/tasks', ah(async (_req, res) => {
  const tasks = listTasks();
  const stat = {
    total: tasks.length,
    queued: tasks.filter((t) => t.status === 'queued').length,
    running: tasks.filter((t) => t.status === 'resolving' || t.status === 'downloading').length,
    done: tasks.filter((t) => t.status === 'done').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  };
  res.json({ ok: true, tasks, stat });
}));

videoRouter.get('/api/video/tasks/:id', ah(async (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true, task: t });
}));

videoRouter.post('/api/video/tasks/:id/cancel', ah(async (req, res) => {
  res.json({ ok: true, canceled: cancelTask(req.params.id) });
}));

videoRouter.post('/api/video/tasks/:id/retry', ah(async (req, res) => {
  res.json({ ok: true, retried: retryTask(req.params.id) });
}));

videoRouter.delete('/api/video/tasks/:id', ah(async (req, res) => {
  res.json({ ok: true, removed: await removeTask(req.params.id) });
}));

videoRouter.delete('/api/video/tasks', ah(async (_req, res) => {
  await clearTasks();
  res.json({ ok: true });
}));
