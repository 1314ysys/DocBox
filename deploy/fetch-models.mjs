#!/usr/bin/env node
/**
 * 下载构建镜像需要的语音模型（约 420 MB）
 *
 *   node deploy/fetch-models.mjs                # 默认镜像站 hf-mirror.com
 *   node deploy/fetch-models.mjs --source hf     # 直连 huggingface.co（海外更快）
 *   node deploy/fetch-models.mjs --out D:\models  # 改输出目录
 *
 * 落到 deploy/models/ 下，Dockerfile 会 COPY 进镜像；已存在且体积正常的文件会跳过。
 * 不装 models 也能构建并运行 DocBox，只是「语音转写 / 实时转写」不可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SOURCE = argOf('--source', 'mirror');
const OUT = path.resolve(argOf('--out', path.join(HERE, 'models')));

const MIRRORS = SOURCE === 'hf' ? ['https://huggingface.co'] : ['https://hf-mirror.com', 'https://huggingface.co'];

const JOBS = [
  { repo: 'onnx-community/silero-vad', file: 'onnx/model.onnx', out: 'silero-vad-fp32.onnx', min: 1_000_000 },
  { repo: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', file: 'model.int8.onnx', out: 'sherpa/sense-voice/model.int8.onnx', min: 50_000_000 },
  { repo: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', file: 'tokens.txt', out: 'sherpa/sense-voice/tokens.txt', min: 1000 },
  { repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20', file: 'encoder-epoch-99-avg-1.int8.onnx', out: 'sherpa/streaming-zipformer-zh-en/encoder-epoch-99-avg-1.int8.onnx', min: 50_000_000 },
  { repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20', file: 'decoder-epoch-99-avg-1.onnx', out: 'sherpa/streaming-zipformer-zh-en/decoder-epoch-99-avg-1.onnx', min: 1_000_000 },
  { repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20', file: 'joiner-epoch-99-avg-1.int8.onnx', out: 'sherpa/streaming-zipformer-zh-en/joiner-epoch-99-avg-1.int8.onnx', min: 1_000_000 },
  { repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20', file: 'tokens.txt', out: 'sherpa/streaming-zipformer-zh-en/tokens.txt', min: 1000 },
];

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, tries = 4) {
  let lastErr = null;
  for (let i = 1; i <= tries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1800000) });
      if (res.ok) return res;
      // 429（镜像站限流）/ 5xx 值得等一会儿重试
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error('HTTP ' + res.status + ' ' + url);
        const wait = 5000 * i;
        console.log('  … HTTP ' + res.status + '，' + wait / 1000 + ' 秒后重试（' + i + '/' + tries + '）');
        await sleep(wait);
        continue;
      }
      throw new Error('HTTP ' + res.status + ' ' + url);
    } catch (e) {
      lastErr = e;
      if (i < tries) { console.log('  … ' + e.message + '，重试（' + i + '/' + tries + '）'); await sleep(3000 * i); }
    }
  }
  throw lastErr;
}

async function download(base, job) {
  const url = base + '/' + job.repo + '/resolve/main/' + job.file;
  const out = path.join(OUT, job.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = await fetchWithRetry(url);
  const total = Number(res.headers.get('content-length') || 0);
  const part = out + '.part';
  const stream = fs.createWriteStream(part);
  let got = 0;
  let lastPct = -1;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!stream.write(chunk)) await new Promise((r) => stream.once('drain', r));
    if (total) {
      const pct = Math.round((got / total) * 100);
      if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write('  ' + pct + '%  ' + mb(got) + '/' + mb(total) + '\r'); }
    }
  }
  await new Promise((r) => stream.end(r));
  fs.renameSync(part, out);
  console.log('  ✓ ' + job.out + '  ' + mb(fs.statSync(out).size) + '            ');
}

console.log('模型目录：' + OUT);
let skip = 0;
for (const job of JOBS) {
  const out = path.join(OUT, job.out);
  if (fs.existsSync(out) && fs.statSync(out).size >= job.min) { console.log('  · 已存在，跳过 ' + job.out); skip += 1; continue; }
  let done = false;
  let lastErr = null;
  for (const base of MIRRORS) {
    try { await download(base, job); done = true; break; } catch (e) { lastErr = e; console.log('  ! ' + base + ' 失败：' + e.message); }
  }
  if (!done) { console.error('\n模型下载失败（' + job.file + '）：' + (lastErr && lastErr.message)); process.exit(1); }
}
const total = JOBS.reduce((s, j) => s + (fs.existsSync(path.join(OUT, j.out)) ? fs.statSync(path.join(OUT, j.out)).size : 0), 0);
console.log('\n完成：' + JOBS.length + ' 个文件（跳过 ' + skip + '），合计 ' + mb(total));
console.log('接下来：podman build -t docbox:0.4.1 .   或   bash deploy/build-image.sh');
