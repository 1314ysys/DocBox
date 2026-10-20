/**
 * 本地音频前处理（Python 侧车，python/apm_service.py）
 * 优先 WebRTC APM（webrtc-audio-processing），装不上时 Python 侧自动退回 numpy DSP；
 * 对 Node 而言协议完全一致，只是 /api/apm/status 里 backend 不同。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DOCBOX_DIR, ROOT } from '../config.mjs';

const SCRIPT = path.join(ROOT, 'python', 'apm_service.py');
const VENV_PY = path.join(ROOT, 'python', '.venv', 'Scripts', 'python.exe');

let child = null;
let ready = null;
let backend = null;
let state = { phase: 'idle', error: null, backend: null };
let pending = new Map();
let seq = 0;
let outBuf = Buffer.alloc(0);

function pythonExe() {
  if (fs.existsSync(VENV_PY)) return VENV_PY;
  return process.env.DOCBOX_PYTHON || 'python';
}

export function apmStatus() {
  return {
    ...state,
    available: fs.existsSync(SCRIPT),
    python: pythonExe(),
    script: SCRIPT,
    installed: Boolean(child),
  };
}

function handleStdout(chunk) {
  outBuf = Buffer.concat([outBuf, chunk]);
  for (;;) {
    const nl = outBuf.indexOf(10);
    if (nl < 0) return;
    const header = outBuf.subarray(0, nl).toString('utf8');
    let meta;
    try { meta = JSON.parse(header); } catch { outBuf = outBuf.subarray(nl + 1); continue; }
    if (meta.backend && !backend) { backend = meta.backend; state = { phase: 'ready', error: null, backend }; continue; }
    const n = Number(meta.len || 0);
    if (outBuf.length < nl + 1 + n * 4) return;
    const body = outBuf.subarray(nl + 1, nl + 1 + n * 4);
    outBuf = outBuf.subarray(nl + 1 + n * 4);
    const p = pending.get(meta.id);
    pending.delete(meta.id);
    if (!p) continue;
    const copy = new Float32Array(n);
    for (let i = 0; i < n; i++) copy[i] = body.readFloatLE(i * 4);
    p.resolve(copy);
  }
}

export async function ensureApm() {
  if (ready) return ready;
  if (!fs.existsSync(SCRIPT)) throw new Error('缺少 python/apm_service.py');
  ready = new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    state = { phase: 'starting', error: null, backend: null };
    child = spawn(pythonExe(), ['-u', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', handleStdout);
    child.stderr.on('data', (b) => { state.error = String(b).slice(0, 300); });
    child.on('error', (err) => { state = { phase: 'error', error: err.message, backend: null }; fail(err); });
    child.on('exit', (code) => {
      child = null; ready = null;
      const err = state.error || ('APM 进程退出 code ' + code);
      state = { phase: 'error', error: err, backend };
      for (const [, p] of pending) { p.reject(new Error(err)); }
      pending.clear();
      fail(new Error(err));
    });
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (backend) { clearInterval(tick); settled = true; resolve(backend); }
      else if (Date.now() - t0 > 15000) { clearInterval(tick); fail(new Error(state.error || 'APM 启动超时')); }
    }, 100);
  }).catch((err) => { ready = null; throw err; });
  return ready;
}

/** 处理一块 16kHz 单声道音频（任意长度），返回同长度 Float32 */
export async function processAudio(f32) {
  if (!f32 || !f32.length) return f32;
  await ensureApm();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('APM 处理超时')); }, 10000);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    const header = Buffer.from(JSON.stringify({ len: f32.length, id }) + '\n', 'utf8');
    const body = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    child.stdin.write(Buffer.concat([header, body]));
  });
}

export function closeApm() {
  if (child) { try { child.stdin.end(); } catch { /* 忽略 */ } try { child.kill(); } catch { /* 忽略 */ } child = null; ready = null; }
}
