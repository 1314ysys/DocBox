/**
 * DocBox 前端交互自检（按人类真实操作走一遍）
 * - 用无头 Edge/Chrome 打开真实页面，走「登录 → 图片编辑 → 选图 → 选区 → 裁剪 → 导出」全流程
 * - 校验导出的图片尺寸 == 选区尺寸（防止"下载还是整图"）
 * - 顺带核对水印页模板数量
 *
 * 用法：node scripts/ui-check.mjs [baseUrl] [--json out.json]
 * 依赖：本机有 Edge / Chrome / Chromium（和视频嗅探用的是同一套内核发现逻辑）
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : (process.env.DOCBOX_BASE || 'http://127.0.0.1:3000');
const USER = process.env.DOCBOX_USER || 'root';
const PASS = process.env.DOCBOX_PASS || 'root';
const JSON_OUT = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : ''; })();
const PORT = 9333;
const IMG = path.join(ROOT, 'tmp', 'ui-check.jpg');

function findBrowser() {
  const cands = [
    process.env.DOCBOX_CHROME,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return cands.find((p) => { try { return existsSync(p); } catch { return false; } });
}

const results = [];
function record(name, ok, note, ms) { results.push({ name, ok, note, ms }); console.log((ok ? '  PASS  ' : '  FAIL  ') + name.padEnd(30) + String(ms).padStart(6) + 'ms   ' + note); }

let child = null;
async function boot(profileDir) {
  const exe = findBrowser();
  if (!exe) throw new Error('找不到 Edge / Chrome / Chromium，可设置 DOCBOX_CHROME 指定路径');
  child = spawn(exe, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir, '--no-first-run', '--disable-gpu', 'about:blank'], { detached: true, stdio: 'ignore' });
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* 等浏览器起来 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('浏览器调试端口未就绪');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureImage() {
  if (existsSync(IMG)) return;
  const sharp = (await import('sharp')).default;
  await fs.mkdir(path.dirname(IMG), { recursive: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">' +
    '<rect width="1200" height="800" fill="#0f172a"/>' +
    '<rect x="80" y="80" width="480" height="300" fill="#38bdf8"/>' +
    '<rect x="640" y="420" width="480" height="300" fill="#f97316"/>' +
    '<text x="600" y="410" font-size="64" fill="#e2e8f0" text-anchor="middle" font-family="Microsoft YaHei">DocBox UI 自检</text></svg>';
  await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(IMG);
}

async function main() {
  const t0 = Date.now();
  await ensureImage();
  // 先拿登录 cookie，这样直接打开内页不会被踢回登录页
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
  if (!login.ok) throw new Error('登录失败：' + login.status);
  const rawCookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const eq = rawCookie.indexOf('=');
  const cookieName = rawCookie.slice(0, eq);
  const cookieValue = rawCookie.slice(eq + 1);

  const profile = path.join(os.tmpdir(), 'docbox-ui-check-' + Date.now());
  const wsUrl = await boot(profile);
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}, sessionId) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const a = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const sid = a.result.sessionId;
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('DOM.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCookie', { name: cookieName, value: cookieValue, domain: '127.0.0.1', path: '/' }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid)).result?.result?.value;
  const mouse = (type, x, y, button, buttons, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount }, sid);

  // 1. 打开图片编辑页
  let ms = Date.now();
  await send('Page.navigate', { url: BASE + '/#/editor' }, sid);
  await sleep(2500);
  const seen = await ev("JSON.stringify({editor: !!document.querySelector('#edCanvas') && !document.querySelector('#view-editor').hidden, url: location.href})");
  record('打开图片编辑页', JSON.parse(seen).editor, seen, Date.now() - ms);

  // 2. 载入图片
  ms = Date.now();
  const doc = await send('DOM.getDocument', {}, sid);
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#edFile' }, sid);
  await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [IMG] }, sid);
  await ev("document.querySelector('#edFile').dispatchEvent(new Event('change'))");
  await sleep(1500);
  const loaded = await ev("JSON.stringify({info: document.querySelector('#edInfo').textContent, w: document.querySelector('#edCanvas').width, h: document.querySelector('#edCanvas').height})");
  const origW = JSON.parse(loaded).w;
  const origH = JSON.parse(loaded).h;
  record('载入测试图片', origW > 0, loaded, Date.now() - ms);

  // 2.1 滚轮放大一档（顺便记下刻度，后面用来验证监听器没有重复绑定）
  ms = Date.now();
  const Rz = JSON.parse(await ev("(function(){const r=document.querySelector('#edCanvas').getBoundingClientRect();return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});})()"));
  const wBefore = Rz.w;
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Rz.l + Math.round(Rz.w / 2), y: Rz.t + Math.round(Rz.h / 2), deltaX: 0, deltaY: -300 }, sid);
  await sleep(400);
  const zoomOnce = await ev("document.querySelector('#edZoomVal').textContent");
  const wAfter = JSON.parse(await ev("(function(){const r=document.querySelector('#edCanvas').getBoundingClientRect();return JSON.stringify({w:Math.round(r.width)});})()")).w;
  const ratioOnce = wAfter / wBefore;
  record('滚轮放大一档', ratioOnce > 1.3 && ratioOnce < 2.0, zoomOnce + '（宽 ' + wBefore + '→' + wAfter + '，×' + ratioOnce.toFixed(2) + '）', Date.now() - ms);
  await ev("document.querySelector('#edZoomFit').click()");
  await sleep(300);

  // 3. 左键拖出选区 → 浮动操作条出现
  ms = Date.now();
  const R = JSON.parse(await ev("(function(){const r=document.querySelector('#edCanvas').getBoundingClientRect();return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});})()"));
  await mouse('mousePressed', R.l + 30, R.t + 40, 'left', 1);
  await mouse('mouseMoved', R.l + 30 + Math.round(R.w * 0.5), R.t + 40 + Math.round(R.h * 0.35), 'left', 1);
  await mouse('mouseReleased', R.l + 30 + Math.round(R.w * 0.5), R.t + 40 + Math.round(R.h * 0.35), 'left', 0);
  await sleep(300);
  const sel = JSON.parse(await ev("JSON.stringify({bar: !document.querySelector('#edCropBar').hidden, size: document.querySelector('#edCropBarSize').textContent, info: document.querySelector('#edInfo').textContent})"));
  record('拖出选区并出现操作条', sel.bar && /\d+ × \d+/.test(sel.size), JSON.stringify(sel), Date.now() - ms);

  // 4. 点浮动条「应用裁剪」
  ms = Date.now();
  await ev("document.querySelector('#edCropBarApply').click()");
  await sleep(700);
  const cropped = JSON.parse(await ev("JSON.stringify({w: document.querySelector('#edCanvas').width, h: document.querySelector('#edCanvas').height, info: document.querySelector('#edInfo').textContent})"));
  record('应用裁剪选区', cropped.w < origW && cropped.h < origH, JSON.stringify(cropped), Date.now() - ms);

  // 5. 撤销回原图
  ms = Date.now();
  await ev("document.querySelector('#edUndo').click()");
  await sleep(800);
  const undone = JSON.parse(await ev("JSON.stringify({w: document.querySelector('#edCanvas').width, h: document.querySelector('#edCanvas').height})"));
  record('撤销回原图', undone.w === origW && undone.h === origH, JSON.stringify(undone), Date.now() - ms);

  // 6. 拉选区后直接导出 → 下载到的必须是裁剪后的尺寸
  ms = Date.now();
  await ev("(() => { window.__dl = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl = { name: this.download, href: this.href }; else orig.call(this); }; })()");
  const R2 = JSON.parse(await ev("(function(){const r=document.querySelector('#edCanvas').getBoundingClientRect();return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});})()"));
  await mouse('mousePressed', R2.l + 20, R2.t + 20, 'left', 1);
  await mouse('mouseMoved', R2.l + 20 + Math.round(R2.w * 0.4), R2.t + 20 + Math.round(R2.h * 0.3), 'left', 1);
  await mouse('mouseReleased', R2.l + 20 + Math.round(R2.w * 0.4), R2.t + 20 + Math.round(R2.h * 0.3), 'left', 0);
  await sleep(250);
  const selText = await ev("document.querySelector('#edInfo').textContent");
  await ev("document.querySelector('#edExport').click()");
  await sleep(1400);
  const dl = await ev(`(async () => {
    const d = window.__dl; if (!d) return JSON.stringify({ ok: false, note: '没有触发下载' });
    const blob = await (await fetch(d.href)).blob();
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = d.href; });
    return JSON.stringify({ ok: true, name: d.name, kb: Math.round(blob.size / 1024), size: img, canvas: [document.querySelector('#edCanvas').width, document.querySelector('#edCanvas').height] });
  })()`);
  const dlj = JSON.parse(dl);
  const selDim = (selText.match(/(\d+) × (\d+)/) || []).slice(1).map(Number);
  const exportOk = dlj.ok && dlj.size && selDim.length === 2 && dlj.size.w === selDim[0] && dlj.size.h === selDim[1];
  record('导出即裁剪后的图', exportOk, (selText || '') + ' → ' + dl, Date.now() - ms);

  // 7. 水印模板（真实页面渲染出来的数量）
  ms = Date.now();
  const tpl = await ev("fetch('/api/watermark/templates').then(r=>r.json()).then(j=>(j.templates||[]).length)");
  const ids = await ev("fetch('/api/watermark/templates').then(r=>r.json()).then(j=>(j.templates||[]).map(t=>t.id).join(','))");
  const want = ['brand', 'attendance', 'record', 'custom'];
  record('水印模板齐全', tpl >= 11 && want.every((k) => ids.includes(k)), tpl + ' 套：' + ids, Date.now() - ms);

  // 8. 来回切视图后，滚轮只放大一档（防止监听器重复绑定导致一次放大好几倍）
  ms = Date.now();
  await ev("location.hash = '#/'; true");
  await sleep(800);
  await ev("location.hash = '#/editor'; true");
  await sleep(1500);
  const back = await ev("JSON.stringify({editor: !document.querySelector('#view-editor').hidden, zoom: document.querySelector('#edZoomVal').textContent})");
  const doc3 = await send('DOM.getDocument', {}, sid);
  const q3 = await send('DOM.querySelector', { nodeId: doc3.result.root.nodeId, selector: '#edFile' }, sid);
  await send('DOM.setFileInputFiles', { nodeId: q3.result.nodeId, files: [IMG] }, sid);
  await ev("document.querySelector('#edFile').dispatchEvent(new Event('change'))");
  await sleep(1400);
  const R3 = JSON.parse(await ev("(function(){const r=document.querySelector('#edCanvas').getBoundingClientRect();return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});})()"));
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: R3.l + Math.round(R3.w / 2), y: R3.t + Math.round(R3.h / 2), deltaX: 0, deltaY: -300 }, sid);
  await sleep(400);
  const zoomAfter = await ev("document.querySelector('#edZoomVal').textContent");
  const wAfter2 = JSON.parse(await ev("(function(){const r=document.querySelector('#edCanvas').getBoundingClientRect();return JSON.stringify({w:Math.round(r.width)});})()")).w;
  const ratio2 = wAfter2 / R3.w;
  record('切视图后滚轮仍是一档', JSON.parse(back).editor && ratio2 > 1.3 && ratio2 < 2.0,
    back + ' → ×' + ratio2.toFixed(2) + '（首次 ×' + ratioOnce.toFixed(2) + '），刻度 ' + zoomOnce + ' / ' + zoomAfter, Date.now() - ms);

  // 9. 账户管理：模块胶囊点一下就要有反馈、并且能保存（用临时账户，测完删掉）
  ms = Date.now();
  const tmpUser = 'uicheck' + Math.random().toString(36).slice(2, 6);
  const createdStatus = await ev(`fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '${tmpUser}', password: 'pass1234', role: 'user', modules: ['image'] }) }).then((r) => r.status)`);
  await ev("location.hash = '#/'; true");
  await sleep(400);
  await ev("location.hash = '#/accounts'; true");
  await sleep(2200);
  const pickExpr = `(() => {
    const tr = [...document.querySelectorAll('tr[data-id]')].find((x) => x.textContent.includes('${tmpUser}'));
    if (!tr) return JSON.stringify({ found: false });
    const off = [...tr.querySelectorAll('.mod-chip:not(.locked)')].find((c) => !c.querySelector('input[data-mod]').checked);
    const chip = off || tr.querySelector('.mod-chip:not(.locked)');
    if (!chip) return JSON.stringify({ found: false, why: 'no-chip' });
    const input = chip.querySelector('input[data-mod]');
    const cr = chip.getBoundingClientRect();
    const sb = tr.querySelector('[data-save]').getBoundingClientRect();
    return JSON.stringify({ found: true, id: tr.dataset.id, mod: input.dataset.mod, checked: input.checked, cls: chip.className,
      x: Math.round(cr.left + cr.width / 2), y: Math.round(cr.top + cr.height / 2), sx: Math.round(sb.left + sb.width / 2), sy: Math.round(sb.top + sb.height / 2) });
  })()`;
  const rowInfo = await ev(pickExpr);
  const ri = (() => { try { return JSON.parse(rowInfo); } catch { return { found: false, raw: String(rowInfo) }; } })();
  let toggleOk = false;
  let saveOk = false;
  if (!ri.found) {
    record('模块胶囊点选有反馈', false, '临时账户行没找到：' + JSON.stringify(ri).slice(0, 140) + ' / 创建状态 ' + createdStatus, Date.now() - ms);
    record('模块授权可保存', false, '跳过', 0);
  } else {
    await mouse('mousePressed', ri.x, ri.y, 'left', 1);
    await mouse('mouseReleased', ri.x, ri.y, 'left', 0);
    await sleep(350);
    const afterExpr = `(() => {
      const tr = [...document.querySelectorAll('tr[data-id]')].find((x) => x.textContent.includes('${tmpUser}'));
      const chip = [...tr.querySelectorAll('.mod-chip')].find((c) => c.querySelector('input[data-mod]').dataset.mod === '${ri.mod}');
      const input = chip.querySelector('input[data-mod]');
      return JSON.stringify({ checked: input.checked, cls: chip.className, count: tr.querySelector('[data-modcount]')?.textContent });
    })()`;
    const afterRaw = await ev(afterExpr);
    const after = (() => { try { return JSON.parse(afterRaw); } catch { return { checked: null, cls: '<er>' + String(afterRaw).slice(0, 60) }; } })();
    toggleOk = after.checked === !ri.checked && after.cls.includes('on') === after.checked;
    record('模块胶囊点选有反馈', toggleOk, ri.mod + '：' + ri.checked + ' → ' + after.checked + '，胶囊「' + after.cls + '」，' + (after.count || ''), Date.now() - ms);

    ms = Date.now();
    await mouse('mousePressed', ri.sx, ri.sy, 'left', 1);
    await mouse('mouseReleased', ri.sx, ri.sy, 'left', 0);
    await sleep(1500);
    const modsExpr = `fetch('/api/accounts').then((r) => r.json()).then((j) => { const u = (j.users || []).find((x) => x.username === '${tmpUser}'); return JSON.stringify(u ? u.modules : null); })`;
    const gotRaw = await ev(modsExpr);
    const got = (() => { try { return JSON.parse(gotRaw); } catch { return null; } })();
    saveOk = Array.isArray(got) && got.includes(ri.mod) === after.checked;
    record('模块授权可保存', saveOk, '接口回读 ' + JSON.stringify(got), Date.now() - ms);
  }
  // 清理临时账户
  if (ri.found) await ev(`fetch('/api/accounts/${ri.id}', { method: 'DELETE' }).then((r) => r.status)`);
  // 10. 全程无 JS 异常
  record('页面无 JS 异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | ') || '无', 0);

  await send('Target.closeTarget', { targetId: t.result.targetId });
  ws.close();
  try { process.kill(-child.pid); } catch { try { child.kill(); } catch { /* ignore */ } }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n结果：' + pass + ' / ' + results.length + ' 通过' + (fail ? '，' + fail + ' 失败' : '') + '，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (JSON_OUT) await fs.writeFile(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, pass, fail, results }, null, 2));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('UI 自检失败：' + e.message); try { child?.kill(); } catch { /* ignore */ } process.exit(1); });
