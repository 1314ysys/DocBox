/**
 * Silero VAD 独立进程（隔离 onnxruntime-node 1.22，避免与 whisper 的 ORT 1.14 冲突）
 * 协议：stdin/stdout 逐行 JSON
 *   { id, op:'detect', audio:'<base64 float32>', threshold, minSpeechMs, minSilenceMs, paddingMs, maxGapMs }
 *   { id, op:'frames', session:'<key>', audio:'<base64 float32>' }  → { probs: [...] }
 *   { id, op:'close', session }
 */
import ort from 'onnxruntime-node';
import fs from 'node:fs';
import readline from 'node:readline';

const SR = 16000;
const FRAME = 512;
const modelPath = process.argv[2];
const session = await ort.InferenceSession.create(modelPath);
const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(SR)]), [1]);
const states = new Map();
process.stdout.write(JSON.stringify({ op: 'ready', inputs: session.inputNames }) + '\n');

function toF32(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

async function probs(id, audio) {
  let st = states.get(id) || new Float32Array(2 * 128);
  const out = [];
  const frames = Math.floor(audio.length / FRAME);
  for (let f = 0; f < frames; f++) {
    const frame = Float32Array.from(audio.subarray(f * FRAME, f * FRAME + FRAME));
    const feeds = {
      input: new ort.Tensor('float32', frame, [1, FRAME]),
      state: new ort.Tensor('float32', st, [2, 1, 128]),
      sr: srTensor,
    };
    const res = await session.run(feeds);
    st = res.stateN ? res.stateN.data : st;
    out.push(Number(res.output.data[0]));
  }
  states.set(id, st);
  return out;
}

function segmentsOf(p, { threshold = 0.5, minSpeechMs = 300, minSilenceMs = 600, paddingMs = 150, maxGapMs = 500 }) {
  const speech = [];
  let inSpeech = false;
  let start = 0;
  let last = 0;
  const silenceNeed = Math.ceil((minSilenceMs / 1000) * (SR / FRAME));
  for (let f = 0; f < p.length; f++) {
    if (p[f] >= threshold) {
      if (!inSpeech) { inSpeech = true; start = f; }
      last = f;
    } else if (inSpeech && f - last >= silenceNeed) {
      speech.push({ start, end: last + 1 });
      inSpeech = false;
    }
  }
  if (inSpeech) speech.push({ start, end: last + 1 });

  const minFrames = Math.ceil((minSpeechMs / 1000) * (SR / FRAME));
  const pad = Math.ceil((paddingMs / 1000) * (SR / FRAME));
  const gap = Math.ceil((maxGapMs / 1000) * (SR / FRAME));
  const merged = [];
  for (const seg of speech) {
    if (seg.end - seg.start < minFrames) continue;
    const a = Math.max(0, seg.start - pad);
    const b = seg.end + pad;
    const prev = merged[merged.length - 1];
    if (prev && a - prev.end <= gap) prev.end = Math.max(prev.end, b);
    else merged.push({ start: a, end: b });
  }
  return merged.map((s) => ({ start: Number(((s.start * FRAME) / SR).toFixed(3)), end: Number(((s.end * FRAME) / SR).toFixed(3)) }));
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  try {
    if (msg.op === 'detect') {
      const base = 'once-' + msg.id;
      const p = await probs(base, toF32(msg.audio));
      states.delete(base);
      const segments = segmentsOf(p, msg.opts || {});
      process.stdout.write(JSON.stringify({ id: msg.id, ok: true, frames: p.length, segments }) + '\n');
    } else if (msg.op === 'frames') {
      const p = await probs(msg.session || 'default', toF32(msg.audio));
      process.stdout.write(JSON.stringify({ id: msg.id, ok: true, probs: p }) + '\n');
    } else if (msg.op === 'close') {
      states.delete(msg.session);
      process.stdout.write(JSON.stringify({ id: msg.id, ok: true }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ id: msg.id, ok: false, error: 'unknown op' }) + '\n');
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({ id: msg.id, ok: false, error: String(err.message || err) }) + '\n');
  }
});
