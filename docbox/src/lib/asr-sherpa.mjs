/**
 * sherpa-onnx 语音识别后端（SenseVoice 离线 + 流式 Zipformer）
 *
 * 为什么换：
 * - whisper-small 单次解码 ~5.8s（30s 窗口 + CPU INT8），7.78s 音频要 20s，做不了实时；
 * - SenseVoiceSmall（阿里，int8）同一段 0.92s（8.5x 实时），自带标点，中英混说更稳；
 * - 流式 Zipformer（int8，中英双语）逐帧出字，0.3s 就有 partial，总耗时 0.88s。
 * 两者都是量化 ONNX + CPU，无 GPU 依赖；模型放 tmp/models/sherpa，走 hf-mirror 下载。
 */
import fs from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from '../config.mjs';

const MIRROR = 'https://hf-mirror.com';
const ROOT = path.join(TMP_DIR, 'models', 'sherpa');
const SENSE = { repo: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', dir: path.join(ROOT, 'sense-voice'), files: ['model.int8.onnx', 'tokens.txt'] };
const STREAM = {
  repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
  dir: path.join(ROOT, 'streaming-zipformer-zh-en'),
  files: ['encoder-epoch-99-avg-1.int8.onnx', 'decoder-epoch-99-avg-1.onnx', 'joiner-epoch-99-avg-1.int8.onnx', 'tokens.txt'],
};

let status = { phase: 'idle', percent: 0, error: null };
let offline = null;
let online = null;
let loading = null;

function missing(dir, files) {
  return files.filter((f) => !fs.existsSync(path.join(dir, f)) || fs.statSync(path.join(dir, f)).size < 1000);
}

export function sherpaStatus() {
  return {
    phase: status.phase,
    percent: status.percent,
    error: status.error,
    ready: Boolean(offline && online),
    roots: { senseVoice: SENSE.dir, streaming: STREAM.dir },
  };
}

async function fetchFile(repo, file, out, onProgress) {
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) return;
  const res = await fetch(MIRROR + '/' + repo + '/resolve/main/' + file, { signal: AbortSignal.timeout(1800000) });
  if (!res.ok) throw new Error('模型下载失败：' + file + ' HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.part';
  const stream = fs.createWriteStream(tmp);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (total && onProgress) onProgress(got / total);
    if (!stream.write(chunk)) await new Promise((r) => stream.once('drain', r));
  }
  await new Promise((r) => stream.end(r));
  fs.renameSync(tmp, out);
}

/** 下载缺失模型（SenseVoice + 流式 Zipformer） */
export async function ensureSherpaModels() {
  const all = [...missing(SENSE.dir, SENSE.files).map((f) => [SENSE, f]), ...missing(STREAM.dir, STREAM.files).map((f) => [STREAM, f])];
  if (!all.length) return;
  status = { phase: 'downloading', percent: 0, error: null };
  let i = 0;
  for (const [cfg, file] of all) {
    i += 1;
    await fetchFile(cfg.repo, file, path.join(cfg.dir, file), (p) => {
      status.percent = Math.round(((i - 1 + p) / all.length) * 100);
    });
    status.percent = Math.round((i / all.length) * 100);
  }
  status = { phase: 'idle', percent: 100, error: null };
}

function loadOffline(sherpa) {
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: path.join(SENSE.dir, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 },
      tokens: path.join(SENSE.dir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  });
}

function loadOnline(sherpa) {
  const p = STREAM.dir;
  return new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(p, 'encoder-epoch-99-avg-1.int8.onnx'),
        decoder: path.join(p, 'decoder-epoch-99-avg-1.onnx'),
        joiner: path.join(p, 'joiner-epoch-99-avg-1.int8.onnx'),
      },
      tokens: path.join(p, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  });
}

/** 懒加载两个识别器（首次会下载模型） */
export async function ensureSherpa() {
  if (offline && online) return { offline, online };
  if (loading) return loading;
  loading = (async () => {
    status = { phase: 'loading', percent: 0, error: null };
    await ensureSherpaModels();
    const mod = await import('sherpa-onnx-node');
    const sherpa = mod.default || mod;
    offline = loadOffline(sherpa);
    online = loadOnline(sherpa);
    status = { phase: 'ready', percent: 100, error: null };
    return { offline, online };
  })().catch((err) => {
    loading = null;
    status = { phase: 'error', percent: 0, error: String(err.message || err) };
    throw err;
  });
  return loading;
}

/** 离线识别一段 16kHz 单声道 Float32（SenseVoice，含标点） */
export async function senseVoiceRecognize(audio, { language = 'auto' } = {}) {
  const { offline: rec } = await ensureSherpa();
  const stream = rec.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples: audio });
  rec.decode(stream);
  const res = rec.getResult(stream);
  return String((res && res.text) || '').trim();
}

/** 流式识别器：逐块喂音频，随时取当前文本；遇到端点即一句结束 */
export async function createSherpaStream() {
  const { online: rec } = await ensureSherpa();
  const stream = rec.createStream();
  let text = '';
  return {
    accept(samples, sampleRate = 16000) {
      stream.acceptWaveform({ sampleRate, samples });
      while (rec.isReady(stream)) rec.decode(stream);
      const res = rec.getResult(stream);
      const next = String((res && res.text) || '');
      const changed = next !== text;
      text = next;
      return changed;
    },
    get text() { return text; },
    /** 端点（长静音 / 超长句）自动断句 */
    isEndpoint() { try { return rec.isEndpoint(stream); } catch { return false; } },
    reset() {
      try { rec.reset(stream); } catch { /* 忽略 */ }
      text = '';
    },
  };
}
