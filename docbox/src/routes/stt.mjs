import express from 'express';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads } from '../lib/files.mjs';
import { submitJob, jobStatus, listJobs, removeJob, transcribeFile, sttInfo, audioInfo } from '../lib/stt.mjs';
import { openStream, endStream, closeStream, streamInfo } from '../lib/stt-stream.mjs';
import { apmStatus, processAudio } from '../lib/apm.mjs';
import { webrtcStatus } from '../lib/webrtc.mjs';

export const sttRouter = express.Router();

// 串行化推理，避免并发把 CPU 打满
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

sttRouter.get('/api/stt/status', (req, res) => res.json({ ok: true, ...sttInfo() }));

sttRouter.post('/api/stt/job', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择音频或视频文件' });
  const language = String(req.body?.language || 'zh');
  const info = await audioInfo(req.file.path);
  const job = await submitJob({ filePath: req.file.path, name: req.file.originalname, language, mode: 'offline' });
  res.json({ ok: true, id: job.id, name: job.name, durationSec: info.durationSec, note: '已加入后台转写队列' });
}));

sttRouter.get('/api/stt/jobs', ah(async (req, res) => {
  res.json({ ok: true, jobs: await listJobs() });
}));

sttRouter.get('/api/stt/job/:id', ah(async (req, res) => {
  const job = await jobStatus(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true, job });
}));

sttRouter.delete('/api/stt/job/:id', ah(async (req, res) => {
  await removeJob(req.params.id);
  res.json({ ok: true });
}));

sttRouter.post('/api/stt/quick', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择音频或视频文件' });
  const language = String(req.body?.language || 'zh');
  try {
    const info = await audioInfo(req.file.path);
    if (info.durationSec > 15 * 60) return res.status(400).json({ error: '在线转写最多 15 分钟，请改用离线后台转写' });
    const result = await serial(() => transcribeFile(req.file.path, { language }));
    res.json({ ok: true, text: result.text, segments: result.segments, durationSec: result.durationSec, note: '在线转写完成（' + result.durationSec.toFixed(1) + ' 秒音频）' });
  } finally {
    cleanupUploads(req);
  }
}));

sttRouter.post('/api/stt/chunk', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少音频片段' });
  const language = String(req.body?.language || 'zh');
  try {
    const result = await serial(() => transcribeFile(req.file.path, { language }));
    res.json({ ok: true, text: result.text });
  } catch (err) {
    res.json({ ok: false, text: '', error: String(err.message || err) });
  } finally {
    cleanupUploads(req);
  }
}));

/* ---------------- 实时流式转写 ---------------- */
sttRouter.post('/api/stt/stream', ah(async (req, res) => {
  const language = String(req.body?.language || 'zh');
  const apm = Boolean(req.body?.apm);
  const { id } = await openStream({ language, apm });
  res.json({ ok: true, id, ws: '/ws/stt?id=' + id, sampleRate: 16000 });
}));

sttRouter.get('/api/stt/streams', (req, res) => res.json({ ok: true, ...streamInfo() }));

sttRouter.post('/api/stt/stream/:id/stop', ah(async (req, res) => {
  const result = await endStream(req.params.id);
  if (!result) return res.status(404).json({ error: '实时会话不存在' });
  res.json({ ok: true, ...result });
}));

sttRouter.delete('/api/stt/stream/:id', (req, res) => {
  const closed = closeStream(req.params.id);
  res.json({ ok: true, closed });
});

/* ---------------- 本地音频前处理 / WebRTC ---------------- */
sttRouter.get('/api/apm/status', (req, res) => {
  res.json({ ok: true, apm: apmStatus(), webrtc: webrtcStatus() });
});

sttRouter.post('/api/apm/test', ah(async (req, res) => {
  const n = 3200;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / 16000) + (Math.random() - 0.5) * 0.05;
  const out = await processAudio(tone);
  res.json({ ok: true, inLen: n, outLen: out.length, backend: apmStatus().backend || null });
}));
