#!/usr/bin/env node
/**
 * DocBox 冒烟测试：覆盖全部自研接口 + Stirling 代理。
 * 用法：node scripts/smoke.mjs [baseUrl]
 * 依赖 docbox/testdata 下的样例文件。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const DATA = path.resolve(__dirname, '..', 'testdata');

const results = [];
const blob = async (file, type) => new Blob([await fs.readFile(path.join(DATA, file))], { type });

async function post(name, route, { fields = {}, files = [] } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const f of files) {
    const b = await blob(f.path, f.type || 'application/octet-stream');
    fd.append(f.field, b, f.path);
  }
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, { method: 'POST', body: fd, signal: AbortSignal.timeout(240000) });
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    let payload = {};
    if (ct.includes('json')) payload = JSON.parse(buf.toString('utf8'));
    results.push({ name, ok: res.ok && (payload.ok !== false), status: res.status, ms: Date.now() - started, note: payload.note || payload.error || '', size: buf.length });
    return { res, payload, buf };
  } catch (err) {
    results.push({ name, ok: false, status: 0, ms: Date.now() - started, note: String(err).slice(0, 160) });
    return null;
  }
}

async function getJson(name, route) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, { signal: AbortSignal.timeout(20000) });
    const payload = await res.json();
    results.push({ name, ok: res.ok, status: res.status, ms: Date.now() - started, note: '' });
    return payload;
  } catch (err) {
    results.push({ name, ok: false, status: 0, ms: Date.now() - started, note: String(err).slice(0, 160) });
    return null;
  }
}

const pdf = (file, field = 'file') => ({ field, path: file, type: 'application/pdf' });

const health = await getJson('health', '/api/health');
const app = await getJson('app', '/api/app');
if (app) {
  const tplCount = (app.watermarkTemplates || []).length;
  results.push({ name: 'watermark templates == 7', ok: tplCount === 7, status: 200, ms: 0, note: tplCount + ' 套' });
}

for (const tpl of (app?.watermarkTemplates || []).map((t) => t.id)) {
  await post('watermark:' + tpl, '/api/image/watermark-template?preview=1', {
    files: [{ field: 'files', path: 'sample1.jpg', type: 'image/jpeg' }],
    fields: { spec: JSON.stringify({ template: tpl }) },
  });
}
await post('watermark:logo+saved', '/api/image/watermark-template?preview=1', {
  files: [{ field: 'files', path: 'sample1.jpg', type: 'image/jpeg' }, { field: 'logo', path: 'sample2.png', type: 'image/png' }],
  fields: { spec: JSON.stringify({ template: 'sales', location: '杭州市西湖区文三路 90 号', weather: '晴 24℃', customer: '某某科技有限公司', visit: '年度续约' }) },
});

const ocr = await post('ocr:image', '/api/ocr/image', { files: [{ field: 'file', path: 'sample2.png', type: 'image/png' }] });
if (ocr) {
  const text = ocr.payload.text || '';
  results.push({ name: 'ocr:text-nonempty', ok: text.length > 0, status: 200, ms: 0, note: text.slice(0, 30) });
}

await post('image:compress', '/api/image/process', {
  files: [{ field: 'files', path: 'sample1.jpg', type: 'image/jpeg' }],
  fields: { op: 'compress', quality: 60, maxWidth: 800 },
});
await post('image:convert', '/api/image/process', {
  files: [{ field: 'files', path: 'sample1.jpg', type: 'image/jpeg' }],
  fields: { op: 'convert', format: 'webp', quality: 80 },
});
await post('image:resize', '/api/image/process', {
  files: [{ field: 'files', path: 'sample1.jpg', type: 'image/jpeg' }],
  fields: { op: 'resize', width: 640 },
});

await post('pdf:merge', '/api/pdf/merge', { files: [pdf('sample-a.pdf', 'files'), pdf('sample-b.pdf', 'files')] });
const split = await post('pdf:split:ranges', '/api/pdf/split', { files: [pdf('sample-a.pdf')], fields: { mode: 'ranges', ranges: '1' } });
if (split) {
  const n = (split.payload.files || []).length;
  results.push({ name: 'pdf:split files>0', ok: n > 0, status: 200, ms: 0, note: n + ' 份' });
}
await post('pdf:split:each', '/api/pdf/split', { files: [pdf('sample-a.pdf')], fields: { mode: 'each' } });
await post('pdf:pages', '/api/pdf/pages', { files: [pdf('sample-a.pdf')], fields: { rotate: 90, order: '1' } });
await post('pdf:watermark', '/api/pdf/watermark', { files: [pdf('sample-a.pdf')], fields: { text: '内部资料 请勿外传', sizePct: 8, opacity: 0.18 } });
await post('pdf:numbers', '/api/pdf/numbers', { files: [pdf('sample-a.pdf')], fields: { position: 'bottom-center' } });
await post('pdf:compress', '/api/pdf/compress', { files: [pdf('sample-a.pdf')], fields: { level: 5 } });
await post('pdf:images-to-pdf', '/api/pdf/images-to-pdf', { files: [{ field: 'files', path: 'sample1.jpg', type: 'image/jpeg' }], fields: { pageSize: 'A4' } });
await post('idphoto:sheet', '/api/idphoto/sheet', { files: [{ field: 'photo', path: 'sample1.jpg', type: 'image/jpeg' }], fields: { size: '1cun', copies: 6 } });
await post('doc:to-pdf', '/api/doc/to-pdf', { files: [{ field: 'file', path: 'sample.md', type: 'text/markdown' }] });
await post('doc:docx-to-html', '/api/doc/docx-to-html', { files: [{ field: 'file', path: 'sample.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] });
await post('doc:to-markdown', '/api/doc/to-markdown', { files: [{ field: 'file', path: 'sample.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] });
await post('sheet:convert', '/api/sheet/convert', { files: [{ field: 'files', path: 'sample.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }], fields: { target: 'csv' } });
await post('sheet:to-json', '/api/sheet/to-json', { files: [{ field: 'file', path: 'sample.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] });

await post('stirling:rotate', '/api/stirling/stirling-rotate', { files: [pdf('sample-a.pdf', 'fileInput')], fields: { angle: 90 } });
await post('stirling:img2pdf', '/api/stirling/stirling-img2pdf', { files: [{ field: 'fileInput', path: 'sample1.jpg', type: 'image/jpeg' }], fields: { fitOption: 'fitDocumentToImage' } });

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  const flag = r.ok ? 'PASS' : 'FAIL';
  console.log(`[${flag}] ${r.name.padEnd(26)} ${String(r.status).padEnd(4)} ${String(r.ms + 'ms').padEnd(8)} ${r.note}`);
}
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过');
if (health) console.log('Stirling-PDF: ' + (health.stirling?.online ? 'ONLINE v' + health.stirling.version : 'OFFLINE'));
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join(', '));
  process.exitCode = 1;
}
