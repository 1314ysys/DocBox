/**
 * 语音转写（Whisper small 多语言，ONNX / transformers.js）
 * - 中英文识别，模型约 250MB（量化），首次使用从 hf-mirror 下载并缓存到 tmp/models
 * - 解码走内置 ffmpeg（任意音视频 → 16kHz 单声道 Float32）
 * - Silero VAD 先切出人声区间（跳过静音），再逐段识别；VAD 不可用时退化为 12s 窗口
 * - 可上报进度；离线任务进后台队列（MySQL stt_jobs）；流式会话见 stt-stream.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { FFMPEG, TMP_DIR } from '../config.mjs';
import { probe } from './media.mjs';
import { vadState } from './vad.mjs';
import { createSttJob, updateSttJob, getSttJob, listSttJobs, deleteSttJob, dbState } from './db.mjs';

export const MODEL = process.env.DOCBOX_STT_MODEL || 'Xenova/whisper-small';          // 文件/离线：精度优先
export const STREAM_MODEL = process.env.DOCBOX_STT_STREAM_MODEL || 'Xenova/whisper-base';  // 实时：延迟优先
const MODEL_MIRROR = 'https://hf-mirror.com';
const WINDOW_SEC = 12;   // transformers.js 在多语言 + 时间戳同时开启时返回空文本，改为按窗口切分自带时间
const MAX_SECONDS = 3 * 60 * 60;

const pipes = new Map();   // model -> Promise<pipeline>
let modelState = { phase: 'idle', percent: 0, error: null };

const memory = new Map();      // 数据库不可用时的降级存储
const queue = [];
let running = null;

function id16() {
  return crypto.randomBytes(8).toString('hex');
}

export function sttInfo() {
  return {
    model: MODEL,
    streamModel: STREAM_MODEL,
    vad: vadState(),
    modelsLoaded: [...pipes.keys()],
    mirror: MODEL_MIRROR,
    ready: pipes.has(MODEL),
    phase: modelState.phase,
    percent: modelState.percent,
    error: modelState.error,
    running: running ? { id: running.id, name: running.name, progress: running.progress } : null,
    queued: queue.length,
    db: dbState().available,
  };
}

async function ensurePipeline(model = MODEL) {
  if (!pipes.has(model)) {
    modelState = { phase: 'loading', percent: 0, error: null, model };
    const promise = import('@xenova/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = path.join(TMP_DIR, 'models');
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.remoteHost = MODEL_MIRROR;
      env.remotePathTemplate = '{model}/resolve/{revision}/';
      env.useBrowserCache = false;
      const pipe = await pipeline('automatic-speech-recognition', model, {
        quantized: true,
        progress_callback: (p) => {
          if (p && p.status === 'progress' && typeof p.progress === 'number') {
            modelState.percent = Math.round(p.progress);
          }
        },
      });
      modelState = { phase: 'ready', percent: 100, error: null, model };
      return pipe;
    }).catch((err) => {
      pipes.delete(model);
      modelState = { phase: 'error', percent: 0, error: String(err.message || err), model };
      throw err;
    });
    pipes.set(model, promise);
  }
  return pipes.get(model);
}

/** ffmpeg 解码为 16kHz 单声道 Float32 */
export async function decodeToFloat32(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { windowsHide: true });
    const chunks = [];
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('解码超时')); }, 10 * 60 * 1000);
    child.stdout.on('data', (b) => chunks.push(b));
    child.stderr.on('data', (b) => { err += b.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error('无法启动 ffmpeg：' + e.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('音频解码失败：' + err.slice(-200)));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
  });
}

/** 直接对 16kHz 单声道 Float32 音频做一次识别（流式/窗口共用） */
export async function transcribePcm(audio, { language = 'zh', model = MODEL } = {}) {
  const pipe = await ensurePipeline(model);
  const opts = {};
  if (language && language !== 'auto') opts.language = language;
  const out = await pipe(audio, opts);
  return cleanText(out.text);
}

/** 用 Silero VAD 找出人声区间；VAD 不可用或没检测到时退化为固定窗口 */
async function speechRanges(audio, durationSec) {
  let segs = [];
  try {
    const { detectSpeech } = await import('./vad.mjs');
    segs = await detectSpeech(audio, { minSilenceMs: 600, minSpeechMs: 300, paddingMs: 150 });
  } catch {
    segs = [];
  }
  if (!segs.length) {
    segs = [];
    for (let t = 0; t < durationSec; t += WINDOW_SEC) segs.push({ start: t, end: Math.min(durationSec, t + WINDOW_SEC) });
    return segs;
  }
  const out = [];
  for (const seg of segs) {
    let start = seg.start;
    while (start < seg.end - 0.25) {
      const end = Math.min(seg.end, start + WINDOW_SEC * 2.5);
      out.push({ start, end });
      start = end;
    }
  }
  return out;
}

function cleanText(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

/**
 * 转写一个文件
 * @returns {{text:string, segments:Array, durationSec:number, language:string}}
 */
export async function transcribeFile(filePath, { language = 'zh', onProgress } = {}) {
  const audio = await decodeToFloat32(filePath);
  const durationSec = audio.length / 16000;
  if (!durationSec) throw new Error('音频为空或无法解码');
  if (durationSec > MAX_SECONDS) throw new Error('音频过长（超过 3 小时），请先压缩或分割');

  const ranges = await speechRanges(audio, durationSec);
  const total = Math.max(1, ranges.length);
  const segments = [];
  let text = '';
  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    const slice = audio.subarray(Math.floor(start * 16000), Math.min(audio.length, Math.floor(end * 16000)));
    const partText = slice.length >= 800 ? await transcribePcm(slice, { language }) : '';
    if (partText) {
      segments.push({ start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: partText });
      text += (text ? ' ' : '') + partText;
    }
    if (onProgress) onProgress(Math.round(((i + 1) / total) * 100), partText);
  }
  return { text, segments, durationSec, language };
}

export function srtOf(segments) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmt = (sec) => {
    const s = Math.max(0, Number(sec) || 0);
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(Math.floor(s % 60)) + ',' + pad(Math.round((s % 1) * 1000), 3);
  };
  return segments.map((seg, i) => (i + 1) + '\n' + fmt(seg.start) + ' --> ' + fmt(seg.end) + '\n' + seg.text + '\n').join('\n');
}

/* ---------------- 后台任务队列 ---------------- */
async function persist(id, patch) {
  const mem = memory.get(id);
  if (mem) Object.assign(mem, patch);
  if (dbState().available) await updateSttJob(id, patch).catch(() => {});
}

async function runJob(job) {
  running = job;
  await persist(job.id, { status: 'running', progress: 3 });
  try {
    const result = await transcribeFile(job.filePath, {
      language: job.language,
      onProgress: (pct) => { job.progress = Math.max(3, Math.min(99, pct)); persist(job.id, { progress: job.progress }); },
    });
    await persist(job.id, {
      status: 'done', progress: 100,
      text: result.text, segments: JSON.stringify(result.segments),
      duration_ms: Math.round(result.durationSec * 1000), error: null,
    });
  } catch (err) {
    await persist(job.id, { status: 'error', progress: 0, error: String(err.message || err).slice(0, 480) });
  } finally {
    running = null;
    next();
  }
}

function next() {
  if (running || !queue.length) return;
  const job = queue.shift();
  runJob(job).catch(() => {});
}

export async function submitJob({ filePath, name, language = 'zh', mode = 'offline' }) {
  const id = id16();
  const job = { id, filePath, name, language, mode, progress: 0, createdAt: Date.now(), status: 'queued' };
  memory.set(id, job);
  if (dbState().available) {
    await createSttJob({ id, name, language, mode, filePath }).catch(() => {});
  }
  queue.push(job);
  next();
  return job;
}

export async function jobStatus(id) {
  const mem = memory.get(id);
  if (dbState().available) {
    const row = await getSttJob(id).catch(() => null);
    if (row) {
      return {
        id: row.id, name: row.name, status: row.status, progress: row.progress,
        language: row.language, mode: row.mode, durationMs: row.duration_ms,
        text: row.text || '', segments: row.segments ? safeJson(row.segments) : [],
        error: row.error || '', createdAt: row.created_at,
      };
    }
  }
  if (mem) {
    return {
      id: mem.id, name: mem.name, status: mem.status, progress: mem.progress,
      language: mem.language, mode: mem.mode, durationMs: mem.durationMs || null,
      text: mem.text || '', segments: mem.segments || [], error: mem.error || '', createdAt: new Date(mem.createdAt).toISOString(),
    };
  }
  return null;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return []; }
}

export async function listJobs() {
  if (dbState().available) {
    const rows = await listSttJobs(60).catch(() => []);
    if (rows.length) return rows.map((r) => ({ ...r, excerpt: r.excerpt || '' }));
  }
  return [...memory.values()].slice(-40).reverse().map((j) => ({
    id: j.id, name: j.name, status: j.status, progress: j.progress, language: j.language,
    mode: j.mode, duration_ms: j.durationMs || null, excerpt: (j.text || '').slice(0, 200),
    file_path: j.filePath, error: j.error || null, created_at: new Date(j.createdAt).toISOString(),
  }));
}

export async function removeJob(id) {
  const mem = memory.get(id);
  if (mem) { memory.delete(id); try { fs.unlinkSync(mem.filePath); } catch { /* 忽略 */ } }
  if (dbState().available) {
    const row = await getSttJob(id).catch(() => null);
    if (row?.file_path) { try { fs.unlinkSync(row.file_path); } catch { /* 忽略 */ } }
    await deleteSttJob(id).catch(() => {});
  }
  return true;
}

/** 探测时长（用于上传后提示） */
export async function audioInfo(filePath) {
  try {
    const info = await probe(filePath);
    return { durationSec: Number(info.format?.duration) || 0, size: Number(info.format?.size) || 0 };
  } catch {
    return { durationSec: 0, size: 0 };
  }
}
