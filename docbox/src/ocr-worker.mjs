import { createWorker } from 'tesseract.js';
import { readBarcodes } from 'zxing-wasm/reader';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DOCBOX_DIR, CACHE_DIR } from './config.mjs';

const CHI = path.resolve(DOCBOX_DIR, 'node_modules/@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz');
const ENG = path.resolve(DOCBOX_DIR, 'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz');
const LANG_PATH = path.join(CACHE_DIR, 'tessdata');

// 中英混合识别：把两种语言包放同一个 langPath 下，tesseract 才能用 'chi_sim+eng'
function prepareLangs() {
  fs.mkdirSync(LANG_PATH, { recursive: true });
  for (const src of [CHI, ENG]) {
    const dst = path.join(LANG_PATH, path.basename(src));
    if (!fs.existsSync(dst) && fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
  const has = (f) => fs.existsSync(path.join(LANG_PATH, f));
  if (has('chi_sim.traineddata.gz') && has('eng.traineddata.gz')) return 'chi_sim+eng';
  return has('chi_sim.traineddata.gz') ? 'chi_sim' : 'eng';
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

const raw = await readStdin();
const job = JSON.parse(raw || '{}');
const paths = Array.isArray(job.paths) ? job.paths : [];
const mode = job.mode === 'barcode' || job.mode === 'text' ? job.mode : 'both';

/** 条码 / 二维码识别（Code128 / EAN-13 / QR / DataMatrix / PDF417 等） */
async function decodeBarcodes(file) {
  try {
    const buf = await fsp.readFile(file);
    const found = await readBarcodes(new Blob([buf]), { tryHarder: true, maxNumberOfSymbols: 8, tryRotate: true, tryInvert: true });
    return (found || []).filter((r) => r && r.isValid && r.text).map((r) => ({ format: r.format, text: r.text }));
  } catch {
    return [];
  }
}

const results = [];
let worker = null;
if (mode !== 'barcode') {
  const langs = prepareLangs();
  worker = await createWorker(langs, 1, {
    langPath: LANG_PATH,
    gzip: true,
    cachePath: path.join(CACHE_DIR, 'tesseract'),
    logger: () => {},
  });
}

for (const file of paths) {
  let text = '';
  let confidence = 0;
  let lines = [];
  if (worker) {
    const { data } = await worker.recognize(file, { rotateAuto: false }, { text: true, blocks: true });
    const rawText = String(data.text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    // tesseract 对中文常输出字间空格，这里合并中文字符之间的空白，英文单词间保留单空格
    text = rawText.replace(/([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])\s+(?=[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g, '$1');
    confidence = Math.round(data.confidence || 0);
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const value = (line.text || '').trim();
          if (value) lines.push({ text: value, confidence: Math.round(line.confidence || 0), bbox: line.bbox });
        }
      }
    }
  }
  const barcodes = mode === 'text' ? [] : await decodeBarcodes(file);
  results.push({ file, text, confidence, chars: text.length, lines, barcodes });
}

if (worker) await worker.terminate();
process.stdout.write(JSON.stringify(results));
