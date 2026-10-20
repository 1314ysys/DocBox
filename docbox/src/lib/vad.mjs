/**
 * Silero VAD（语音活动检测）
 * - 模型：onnx-community/silero-vad（onnx/model.onnx，约 2MB），走 hf-mirror 下载，缓存 models/
 * - 推理放在独立子进程（vad-runtime/worker.mjs，自带 onnxruntime-node 1.22），
 *   与 whisper 用的 ORT 1.14 完全隔离，避免同进程双版本冲突导致 OOM/崩溃
 * - 对外：detectSpeech(audio) 一次切出人声段；createVadStream() 供实时转写逐帧判断
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { MODELS_DIR, DOCBOX_DIR } from '../config.mjs';

const MIRROR = 'https://hf-mirror.com';
const MODEL_REPO = 'onnx-community/silero-vad';
const MODEL_FILE = 'onnx/model.onnx';
export const SAMPLE_RATE_HZ = 16000;
export const FRAME_SAMPLES = 512;

let state = { phase: 'idle', percent: 0, error: null };
let worker = null;
let workerReady = null;
const pending = new Map();
let seq = 0;
let buffer = '';

function modelPath() {
  return path.join(MODELS_DIR, 'silero-vad-fp32.onnx');
}

async function downloadModel(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target) && fs.statSync(target).size > 100_000) return target;
  const url = MIRROR + '/' + MODEL_REPO + '/resolve/main/' + MODEL_FILE;
  state = { phase: 'downloading', percent: 0, error: null };
  const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error('VAD 模型下载失败：HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  const tmp = target + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (total) state.percent = Math.round((got / total) * 100);
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, target);
  return target;
}

export function vadState() {
  return { model: MODEL_REPO + '/' + MODEL_FILE, phase: state.phase, percent: state.percent, error: state.error, pid: worker ? worker.pid : null };
}

function callWorker(payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = 'r' + ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('VAD 推理超时')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
  });
}

export async function ensureVad() {
  if (workerReady) return workerReady;
  workerReady = (async () => {
    const file = await downloadModel(modelPath());
    state = { phase: 'loading', percent: 100, error: null };
    const script = path.join(DOCBOX_DIR, 'vad-runtime', 'worker.mjs');
    if (!fs.existsSync(script)) throw new Error('缺少 vad-runtime/worker.mjs（请运行 npm install）');
    worker = spawn(process.execPath, [script, file], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    worker.stderr.on('data', (b) => { state.error = String(b).slice(0, 200); });
    worker.stdout.on('data', (b) => {
      buffer += b.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.op === 'ready') { state = { phase: 'ready', percent: 100, error: null }; continue; }
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg);
        else p.reject(new Error(msg.error || 'VAD 推理失败'));
      }
    });
    worker.on('exit', (code) => {
      worker = null;
      workerReady = null;
      state = { phase: 'error', percent: 0, error: 'VAD 进程退出（code ' + code + '）' };
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('VAD 进程已退出')); }
      pending.clear();
    });
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        if (state.phase === 'ready') { clearInterval(tick); resolve(); }
        else if (state.phase === 'error' || Date.now() - started > 120000) { clearInterval(tick); reject(new Error(state.error || 'VAD 启动超时')); }
      }, 100);
    });
    return true;
  })().catch((err) => { workerReady = null; state = { phase: 'error', percent: 0, error: String(err.message || err) }; throw err; });
  return workerReady;
}

function toB64(f32) {
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');
}

/** 一次检测：返回人声区间（秒） */
export async function detectSpeech(audio, { threshold = 0.5, minSpeechMs = 300, minSilenceMs = 600, paddingMs = 150, maxGapMs = 500 } = {}) {
  await ensureVad();
  const msg = await callWorker({ op: 'detect', audio: toB64(audio), opts: { threshold, minSpeechMs, minSilenceMs, paddingMs, maxGapMs } });
  return msg.segments || [];
}

/** 流式 VAD：逐帧喂 512 采样，返回说话状态与「一句说完」 */
export async function createVadStream({ threshold = 0.5, minSilenceMs = 420 } = {}) {
  await ensureVad();
  const key = 's' + crypto.randomBytes(4).toString('hex');
  const silenceNeed = Math.max(1, Math.round((minSilenceMs / 1000) * (SAMPLE_RATE_HZ / FRAME_SAMPLES)));
  let inSpeech = false;
  let silenceFrames = 0;
  return {
    frameSamples: FRAME_SAMPLES,
    async push(frame) {
      const msg = await callWorker({ op: 'frames', session: key, audio: toB64(frame) });
      const prob = Number((msg.probs || [0])[0] || 0);
      if (prob >= threshold) {
        const started = !inSpeech;
        inSpeech = true;
        silenceFrames = 0;
        return { prob, speaking: true, started, ended: false };
      }
      if (inSpeech) silenceFrames += 1;
      const ended = inSpeech && silenceFrames >= silenceNeed;
      if (ended) { inSpeech = false; silenceFrames = 0; }
      return { prob, speaking: inSpeech, started: false, ended };
    },
    close() {
      if (worker) worker.stdin.write(JSON.stringify({ id: 'x' + ++seq, op: 'close', session: key }) + '\n');
    },
  };
}
