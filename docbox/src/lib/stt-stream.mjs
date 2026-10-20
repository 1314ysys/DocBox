/**
 * 实时流式转写会话
 * 客户端用 WebSocket 推 16kHz 单声道 Float32 PCM；服务端用 Silero VAD 判断说话状态，
 * 边说边出中间结果（partial），一句结束（静音 ≥450ms）出 final 并记录时间轴。
 */
import crypto from 'node:crypto';
import { createVadStream, FRAME_SAMPLES, SAMPLE_RATE_HZ } from './vad.mjs';
import { transcribePcm, STREAM_MODEL } from './stt.mjs';
import { createSherpaStream } from './asr-sherpa.mjs';
import { processAudio } from './apm.mjs';

const MAX_STREAMS = 4;
const PREROLL = 0.24;
const MAX_UTTERANCE = 20;
const PARTIAL_EVERY = 1.8;   // whisper-small 单次解码约 1.5-2s，中间结果太密只会排队
const MAX_BUFFER_SEC = 90;
const ENGINE = (process.env.DOCBOX_STT_STREAM_ENGINE || 'sherpa').toLowerCase();  // sherpa | whisper
const PARTIAL_MS = 180;

const streams = new Map();

export function streamInfo() {
  return { active: streams.size, max: MAX_STREAMS };
}

function emit(session, payload) {
  try { session.send?.(payload); } catch { /* 客户端已断开 */ }
}

function append(session, chunk) {
  const merged = new Float32Array(session.buf.length + chunk.length);
  merged.set(session.buf, 0);
  merged.set(chunk, session.buf.length);
  session.buf = merged;
}

function sliceByTime(session, fromSec, toSec) {
  const from = Math.max(session.bufStartSec, fromSec);
  const to = Math.min(session.bufStartSec + session.buf.length / SAMPLE_RATE_HZ, toSec);
  const a = Math.max(0, Math.floor((from - session.bufStartSec) * SAMPLE_RATE_HZ));
  const b = Math.min(session.buf.length, Math.floor((to - session.bufStartSec) * SAMPLE_RATE_HZ));
  return b > a ? session.buf.subarray(a, b) : null;
}

function trim(session, keepFromSec) {
  const keepFrom = Math.max(0, keepFromSec);
  const dropSamples = Math.max(0, Math.floor((keepFrom - session.bufStartSec) * SAMPLE_RATE_HZ));
  if (dropSamples <= 0 || dropSamples >= session.buf.length) return;
  session.buf = session.buf.slice(dropSamples);
  session.bufStartSec += dropSamples / SAMPLE_RATE_HZ;
  session.frameIdx = Math.max(0, session.frameIdx - dropSamples);
}

async function decodeWhisper(session, fromSec, toSec) {
  const slice = sliceByTime(session, fromSec, toSec);
  if (!slice || slice.length < 1600) return '';
  return transcribePcm(slice, { language: session.language, model: STREAM_MODEL });
}

async function partial(session) {
  if (session.busy) return;
  const to = session.bufStartSec + session.buf.length / SAMPLE_RATE_HZ;
  if (to - session.speechStart < 0.4) return;
  session.busy = true;
  session.lastDecodeAt = to;
  try {
    const text = session.asr ? session.asr.text : await decodeWhisper(session, session.speechStart, to);
    if (text) emit(session, { type: 'partial', text, start: Number(session.speechStart.toFixed(2)), end: Number(to.toFixed(2)) });
  } catch (err) {
    emit(session, { type: 'warn', message: String(err.message || err) });
  } finally {
    session.busy = false;
  }
}

async function finalize(session, { force = false } = {}) {
  if (session.speechStart < 0) return;
  const end = force ? session.bufStartSec + session.buf.length / SAMPLE_RATE_HZ : session.lastVoiceEnd + 0.12;
  const from = session.speechStart;
  session.busy = true;
  try {
    const text = session.asr ? session.asr.text.trim() : await decodeWhisper(session, from, end);
    if (text) {
      const seg = { start: Number(from.toFixed(2)), end: Number(end.toFixed(2)), text };
      session.segments.push(seg);
      session.text = (session.text ? session.text + ' ' : '') + text;
      emit(session, { type: 'final', text, start: seg.start, end: seg.end, full: session.text });
    }
  } catch (err) {
    emit(session, { type: 'warn', message: String(err.message || err) });
  } finally {
    session.busy = false;
    session.speechStart = -1;
    session.lastDecodeAt = end;
    if (session.asr) session.asr.reset();
    trim(session, end - PREROLL);
  }
}

/** 处理一段 PCM（按会话串行，避免并发改动缓冲区） */
export function pushStream(id, chunk) {
  const session = streams.get(id);
  if (!session || session.closed) return Promise.resolve();
  session.chain = (session.chain || Promise.resolve())
    .then(() => processChunk(session, chunk))
    .catch(() => {});
  return session.chain;
}

async function processChunk(session, chunk) {
  let pcm = chunk instanceof Float32Array ? chunk : new Float32Array(chunk.buffer || chunk, chunk.byteOffset || 0, Math.floor((chunk.byteLength || chunk.length) / 4));
  if (!pcm.length) return;
  if (session.apm && !session.apmBroken) {
    try {
      pcm = await processAudio(pcm);
    } catch (err) {
      session.apmBroken = true;
      emit(session, { type: 'warn', message: '本地降噪不可用，已自动关闭：' + String(err.message || err) });
    }
  }
  append(session, pcm);
  if (session.asr) {
    try {
      const changed = session.asr.accept(pcm);
      const now = Date.now();
      if (changed && session.speechStart >= 0 && now - session.lastPartialAt >= PARTIAL_MS) {
        session.lastPartialAt = now;
        const text = session.asr.text;
        if (text) emit(session, { type: 'partial', text: session.text ? session.text + ' ' + text : text, start: Number(session.speechStart.toFixed(2)), end: Number((session.bufStartSec + session.buf.length / SAMPLE_RATE_HZ).toFixed(2)) });
      }
    } catch (err) {
      emit(session, { type: 'warn', message: String(err.message || err) });
    }
  }
  const endSec = session.bufStartSec + session.buf.length / SAMPLE_RATE_HZ;
  if (endSec - session.bufStartSec > MAX_BUFFER_SEC && session.speechStart >= 0) await finalize(session, { force: true });

  while (session.frameIdx + FRAME_SAMPLES <= session.buf.length) {
    const frame = session.buf.subarray(session.frameIdx, session.frameIdx + FRAME_SAMPLES);
    const frameStart = session.bufStartSec + session.frameIdx / SAMPLE_RATE_HZ;
    const r = await session.vad.push(frame);
    session.frameIdx += FRAME_SAMPLES;

    if (r.started) {
      session.speechStart = Math.max(session.bufStartSec, frameStart - PREROLL);
      session.lastVoiceEnd = frameStart + FRAME_SAMPLES / SAMPLE_RATE_HZ;
      session.lastDecodeAt = session.speechStart;
      emit(session, { type: 'vad', speaking: true, t: Number(frameStart.toFixed(2)) });
    }
    if (r.speaking) session.lastVoiceEnd = frameStart + FRAME_SAMPLES / SAMPLE_RATE_HZ;
    if (r.ended) {
      await finalize(session);
      emit(session, { type: 'vad', speaking: false, t: Number(frameStart.toFixed(2)) });
      continue;
    }
    if (session.speechStart >= 0) {
      if (frameStart - session.speechStart > MAX_UTTERANCE) await finalize(session, { force: true });
      else if (!session.asr && frameStart - session.lastDecodeAt >= PARTIAL_EVERY) {
        const backlogSec = (session.buf.length - session.frameIdx) / SAMPLE_RATE_HZ;
        if (backlogSec < 0.8) await partial(session);
      }
    }
  }
}

export async function openStream({ language = 'zh', apm = false } = {}) {
  if (streams.size >= MAX_STREAMS) throw new Error('已达最大实时转写会话数（' + MAX_STREAMS + '），请先关闭其它会话');
  const id = crypto.randomBytes(8).toString('hex');
  let asr = null;
  if (ENGINE === 'sherpa') {
    try { asr = await createSherpaStream(); }
    catch (err) { asr = null; }
  }
  const session = {
    id, language, send: null, closed: false, asr, lastPartialAt: 0,
    vad: await createVadStream({ threshold: 0.5, minSilenceMs: 450 }),
    apm: Boolean(apm), apmBroken: false,
    buf: new Float32Array(0), bufStartSec: 0, frameIdx: 0,
    speechStart: -1, lastVoiceEnd: 0, lastDecodeAt: 0,
    busy: false, text: '', segments: [], createdAt: Date.now(),
  };
  streams.set(id, session);
  return { id, session };
}

export function attachStream(id, send) {
  const session = streams.get(id);
  if (!session) throw new Error('实时会话不存在');
  session.send = send;
  emit(session, { type: 'ready', id, language: session.language, sampleRate: SAMPLE_RATE_HZ });
  return session;
}

export async function endStream(id) {
  const session = streams.get(id);
  if (!session) return null;
  if (session.chain) await session.chain.catch(() => {});
  await finalize(session, { force: true });
  emit(session, { type: 'done', text: session.text, segments: session.segments });
  return { text: session.text, segments: session.segments };
}

export function closeStream(id) {
  const session = streams.get(id);
  if (!session) return false;
  session.closed = true;
  streams.delete(id);
  return true;
}
