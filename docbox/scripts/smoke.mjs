#!/usr/bin/env node
/**
 * DocBox 0.1.2 冒烟测试：登录 / 角色 / 模块权限 + 图片 / 证件照 / PDF / 音视频 / 网络安全 / 数据库。
 * 用法：node scripts/smoke.mjs [baseUrl]
 * 依赖 docbox/testdata 下的样例文件与本地已启动的 server.mjs（默认账户 root/root）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const DATA = path.resolve(__dirname, '..', 'testdata');

const results = [];
let COOKIE = '';

function rememberCookie(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (!list.length) return;
  const pairs = list.map((c) => c.split(';')[0]).filter(Boolean);
  if (pairs.length) COOKIE = pairs.join('; ');
}

function authHeaders(extra = {}) {
  return COOKIE ? { ...extra, cookie: COOKIE } : extra;
}

function record(name, ok, ms, note) {
  results.push({ name, ok, ms, note: String(note || '').slice(0, 100) });
  return ok;
}

async function request(name, method, route, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + route, {
      method,
      ...init,
      headers: authHeaders(init.headers || {}),
      signal: AbortSignal.timeout(300000),
    });
    rememberCookie(res);
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    let payload = {};
    if (ct.includes('json')) payload = JSON.parse(buf.toString('utf8'));
    record(name, res.ok && payload.ok !== false, Date.now() - started, payload.note || payload.error || (buf.length + ' bytes'));
    return { ok: res.ok && payload.ok !== false, payload, buf, status: res.status };
  } catch (err) {
    record(name, false, Date.now() - started, String(err).slice(0, 150));
    return { ok: false, payload: {}, buf: Buffer.alloc(0), status: 0 };
  }
}

const blob = async (file) => new Blob([await fs.readFile(path.join(DATA, file))]);

async function post(name, route, { fields = {}, files = [], raw = null, field = 'files', expectStatus = null } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  if (raw) fd.append(field, new Blob([raw.buffer]), raw.name);
  for (const f of files) fd.append(field, await blob(f), f);
  if (expectStatus) {
    const started = Date.now();
    const res = await fetch(BASE + route, { method: 'POST', body: fd, headers: authHeaders(), signal: AbortSignal.timeout(60000) });
    rememberCookie(res);
    const text = await res.text();
    record(name, res.status === expectStatus, Date.now() - started, 'HTTP ' + res.status + ' ' + text.slice(0, 60).replace(/\s+/g, ' '));
    return { status: res.status, payload: {} };
  }
  const r = await request(name, 'POST', route, { body: fd });
  return { ...r, payload: r.payload, raw: r.buf };
}

async function getJson(name, route) {
  const r = await request(name, 'GET', route);
  return r.payload;
}

async function fetchBuf(url) {
  const res = await fetch(BASE + url, { headers: authHeaders(), signal: AbortSignal.timeout(60000) });
  return { buffer: Buffer.from(await res.arrayBuffer()), name: decodeURIComponent(url.split('/').pop() || 'file.pdf') };
}

async function json(name, method, route, body, expectStatus = null) {
  const started = Date.now();
  const res = await fetch(BASE + route, {
    method,
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  rememberCookie(res);
  const payload = await res.json().catch(() => ({}));
  const ok = expectStatus ? res.status === expectStatus : (res.ok && payload.ok !== false);
  record(name, ok, Date.now() - started, payload.note || payload.error || 'HTTP ' + res.status);
  return { status: res.status, payload };
}

// ---------------- A. 登录 / 角色 / 权限 ----------------
await post('未登录访问 app 被拒', '/api/app', { expectStatus: 401 });
await json('错误密码被拒', 'POST', '/api/auth/login', { username: 'root', password: 'definitely-wrong' }, 401);
const login = await json('root / root 登录', 'POST', '/api/auth/login', { username: 'root', password: 'root' });
record('登录角色为管理员', login.payload.user?.role === 'admin', 0, login.payload.user?.role || '');
record('管理员拥有全部模块', (login.payload.user?.modules || []).length === 9, 0, (login.payload.user?.modules || []).length + ' 个');
const me = await getJson('登录态回读', '/api/auth/me');
record('回读账号一致', me.user?.username === 'root', 0, me.user?.username || '');
const health = await getJson('健康检查（免登录）', '/api/health');
record('版本号 0.1.4', health.version === '0.1.4', 0, health.version);
record('MySQL 已连接', Boolean(health.db?.available), 0, health.db?.available ? 'v' + health.db.version : '不可用');
const app = await getJson('应用清单', '/api/app');
record('套件 57 + 自研 32 - 重复 2 = 87', app.suiteToolCount === 57 && app.nativeToolCount === 32 && app.toolCount === 87, 0, app.suiteToolCount + ' + ' + app.nativeToolCount + ' = ' + app.toolCount + '（去重后可用）');
record('app 携带账户信息', app.auth?.user?.username === 'root', 0, app.auth?.user?.role || '');
const notFound = await fetch(BASE + '/api/not-exist', { headers: authHeaders() });
record('未知接口 404', notFound.status === 404, 0, 'HTTP ' + notFound.status);
const indexRes = await fetch(BASE + '/');
record('首页可访问', indexRes.ok, 0, 'HTTP ' + indexRes.status);

// 受限账户
const created = await json('创建受限账户', 'POST', '/api/accounts', {
  username: 'smoke_viewer', password: 'viewer123', role: 'user', modules: ['image', 'ocr'],
});
const listed = await getJson('账户列表', '/api/accounts');
const viewer = (listed.users || []).find((u) => u.username === 'smoke_viewer');
record('新账户已入库', Boolean(viewer?.id), 0, viewer ? 'id=' + viewer.id : '未找到');
const adminCookie = COOKIE;

if (viewer) {
  await json('管理员改权限', 'PATCH', '/api/accounts/' + viewer.id, { modules: ['image', 'pdf', 'ocr'] });
  const after = (await getJson('权限回读', '/api/accounts')).users.find((u) => u.username === 'smoke_viewer');
  record('权限已更新', JSON.stringify(after?.modules?.sort()) === JSON.stringify(['image', 'ocr', 'pdf']), 0, (after?.modules || []).join(','));

  COOKIE = '';
  await json('受限账户登录', 'POST', '/api/auth/login', { username: 'smoke_viewer', password: 'viewer123' });
  const vapp = await getJson('受限账户 app', '/api/app');
  record('受限模块已过滤', (vapp.auth?.modules || []).length === 3, 0, (vapp.auth?.modules || []).join(','));
  await post('越权访问音视频被拒', '/api/suite/media/probe', { fields: {}, expectStatus: 403 });
  await json('越权访问账户管理被拒', 'GET', '/api/accounts', null, 403);
  await post('授权模块可用', '/api/suite/pdf/pdf2text', { files: ['sample-a.pdf'] });

  COOKIE = adminCookie;
  await json('删除受限账户', 'DELETE', '/api/accounts/' + viewer.id);
  const finalList = await getJson('删除回读', '/api/accounts');
  record('账户已删除', !(finalList.users || []).some((u) => u.username === 'smoke_viewer'), 0, String((finalList.users || []).length));
}

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
  await post('提取嵌入图片', S + 'extract-images', { raw: pdfFile });
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

// ---------------- G. 文档工具（15 项） ----------------
const DOC = '/api/doc/';
await post('Word 转 PDF', DOC + 'word-to-pdf', { field: 'file', files: ['sample.docx'] });
await post('Excel 转 PDF', DOC + 'excel-to-pdf', { field: 'file', files: ['sample.xlsx'] });
const ppt = await post('PowerPoint 转 PDF', DOC + 'pptx-to-pdf', { field: 'file', files: ['sample.pptx'] });
record('PPT 输出 2 页 PDF', (ppt.payload.files?.[0]?.size || 0) > 1500, 0, (ppt.payload.files?.[0]?.size || 0) + ' bytes');
await post('Markdown 转 PDF', DOC + 'md-to-pdf', { field: 'file', files: ['sample.md'] });
await post('文本转 PDF', DOC + 'txt-to-pdf', { field: 'file', files: ['sample.txt'] });
const txt = await post('Word 转 TXT', DOC + 'word-to-txt', { field: 'file', files: ['sample.docx'] });
record('TXT 含正文', (txt.payload.files?.[0]?.size || 0) > 40, 0, (txt.payload.files?.[0]?.size || 0) + ' bytes');
await post('Word 转 HTML', DOC + 'docx-to-html', { field: 'file', files: ['sample.docx'] });
await post('Word 转 Markdown', DOC + 'to-markdown', { field: 'file', files: ['sample.docx'] });
const h2w = await post('HTML 转 Word', DOC + 'html-to-docx', { field: 'file', files: ['sample.html'] });
record('生成 docx', /docx$/.test(h2w.payload.files?.[0]?.name || ''), 0, h2w.payload.files?.[0]?.name || '');
await post('Markdown 转 HTML', DOC + 'md-to-html', { field: 'file', files: ['sample.md'] });
await post('HTML 转 Markdown', DOC + 'to-markdown', { field: 'file', files: ['sample.html'] });
await post('批量转换 TXT', DOC + 'batch-convert', { field: 'files', fields: { target: 'txt' }, files: ['sample.docx', 'sample.html'] });
const gw = await post('公文一键排版', DOC + 'gongwen', { field: 'file', fields: { output: 'both', lineSpacing: 28 }, files: ['sample.docx'] });
record('公文输出 Word+PDF', /zip$/.test(gw.payload.files?.[0]?.name || ''), 0, gw.payload.files?.[0]?.name || '');
const mt = await json('Markdown 表格生成', 'POST', DOC + 'md-table', { rows: 2, cols: 3, headers: '姓名,部门,备注', align: 'left,center,right' });
record('表格含分隔行', /\| :--- \| :---: \| ---: \|/.test(mt.payload.data?.markdown || ''), 0, (mt.payload.data?.markdown || '').split('\n').length + ' 行');
const mr = await json('Markdown 渲染预览', 'POST', DOC + 'md-render', { md: '## 标题\n\n**加粗**' });
record('渲染含加粗标签', /<strong>/.test(mr.payload.data?.html || ''), 0, 'html ' + (mr.payload.data?.html || '').length);
const wrongType = await post('错误类型被拒', DOC + 'md-to-pdf', { field: 'file', files: ['sample.docx'], expectStatus: 400 });

// ---------------- G2. 通用预览 ----------------
const pvDoc = await post('预览 docx 文本', '/api/preview/document', { field: 'file', files: ['sample.docx'] });
record('docx 预览为文本', pvDoc.payload.data?.kind === 'text' && (pvDoc.payload.data?.text || '').includes('DocBox'), 0, pvDoc.payload.data?.kind + ' · ' + (pvDoc.payload.data?.chars || 0) + ' 字');
const pvXls = await post('预览 xlsx 表格', '/api/preview/document', { field: 'file', files: ['sample.xlsx'] });
record('xlsx 预览为表格', pvXls.payload.data?.kind === 'table' && (pvXls.payload.data?.sheets || []).length > 0, 0, (pvXls.payload.data?.sheets || []).map((x) => x.name).join(','));
const pvPpt = await post('预览 pptx 幻灯片', '/api/preview/document', { field: 'file', files: ['sample.pptx'] });
record('pptx 预览为幻灯片', pvPpt.payload.data?.kind === 'slides' && pvPpt.payload.data?.count === 2, 0, 'count=' + pvPpt.payload.data?.count);
const pvMd = await post('预览 md 文本', '/api/preview/document', { field: 'file', files: ['sample.md'] });
record('md 预览为文本', pvMd.payload.data?.kind === 'text', 0, (pvMd.payload.data?.lines || 0) + ' 行');
if (ppt.payload.files?.[0]?.url) {
  const pvOut = await json('预览已生成 PDF', 'POST', '/api/preview/output', { url: ppt.payload.files[0].url, name: ppt.payload.files[0].name });
  record('输出文件预览为 pdf', pvOut.payload.data?.kind === 'pdf', 0, pvOut.payload.data?.kind || '');
}
const pvBad = await json('非法预览地址被拒', 'POST', '/api/preview/output', { url: '/etc/passwd' }, 400);

// ---------------- H. 数据库 / 历史 ----------------
const hist = await getJson('处理历史', '/api/history?limit=20');
record('历史已入库', (hist.jobs || []).length > 0, 0, (hist.jobs || []).length + ' 条');
record('任务统计', Number(hist.stats?.total) > 0, 0, 'total=' + hist.stats?.total);
await json('模板写入', 'POST', '/api/templates', { templateId: 'smoke-tpl', name: 'smoke', spec: { a: 1 } });
const tplList = await getJson('模板列表', '/api/templates');
record('模板读取', (tplList.templates || []).some((t) => t.templateId === 'smoke-tpl'), 0, String((tplList.templates || []).length));
await json('模板删除', 'DELETE', '/api/templates/smoke-tpl');
const reports = await getJson('安全报告', '/api/net/reports?limit=5');
record('安全报告入库', (reports.reports || []).length > 0, 0, String((reports.reports || []).length));
await json('配置写入', 'POST', '/api/settings/smoke', { value: 'ok' });
const setGet = await getJson('配置读取', '/api/settings/smoke');
record('配置读取一致', setGet.value === 'ok', 0, String(setGet.value));
await json('退出登录', 'POST', '/api/auth/logout');
await post('退出后访问 app 被拒', '/api/app', { expectStatus: 401 });

// ---------------- 汇总 ----------------
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name.padEnd(24, ' ') + String(r.ms + 'ms').padStart(7) + '   ' + r.note);
}
console.log('');
console.log('  ' + (results.length - failed.length) + ' / ' + results.length + ' 通过');
if (failed.length) {
  console.log('  失败：' + failed.map((f) => f.name).join('、'));
  process.exitCode = 1;
}
