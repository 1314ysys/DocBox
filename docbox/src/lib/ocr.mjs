import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(__dirname, '..', 'ocr-worker.mjs');
const MAX_PARALLEL = 1;

let active = 0;
const queue = [];

function run(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=1024', WORKER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } reject(new Error('OCR 识别超时')); }, 300000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('OCR 引擎异常：' + (err.trim().split('\n').pop() || ('exit ' + code))));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('OCR 输出解析失败')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  if (active >= MAX_PARALLEL || !queue.length) return;
  const { task, resolve, reject } = queue.shift();
  active += 1;
  run(task).then(resolve, reject).finally(() => { active -= 1; pump(); });
}

/** 识别一张或多张图片（路径数组），返回 [{text, confidence, lines, chars, barcodes}]
 * mode: 'both'（默认，中英文字 + 条码/二维码）| 'text' | 'barcode' */
export async function recognizeImages(paths, mode = 'both') {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) throw new Error('没有需要识别的图片');
  return schedule({ paths: list, mode });
}

export async function recognizeImage(imagePath, mode = 'both') {
  const [first] = await recognizeImages([imagePath], mode);
  return first;
}
