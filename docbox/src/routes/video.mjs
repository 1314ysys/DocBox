import express from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ah } from '../lib/async.mjs';
import { OUTPUT_DIR, TMP_DIR } from '../config.mjs';
import { probe, download, ytdlpStatus } from '../lib/video.mjs';
import { logJob } from '../lib/track.mjs';
import { sendResult } from '../lib/files.mjs';

export const videoRouter = express.Router();

videoRouter.get('/api/video/status', ah(async (_req, res) => {
  const ytdlp = await ytdlpStatus();
  res.json({ ok: true, ytdlp, note: ytdlp.available ? 'yt-dlp ' + ytdlp.version + ' 可用（支持 B 站/YouTube/爱奇艺/腾讯等）' : '未检测到 yt-dlp，仅支持 m3u8 / 直链解析' });
}));

videoRouter.post('/api/video/probe', ah(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '请填写完整的 http(s) 视频链接' });
  const info = await probe(url);
  logJob(req, { suite: 'video', tool: 'video-probe', note: info.title || info.site, status: 'ok' });
  res.json({ ok: true, data: info, note: info.title || info.site });
}));

videoRouter.post('/api/video/download', ah(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const format = String(req.body?.format || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '请填写完整的 http(s) 视频链接' });
  const dir = path.join(TMP_DIR, 'video-' + Date.now().toString(36));
  try {
    const result = await download({ url, format, dir });
    const buffer = await fsp.readFile(result.path);
    const name = (result.name || 'video.mp4').replace(/[\\/:*?"<>|]/g, '_');
    logJob(req, { suite: 'video', tool: 'video-download', note: url.slice(0, 120), outputs: 1, status: 'ok' });
    await sendResult(res, [{ name, buffer, kind: 'video/mp4' }], '下载完成（' + result.via + '）');
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}));
