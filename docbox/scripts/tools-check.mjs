/**
 * DocBox 全工具自检：遍历 /api/app 里的 57 个套件工具 + 33 个原生工具的接口，
 * 用 tmp/fixtures 下的夹具逐个真实调用，并下载产物校验大小。
 *
 * 用法：node scripts/tools-check.mjs [baseUrl] [--json out.json] [--only suite|native]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : (process.env.DOCBOX_BASE || 'http://127.0.0.1:3000');
const USER = process.env.DOCBOX_USER || 'root';
const PASS = process.env.DOCBOX_PASS || 'root';
const FIX = path.join(ROOT, 'tmp', 'fixtures');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : ''; })();
const JSON_OUT = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : ''; })();

// tmp 会在服务启动时被清理，夹具缺失就现场重新生成
async function ensureFixtures() {
  try { await fs.access(path.join(FIX, 'sample.pdf')); return; } catch { /* 需要生成 */ }
  console.log('夹具缺失，生成中 ...');
  await import('./tools-fixtures.mjs');
}

let cookie = '';
const results = [];
const t0 = Date.now();

async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error('登录失败：' + res.status);
  cookie = res.headers.get('set-cookie').split(';')[0];
}

async function getJson(route) {
  const res = await fetch(BASE + route, { headers: { cookie }, signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(route + ' -> ' + res.status + ' ' + JSON.stringify(body).slice(0, 160));
  return body;
}

async function fixture(name) { return path.join(FIX, name); }

function record(kind, id, name, ok, ms, note) {
  results.push({ kind, id, name, ok, ms, note });
  const flag = ok ? 'PASS' : 'FAIL';
  console.log('  ' + flag + '  ' + (kind + '/' + id).padEnd(30) + String(ms + 'ms').padEnd(8) + (note || '').slice(0, 110));
}

/** 发送 multipart 请求并校验返回：JSON 里的 files 逐个下载；二进制则看长度 */
async function callMultipart(route, files, fields, timeout = 120000) {
  const fd = new FormData();
  for (const f of files) {
    const buf = await fs.readFile(f.path);
    fd.append(f.field || 'files', new Blob([buf]), f.name || path.basename(f.path));
  }
  for (const [k, v] of Object.entries(fields || {})) if (v !== undefined && v !== null) fd.append(k, String(v));
  const started = Date.now();
  const res = await fetch(BASE + route, { method: 'POST', headers: { cookie }, body: fd, signal: AbortSignal.timeout(timeout) });
  const ms = Date.now() - started;
  const ct = String(res.headers.get('content-type') || '');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error('HTTP ' + res.status + ' ' + text.replace(/\s+/g, ' ').slice(0, 200)), { ms });
  }
  if (ct.includes('application/json')) {
    const body = await res.json();
    if (!body.ok) throw Object.assign(new Error('返回 ok=false ' + JSON.stringify(body).slice(0, 160)), { ms });
    let size = 0;
    for (const f of body.files || []) {
      if (!f.url) continue;
      const dl = await fetch(f.url.startsWith('http') ? f.url : BASE + f.url, { headers: { cookie }, signal: AbortSignal.timeout(60000) });
      if (!dl.ok) throw Object.assign(new Error('下载产物失败 ' + f.name + ' ' + dl.status), { ms });
      const buf = Buffer.from(await dl.arrayBuffer());
      if (!buf.length) throw Object.assign(new Error('产物为空 ' + f.name), { ms });
      size += buf.length;
    }
    return { ms, size, files: (body.files || []).length, note: body.note || '', json: body };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw Object.assign(new Error('响应为空'), { ms });
  return { ms, size: buf.length, files: 1, note: '' };
}

async function callJson(route, body, method = 'POST', timeout = 60000) {
  const started = Date.now();
  const res = await fetch(BASE + route, {
    method, headers: { cookie, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
  });
  const ms = Date.now() - started;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status + ' ' + JSON.stringify(json).slice(0, 180)), { ms });
  return { ms, json };
}

const ACCEPT_MAP = [
  [/pdf/, 'sample.pdf'],
  [/presentationml|pptx/, 'sample.pptx'],
  [/wordprocessingml|msword|docx/, 'sample.docx'],
  [/spreadsheetml|sheet|xlsx|csv/, 'sample.xlsx'],
  [/image\/png/, 'sample.png'],
  [/image\/webp/, 'sample.webp'],
  [/image\//, 'sample.png'],
  [/video\//, 'sample.mp4'],
  [/audio\/mpeg|mp3/, 'sample.mp3'],
  [/audio\//, 'sample.mp3'],
  [/markdown/, 'sample.md'],
  [/html/, 'sample.html'],
  [/csv/, 'sample.csv'],
  [/text\//, 'sample.txt'],
];

function fixtureFor(tool) {
  const accept = String(tool.accept || '');
  for (const [re, name] of ACCEPT_MAP) if (re.test(accept)) return name;
  return 'sample.pdf';
}

const FILE_OVERRIDES = {
  'pdf-overlay': ['sample.pdf', 'sample.pdf'],
  'pdf-img2pdf': ['sample.png', 'sample.jpg'],
  'media-watermark': ['sample.mp4', 'overlay.png'],
  'media-slideshow': ['sample.png', 'sample.jpg'],
};

const FIELD_OVERRIDES = {
  'pdf-encrypt': { userPassword: 'docbox2024' },
  'net-headers': { url: 'https://www.baidu.com' },
  'net-tls': { host: 'www.baidu.com', port: 443 },
  'net-rdap': { query: 'baidu.com' },
  'net-redirect': { url: 'http://www.baidu.com' },
  'net-methods': { url: 'https://www.baidu.com' },
  'net-subdomain': { domain: 'baidu.com' },
  'pdf-remove-pages': { pages: '2' },
  'pdf-rearrange': { order: '3,1,2' },
  'pdf-split': { mode: 'every', every: 1 },
  'pdf-extract-pages': { pages: '1-2' },
  'pdf-watermark': { text: 'DocBox 自检' },
  'pdf-overlay': { opacity: '0.5' },
  'pdf-crop': { autoCrop: 'false', x: 10, y: 10 },
  'media-trim': { start: '0', end: '2' },
  'media-screenshot': { time: '1' },
};

async function runSuiteTools(app) {
  console.log('\n## 套件工具（PDF / 音视频 / 网络）');
  for (const [suite, tools] of Object.entries(app.suites || {})) {
    for (const tool of tools) {
      const id = tool.id;
      const action = id.replace(new RegExp('^' + suite + '-'), '');
      const route = '/api/suite/' + suite + '/' + action;
      const overrides = FIELD_OVERRIDES[id] || {};
      const fields = {};
      for (const f of tool.fields || []) {
        let v = overrides[f.name] !== undefined ? overrides[f.name] : f.value;
        if (v === undefined || v === null) v = f.type === 'checkbox' ? '1' : '';
        fields[f.name] = v;
      }
      if (suite === 'net') {
        if (!fields.host) fields.host = '127.0.0.1';
        if (!fields.url) fields.url = BASE;
        if (!fields.domain) fields.domain = 'example.com';
        if (!fields.query) fields.query = 'docbox';
        if (!fields.ip) fields.ip = '127.0.0.1';
      }
      const name = tool.name || id;
      try {
        const files = [];
        if (suite !== 'net') {
          const names = FILE_OVERRIDES[id] || [fixtureFor(tool)];
          for (const n of names) files.push({ path: await fixture(n) });
          if (!names.length) files.push({ path: await fixture('sample.pdf') });
        }
        let out;
        try {
          out = await callMultipart(route, files, fields, suite === 'net' ? 60000 : 120000);
        } catch (err) {
          if (suite !== 'net') throw err;
          out = await callMultipart(route, files, fields, 60000);
        }
        record('suite', id, name, true, out.ms, (out.size ? Math.round(out.size / 1024) + 'KB' : '') + (out.note ? ' · ' + out.note : ''));
      } catch (err) {
        record('suite', id, name, false, err.ms || 0, String(err.message || err).slice(0, 160));
      }
    }
  }
}

async function runNativeTools() {
  console.log('\n## 原生工具（图片 / 证件照 / OCR / 文档 / 表格 / PDF / 预览 / 转写 / 元数据）');
  const case_ = async (id, name, fn) => {
    try { const out = await fn(); record('native', id, name, true, out.ms || 0, out.note || ''); }
    catch (err) { record('native', id, name, false, err.ms || 0, String(err.message || err).slice(0, 160)); }
  };
  const img = { path: await fixture('sample.png'), field: 'files' };

  await case_('image-process', '图片处理', async () => {
    const out = await callMultipart('/api/image/process', [img], { op: 'compress', quality: 82, format: 'jpg' });
    return { ms: out.ms, note: out.files + ' 个产物 ' + Math.round(out.size / 1024) + 'KB' };
  });
  await case_('image-info', '图片信息', async () => {
    const out = await callMultipart('/api/image/info', [img], {});
    return { ms: out.ms, note: 'json ' + JSON.stringify(out.json || '').slice(0, 40) };
  });
  await case_('image-watermark-template', '水印模板', async () => {
    const spec = JSON.stringify({ template: 'diagonal', text: 'DocBox 自检', opacity: 0.2, size: 6, color: '#3b82f6' });
    const out = await callMultipart('/api/image/watermark-template', [{ path: await fixture('sample.png'), field: 'files' }], { spec });
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('idphoto-presets', '证件照规格', async () => {
    const out = await callJson('/api/idphoto/presets', null, 'GET');
    return { ms: out.ms, note: (out.json.presets || []).length + ' 种规格' };
  });
  await case_('idphoto-sheet', '证件照排版', async () => {
    const out = await callMultipart('/api/idphoto/sheet', [{ path: await fixture('portrait.jpg'), field: 'photo' }], { size: '1cun', copies: 6, format: 'pdf', bg: '#ffffff' }, 60000);
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('ocr-image', '图片 OCR', async () => {
    const out = await callMultipart('/api/ocr/image', [{ path: await fixture('sample.png'), field: 'file' }], { detail: '1' }, 180000);
    return { ms: out.ms, note: '识别 ' + String(out.json?.text || '').length + ' 字' };
  });
  await case_('ocr-batch', '批量 OCR', async () => {
    const out = await callMultipart('/api/ocr/batch', [{ path: await fixture('sample.png'), field: 'files' }, { path: await fixture('sample.jpg'), field: 'files' }], {}, 180000);
    return { ms: out.ms, note: out.json ? (out.json.pages || []).length + ' 页' : '' };
  });

  const pdfFile = { path: await fixture('sample.pdf'), field: 'file' };
  await case_('pdf-merge', 'PDF 合并', async () => {
    const out = await callMultipart('/api/pdf/merge', [{ path: await fixture('sample.pdf'), field: 'files' }, { path: await fixture('sample.pdf'), field: 'files' }], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('pdf-split', 'PDF 拆分', async () => {
    const out = await callMultipart('/api/pdf/split', [pdfFile], { mode: 'every', every: 2 });
    return { ms: out.ms, note: out.files + ' 个产物' };
  });
  await case_('pdf-pages', 'PDF 页面编辑', async () => {
    const out = await callMultipart('/api/pdf/pages', [pdfFile], { deletePages: '2', order: '' });
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('pdf-watermark', 'PDF 水印', async () => {
    const out = await callMultipart('/api/pdf/watermark', [pdfFile], { text: 'DocBox 自检', sizePct: 8, opacity: 0.2 });
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('pdf-numbers', 'PDF 页码', async () => {
    const out = await callMultipart('/api/pdf/numbers', [pdfFile], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('pdf-compress', 'PDF 压缩', async () => {
    const out = await callMultipart('/api/pdf/compress', [pdfFile], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('pdf-images-to-pdf', '图片转 PDF', async () => {
    const out = await callMultipart('/api/pdf/images-to-pdf', [{ path: await fixture('sample.png'), field: 'files' }, { path: await fixture('sample.jpg'), field: 'files' }], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });

  const docx = { path: await fixture('sample.docx'), field: 'file' };
  await case_('doc-to-pdf', '文档转 PDF', async () => {
    const out = await callMultipart('/api/doc/to-pdf', [docx], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-pptx-to-pdf', 'PPTX 转 PDF', async () => {
    const out = await callMultipart('/api/doc/pptx-to-pdf', [{ path: await fixture('sample.pptx'), field: 'file' }], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-word-to-txt', 'Word 提取文本', async () => {
    const out = await callMultipart('/api/doc/word-to-txt', [docx], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-html-to-docx', 'HTML 转 Word', async () => {
    const out = await callMultipart('/api/doc/html-to-docx', [{ path: await fixture('sample.html'), field: 'file' }], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-md-to-html', 'Markdown 转 HTML', async () => {
    const out = await callMultipart('/api/doc/md-to-html', [{ path: await fixture('sample.md'), field: 'file' }], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-batch-convert', '批量文档转换', async () => {
    const out = await callMultipart('/api/doc/batch-convert', [{ path: await fixture('sample.md'), field: 'files' }, { path: await fixture('sample.html'), field: 'files' }], { target: 'pdf' });
    return { ms: out.ms, note: out.files + ' 个产物' };
  });
  await case_('doc-gongwen', '公文排版', async () => {
    const out = await callMultipart('/api/doc/gongwen', [{ path: await fixture('sample.md'), field: 'file' }], { title: '自检公文' });
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-md-table', 'Markdown 表格', async () => {
    const out = await callMultipart('/api/doc/md-table', [], { markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |' });
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-md-render', 'Markdown 渲染', async () => {
    const out = await callMultipart('/api/doc/md-render', [], { markdown: '# 标题\n\n正文' });
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-docx-to-html', 'Word 转 HTML', async () => {
    const out = await callMultipart('/api/doc/docx-to-html', [docx], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('doc-to-markdown', '文档转 Markdown', async () => {
    const out = await callMultipart('/api/doc/to-markdown', [docx], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });

  await case_('sheet-convert', '表格转换', async () => {
    const out = await callMultipart('/api/sheet/convert', [{ path: await fixture('sample.xlsx'), field: 'files' }], { target: 'csv' });
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });
  await case_('sheet-to-json', '表格转 JSON', async () => {
    const out = await callMultipart('/api/sheet/to-json', [{ path: await fixture('sample.xlsx'), field: 'file' }], {});
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB' };
  });

  await case_('preview-document', '文档预览', async () => {
    const out = await callMultipart('/api/preview/document', [{ path: await fixture('sample.png'), field: 'file' }], {}, 60000);
    return { ms: out.ms, note: Math.round(out.size / 1024) + 'KB ' + (out.note || '') };
  });

  await case_('stt-status', '转写状态', async () => {
    const out = await callJson('/api/stt/status', null, 'GET');
    return { ms: out.ms, note: 'backend=' + out.json.backend + ' sherpa=' + (out.json.sherpa || {}).phase };
  });
  await case_('stt-quick', '快速转写', async () => {
    const out = await callMultipart('/api/stt/quick', [{ path: await fixture('speech-test.wav'), field: 'file' }], { language: 'zh' }, 180000);
    return { ms: out.ms, note: String(out.json?.text || '').slice(0, 40) };
  });

  await case_('meta-health', '健康检查', async () => {
    const out = await callJson('/api/health', null, 'GET');
    return { ms: out.ms, note: 'v' + out.json.version + ' db=' + out.json.db };
  });
  await case_('meta-app', '工具清单', async () => {
    const out = await callJson('/api/app', null, 'GET');
    return { ms: out.ms, note: out.json.toolCount + ' 个工具' };
  });
  await case_('meta-watermark-templates', '水印模板清单', async () => {
    const out = await callJson('/api/watermark/templates', null, 'GET');
    return { ms: out.ms, note: (out.json.templates || []).length + ' 套' };
  });
  await case_('history-list', '历史记录', async () => {
    const out = await callJson('/api/history', null, 'GET');
    return { ms: out.ms, note: (out.json.items || out.json.jobs || []).length + ' 条' };
  });
  await case_('accounts-list', '账户列表', async () => {
    const out = await callJson('/api/accounts', null, 'GET');
    return { ms: out.ms, note: out.json.users.length + ' 个账户' };
  });
  await case_('templates-list', '模板列表', async () => {
    const out = await callJson('/api/templates', null, 'GET');
    return { ms: out.ms, note: (out.json.templates || []).length + ' 个' };
  });
  await case_('settings-get', '设置读取', async () => {
    const out = await callJson('/api/settings/ui.theme', null, 'GET');
    return { ms: out.ms, note: JSON.stringify(out.json).slice(0, 40) };
  });
}

await ensureFixtures();
await login();
const app = await getJson('/api/app');
console.log('DocBox ' + app.version + ' @ ' + BASE + ' | 工具总数 ' + app.toolCount + '（套件 ' + app.suiteToolCount + ' · 原生 ' + app.nativeToolCount + '）');
if (ONLY !== 'native') await runSuiteTools(app);
if (ONLY !== 'suite') await runNativeTools();

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log('\n结果：' + pass + ' / ' + results.length + ' 通过' + (fail ? '，' + fail + ' 失败' : '') + '，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (fail) {
  console.log('\n失败清单：');
  for (const r of results.filter((x) => !x.ok)) console.log('  - ' + r.kind + '/' + r.id + ' ' + r.name + ' :: ' + r.note);
}
if (JSON_OUT) {
  await fs.writeFile(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, pass, fail, results }, null, 2));
  console.log('明细已写入 ' + JSON_OUT);
}
process.exit(fail ? 1 : 0);
