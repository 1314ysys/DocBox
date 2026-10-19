#!/usr/bin/env node
/**
 * DocBox 0.1.1 冒烟测试：覆盖 图片 / 证件照 / 原生 PDF / PDF 套件 / 音视频 / 网络安全 / 数据库历史。
 * 用法：node scripts/smoke.mjs [baseUrl]
 * 依赖 docbox/testdata 下的样例文件与本地已启动的 server.mjs。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const DATA = path.resolve(__dirname, '..', 'testdata');

const results = [];
const blob = async (file) => new Blob([await fs.readFile(path.join(DATA, file))]);

function record(name, ok, ms, note) {
  results.push({ name, ok, ms, note: String(note || '').slice(0, 100) });
  return ok;
}

async function post(name, route, { fields = {}, files = [], raw = null, field = 'files' } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  if (raw) fd.append(field, new Blob([raw.buffer]), raw.name);
  for (const f of files) fd.append(field, await blob(f), f);
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, { method: 'POST', body: fd, signal: AbortSignal.timeout(300000) });
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    let payload = {};
    if (ct.includes('json')) payload = JSON.parse(buf.toString('utf8'));
    const ok = res.ok && payload.ok !== false;
    record(name, ok, Date.now() - started, payload.note || payload.error || (buf.length + ' bytes'));
    return { ok, payload, buf, status: res.status };
  } catch (err) {
    record(name, false, Date.now() - started, String(err).slice(0, 150));
    return { ok: false, payload: {}, buf: Buffer.alloc(0), status: 0 };
  }
}

async function getJson(name, route) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, { signal: AbortSignal.timeout(30000) });
    const payload = await res.json();
    record(name, res.ok, Date.now() - started, res.ok ? 'ok' : payload.error || 'HTTP ' + res.status);
    return payload;
  } catch (err) {
    record(name, false, Date.now() - started, String(err).slice(0, 150));
    return {};
  }
}

async function fetchBuf(url) {
  const res = await fetch(BASE + url, { signal: AbortSignal.timeout(60000) });
  return { buffer: Buffer.from(await res.arrayBuffer()), name: decodeURIComponent(url.split('/').pop() || 'file.pdf') };
}

// ---------------- A. 基础 ----------------
const health = await getJson('健康检查', '/api/health');
record('版本号 0.1.1', health.version === '0.1.1', 0, health.version);
record('MySQL 已连接', Boolean(health.db?.available), 0, health.db?.available ? 'v' + health.db.version : '不可用');
const app = await getJson('应用清单', '/api/app');
const counts = Object.fromEntries(Object.entries(app.suites || {}).map(([k, v]) => [k, v.length]));
record('套件数量', counts.pdf === 23 && counts.media === 18 && counts.net === 16, 0, JSON.stringify(counts));
record('套件工具 57 / 合计 75', app.suiteToolCount === 57 && app.toolCount === 75, 0, app.suiteToolCount + ' / ' + app.toolCount);
const notFound = await fetch(BASE + '/api/not-exist');
record('未知接口 404', notFound.status === 404, 0, 'HTTP ' + notFound.status);
const indexRes = await fetch(BASE + '/');
record('首页可访问', indexRes.ok, 0, 'HTTP ' + indexRes.status);

// ---------------- B. 图片 / 证件照 ----------------
await post('图片压缩', '/api/image/process', { fields: { op: 'compress', quality: 70 }, files: ['sample1.jpg'] });
await post('图片转格式', '/api/image/process', { fields: { op: 'convert', format: 'webp', quality: 80 }, files: ['sample2.png'] });
await post('图片缩放', '/api/image/process', { fields: { op: 'resize', width: 320, fit: 'inside' }, files: ['sample1.jpg'] });
const idphoto = await post('证件照排版', '/api/idphoto/sheet', { field: 'photo', fields: { size: '1cun', copies: 4, format: 'pdf' }, files: ['sample1.jpg'] });
record('证件照出图', Boolean(idphoto.payload.files?.length), 0, idphoto.payload.files?.[0]?.name || '');

// ---------------- C. 原生 PDF ----------------
await post('PDF 合并', '/api/pdf/merge', { files: ['sample-a.pdf', 'sample-b.pdf'] });
await post('PDF 拆分', '/api/pdf/split', { field: 'file', fields: { mode: 'ranges', ranges: '1,2-3' }, files: ['sample-a.pdf'] });
await post('PDF 页面管理', '/api/pdf/pages', { field: 'file', fields: { deletePages: '4', rotate: 90, rotatePages: '1' }, files: ['sample-a.pdf'] });
await post('PDF 水印', '/api/pdf/watermark', { field: 'file', fields: { text: 'DocBox 冒烟', opacity: 0.2 }, files: ['sample-a.pdf'] });
await post('PDF 页码', '/api/pdf/numbers', { field: 'file', fields: { position: 'bottom-center' }, files: ['sample-a.pdf'] });
await post('PDF 压缩', '/api/pdf/compress', { field: 'file', fields: { level: 6 }, files: ['sample-a.pdf'] });
await post('图片合成 PDF', '/api/pdf/images-to-pdf', { fields: { pageSize: 'A4' }, files: ['sample1.jpg', 'sample2.png'] });

// ---------------- D. PDF 套件 ----------------
const S = '/api/suite/pdf/';
await post('旋转页面', S + 'rotate', { fields: { angle: 90 }, files: ['sample-a.pdf'] });
await post('删除页面', S + 'remove-pages', { fields: { pages: '2' }, files: ['sample-a.pdf'] });
await post('重排页面', S + 'rearrange', { fields: { order: '3,1,2' }, files: ['sample-a.pdf'] });
await post('裁剪', S + 'crop', { fields: { margin: 20 }, files: ['sample-a.pdf'] });
await post('缩放纸张', S + 'scale', { fields: { mode: 'paper', paper: 'a4' }, files: ['sample-a.pdf'] });
await post('多页合一', S + 'nup', { fields: { perSheet: 2 }, files: ['sample-a.pdf'] });
await post('小册子', S + 'booklet', { files: ['sample-a.pdf'] });
await post('按份拆分', S + 'split', { fields: { mode: 'every', every: 2 }, files: ['sample-a.pdf'] });
await post('页面叠加', S + 'overlay', { files: ['sample-a.pdf', 'sample-b.pdf'] });
await post('长页拼接', S + 'single-page', { files: ['sample-a.pdf'] });
await post('解压对象流', S + 'decompress', { files: ['sample-a.pdf'] });
await post('扁平化', S + 'flatten', { files: ['sample-a.pdf'] });
await post('移除空白页', S + 'remove-blanks', { files: ['sample-a.pdf'] });
await post('清理元数据', S + 'sanitize', { files: ['sample-a.pdf'] });
const enc = await post('AES-256 加密', S + 'encrypt', { fields: { userPassword: 'smoke1234', algorithm: 'AES-256' }, files: ['sample-a.pdf'] });
if (enc.payload.files?.[0]?.url) {
  const encFile = await fetchBuf(enc.payload.files[0].url);
  await post('解密还原', S + 'decrypt', { fields: { password: 'smoke1234' }, raw: encFile });
}
await post('读取元数据', S + 'metadata', { files: ['sample-a.pdf'] });
await post('写入元数据', S + 'set-metadata', { fields: { title: '冒烟标题', author: 'DocBox' }, files: ['sample-a.pdf'] });
await post('PDF 转图片', S + 'pdf2img', { fields: { format: 'png', dpi: 96, pages: '1' }, files: ['sample-a.pdf'] });
await post('提取文字', S + 'pdf2text', { files: ['sample-a.pdf'] });
await post('读取书签', S + 'bookmarks', { files: ['sample-a.pdf'] });
const withImg = await post('图片转 PDF（套件）', S + 'img2pdf', { fields: { pageSize: 'a4' }, files: ['sample1.jpg'] });
if (withImg.payload.files?.[0]?.url) {
  const pdfFile = await fetchBuf(withImg.payload.files[0].url);
  await post('提取嵌入图片', S + 'extract-images', { files: [], raw: pdfFile });
}

// ---------------- E. 音视频 ----------------
if (health.media?.ok) {
  const M = '/api/suite/media/';
  await post('探明媒体信息', M + 'probe', { files: ['sample-video.mp4'] });
  await post('视频压缩', M + 'compress', { fields: { resolution: '480', crf: 30 }, files: ['sample-video.mp4'] });
  await post('视频转码', M + 'convert', { fields: { format: 'mkv', crf: 26 }, files: ['sample-video.mp4'] });
  await post('视频截取', M + 'trim', { fields: { start: 0.5, end: 2 }, files: ['sample-video.mp4'] });
  await post('视频合并', M + 'merge', { fields: { format: 'mp4' }, files: ['sample-video.mp4', 'sample-video.mp4'] });
  await post('生成 GIF', M + 'gif', { fields: { fps: 10, width: 240, duration: 2 }, files: ['sample-video.mp4'] });
  await post('抽取画面', M + 'frame', { fields: { time: 1 }, files: ['sample-video.mp4'] });
  await post('提取音轨', M + 'extract-audio', { fields: { format: 'mp3' }, files: ['sample-video.mp4'] });
  await post('音频转码', M + 'audio-convert', { fields: { format: 'wav' }, files: ['sample-audio.mp3'] });
  await post('音量标准化', M + 'volume', { fields: { mode: 'normalize' }, files: ['sample-audio.mp3'] });
  await post('视频静音', M + 'mute', { files: ['sample-video.mp4'] });
  await post('视频旋转', M + 'rotate', { fields: { mode: 'cw90' }, files: ['sample-video.mp4'] });
  await post('视频水印', M + 'watermark', { fields: { text: 'DocBox', position: 'br', fontsize: 24 }, files: ['sample-video.mp4'] });
  await post('图片转视频', M + 'slideshow', { fields: { duration: 1, width: 480 }, files: ['sample1.jpg', 'sample2.png'] });
  await post('淡入淡出', M + 'fade', { fields: { type: 'both', duration: 0.5 }, files: ['sample-video.mp4'] });
  await post('清除元数据', M + 'strip-meta', { files: ['sample-video.mp4'] });
} else {
  record('音视频引擎', false, 0, 'FFmpeg 不可用，已跳过');
}

// ---------------- F. 网络安全 ----------------
const N = '/api/suite/net/';
const portscan = await post('端口扫描', N + 'portscan', { fields: { host: '127.0.0.1', mode: 'custom', ports: '3000,3306,80' } });
record('端口扫描命中本机服务', (portscan.payload.data?.open || []).some((p) => Number(p.port) === 3000), 0, JSON.stringify((portscan.payload.data?.open || []).map((p) => p.port)));
const headers = await post('安全响应头', N + 'headers', { fields: { url: BASE + '/' } });
record('安全头评级', Boolean(headers.payload.data?.grade), 0, headers.payload.data?.grade || '');
await post('连通性测试', N + 'ping', { fields: { host: '127.0.0.1', count: 2 } });
await post('路由追踪', N + 'traceroute', { fields: { host: '127.0.0.1', maxHops: 3 } });
await post('响应耗时', N + 'timing', { fields: { url: BASE + '/' } });
await post('跳转链路', N + 'redirect', { fields: { url: BASE + '/' } });
await post('HTTP 方法探测', N + 'methods', { fields: { url: BASE + '/' } });
await post('服务标识', N + 'banner', { fields: { host: '127.0.0.1', port: 3000 } });
await post('本机网络信息', N + 'local', {});
await post('安全配置生成', N + 'headers-gen', { fields: { server: 'nginx' } });
const dirs = await post('敏感目录探测', N + 'dirs', { fields: { url: BASE, preset: 'common' } });
record('目录探测返回', Array.isArray(dirs.payload.data?.hits) || Boolean(dirs.payload.data), 0, 'ok');
await post('IP 归属信息', N + 'ip-info', { fields: { ip: '127.0.0.1' } });

// ---------------- G. 数据库 / 历史 ----------------
const hist = await getJson('处理历史', '/api/history?limit=20');
record('历史已入库', (hist.jobs || []).length > 0, 0, (hist.jobs || []).length + ' 条');
const stats = hist.stats || {};
record('任务统计', Number(stats.total) > 0, 0, 'total=' + stats.total);
const tplSave = await fetch(BASE + '/api/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ templateId: 'smoke-tpl', name: 'smoke', spec: { a: 1 } }) });
record('模板写入', tplSave.ok, 0, 'HTTP ' + tplSave.status);
const tplList = await getJson('模板列表', '/api/templates');
record('模板读取', (tplList.templates || []).some((t) => t.templateId === 'smoke-tpl'), 0, String((tplList.templates || []).length));
const tplDel = await fetch(BASE + '/api/templates/smoke-tpl', { method: 'DELETE' });
record('模板删除', tplDel.ok, 0, 'HTTP ' + tplDel.status);
const reports = await getJson('安全报告', '/api/net/reports?limit=5');
record('安全报告入库', (reports.reports || []).length > 0, 0, String((reports.reports || []).length));
const setRes = await fetch(BASE + '/api/settings/smoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'ok' }) });
record('配置写入', setRes.ok, 0, 'HTTP ' + setRes.status);
const setGet = await getJson('配置读取', '/api/settings/smoke');
record('配置读取一致', setGet.value === 'ok', 0, String(setGet.value));

// ---------------- 汇总 ----------------
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name.padEnd(22, ' ') + String(r.ms + 'ms').padStart(7) + '   ' + r.note);
}
console.log('');
console.log('  ' + (results.length - failed.length) + ' / ' + results.length + ' 通过');
if (failed.length) {
  console.log('  失败：' + failed.map((f) => f.name).join('、'));
  process.exitCode = 1;
}
