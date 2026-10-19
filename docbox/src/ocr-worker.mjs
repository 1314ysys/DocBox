import { createWorker } from 'tesseract.js';
import path from 'node:path';
import { DOCBOX_DIR, CACHE_DIR } from './config.mjs';

const LANG_PATH = path.resolve(DOCBOX_DIR, 'node_modules/@tesseract.js-data/chi_sim/4.0.0');

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

const worker = await createWorker('chi_sim', 1, {
  langPath: LANG_PATH,
  gzip: true,
  cachePath: path.join(CACHE_DIR, 'tesseract'),
  logger: () => {},
});

const results = [];
for (const file of paths) {
  const { data } = await worker.recognize(file, { rotateAuto: false }, { text: true, blocks: true });
  const raw = String(data.text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // tesseract 对中文常输出字间空格，这里合并中文字符之间的空白
  const text = raw.replace(/([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])\s+(?=[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef])/g, '$1');
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const value = (line.text || '').trim();
        if (value) lines.push({ text: value, confidence: Math.round(line.confidence || 0), bbox: line.bbox });
      }
    }
  }
  results.push({ file, text, confidence: Math.round(data.confidence || 0), chars: text.length, lines });
}

await worker.terminate();
process.stdout.write(JSON.stringify(results));