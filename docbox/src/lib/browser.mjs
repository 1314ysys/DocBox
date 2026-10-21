/**
 * 内置浏览器嗅探（headless Edge/Chrome + 原生 CDP，无需额外依赖）
 *
 * 用途：有些站点页面里没有明文 m3u8，是 JS 里动态取流 / hls.js 播放。
 * 做法：后台拉起无头浏览器打开页面 -> Network 域监听所有请求 -> 抓 .m3u8（含请求头、Cookie）
 *      -> 返回候选播放列表，交给现有 HLS 引擎解析与下载。
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { TMP_DIR } from '../config.mjs';
import { UA } from './hls.mjs';

const CANDIDATES = [
  process.env.DOCBOX_CHROME,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

let cached;
export async function browserStatus(force = false) {
  if (cached && !force) return cached;
  for (const p of CANDIDATES) {
    try {
      const st = await fsp.stat(p);
      if (st.isFile()) { cached = { available: true, path: p, name: path.basename(p) }; return cached; }
    } catch { /* 下一个 */ }
  }
  cached = { available: false, path: null, name: null, hint: '装个 Edge/Chrome，或设置环境变量 DOCBOX_CHROME 指向浏览器可执行文件' };
  return cached;
}

/** 极简 CDP 客户端 */
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }

  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, { perMessageDeflate: false, maxPayload: 32 * 1024 * 1024 });
      this.ws = ws;
      const timer = setTimeout(() => { try { ws.terminate(); } catch { /* ignore */ } reject(new Error('CDP 连接超时')); }, timeoutMs);
      ws.on('open', () => { clearTimeout(timer); resolve(); });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || 'CDP 错误'));
          else res(msg.result);
          return;
        }
        if (msg.method) {
          const list = this.handlers.get(msg.method);
          if (list) for (const fn of list) { try { fn(msg.params); } catch { /* ignore */ } }
        }
      });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch (e) { this.pending.delete(id); reject(e); }
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 调用超时：' + method)); }
      }, 20000);
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  close() {
    try { this.ws && this.ws.close(); } catch { /* ignore */ }
  }
}

async function getJson(url, timeout = 2000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  return res.json();
}

const isMediaUrl = (u) => /\.m3u8(\?|#|$)/i.test(String(u || '')) || /\.mpd(\?|#|$)/i.test(String(u || ''));

/**
 * 打开页面嗅探媒体流
 * @returns {ok, m3u8:[{url,status,headers}], videos:[url], title, requests, cookie, reason, ms}
 */
export async function sniffMedia(url, { timeoutMs = 15000, allowDash = false } = {}) {
  const st = await browserStatus();
  if (!st.available) return { ok: false, m3u8: [], videos: [], reason: st.hint, requests: 0 };

  const t0 = Date.now();
  const profile = path.join(TMP_DIR, 'browser-' + crypto.randomBytes(4).toString('hex'));
  await fsp.mkdir(profile, { recursive: true });

  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-gpu',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1366,860',
    '--user-agent=' + UA,
  ];
  if (process.platform === 'linux') args.unshift('--no-sandbox', '--disable-dev-shm-usage');
  args.push(url);

  let child;
  let cdp;
  const found = new Map(); // url -> {url, status, headers, at}
  let requests = 0;
  let title = '';

  try {
    child = spawn(st.path, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });

    // 等 DevToolsActivePort
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = 0;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const txt = await fsp.readFile(portFile, 'utf8');
        const line = txt.split('\n')[0].trim();
        if (line) { port = Number(line); break; }
      } catch { /* 继续等 */ }
      if (child.exitCode !== null) break;
    }
    if (!port) return { ok: false, m3u8: [], videos: [], reason: '浏览器没起来（端口未就绪）', requests };

    // 找页面 target
    let list = [];
    for (let i = 0; i < 25; i++) {
      try {
        list = await getJson('http://127.0.0.1:' + port + '/json/list');
        if (list.some((t) => t.type === 'page')) break;
      } catch { /* 继续等 */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    const page = list.find((t) => t.type === 'page' && /^https?:/.test(t.url || '')) || list.find((t) => t.type === 'page');
    if (!page) return { ok: false, m3u8: [], videos: [], reason: '没拿到页面 target', requests };

    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.connect();

    cdp.on('Network.requestWillBeSent', (p) => {
      requests += 1;
      const u = p?.request?.url || '';
      if (!u) return;
      if (isMediaUrl(u) && (allowDash || !/\.mpd(\?|#|$)/i.test(u))) {
        if (!found.has(u)) {
          found.set(u, {
            url: u,
            status: null,
            headers: (p.request.headers || {}),
            type: p.type || '',
            at: Date.now() - t0,
          });
        }
      }
    });
    cdp.on('Network.responseReceived', (p) => {
      const u = p?.response?.url || '';
      if (!u) return;
      if (found.has(u)) {
        const item = found.get(u);
        item.status = p.response.status;
        item.mime = p.response.mimeType;
      } else if (/^(video|audio)\//i.test(p.response.mimeType || '') && /^https?:/.test(u)) {
        found.set(u, { url: u, status: p.response.status, headers: {}, type: 'media', at: Date.now() - t0, raw: true });
      }
    });

    await cdp.send('Network.enable', { maxTotalBufferSize: 20 * 1024 * 1024 });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 打开页面后尝试触发播放（很多站点要点一下 / 调 play()）
    const kick = async () => {
      try {
        await cdp.send('Runtime.evaluate', {
          expression: "(()=>{let n=0;document.querySelectorAll('video').forEach(v=>{try{v.muted=true;v.play&&v.play();n++}catch(e){}});window.scrollTo(0,document.body?document.body.scrollHeight/2:0);return n})()",
        });
      } catch { /* ignore */ }
    };

    const deadline = Date.now() + timeoutMs;
    let kicked = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const hls = [...found.values()].filter((x) => /\.m3u8/i.test(x.url));
      if (kicked < 2) { kicked += 1; await kick(); }
      if (hls.some((x) => x.status === 200)) break;
    }

    try {
      const r = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      title = String(r?.result?.value || '');
    } catch { /* ignore */ }

    let cookie = '';
    try {
      const ck = await cdp.send('Network.getCookies', { urls: [url] });
      cookie = (ck.cookies || []).map((c) => c.name + '=' + c.value).join('; ');
    } catch { /* ignore */ }

    const all = [...found.values()];
    const hlsList = all.filter((x) => /\.m3u8/i.test(x.url));
    const videos = all.filter((x) => !/\.m3u8/i.test(x.url)).map((x) => x.url);
    // 排序：200 的优先、master 优先（路径里带 master/index）、后出现的优先（更像正片）
    hlsList.sort((a, b) => {
      const sa = (a.status === 200 ? 0 : 1) + (/master/i.test(a.url) ? 0 : 0.5);
      const sb = (b.status === 200 ? 0 : 1) + (/master/i.test(b.url) ? 0 : 0.5);
      if (sa !== sb) return sa - sb;
      return (b.at || 0) - (a.at || 0);
    });

    return {
      ok: hlsList.length > 0 || videos.length > 0,
      m3u8: hlsList.map((x) => ({ url: x.url, status: x.status, headers: x.headers })),
      videos,
      title,
      cookie,
      requests,
      ms: Date.now() - t0,
      reason: hlsList.length ? '' : '浏览器里也没有出现 m3u8（可能需要登录、地区解锁或真人验证）',
    };
  } catch (e) {
    return { ok: false, m3u8: [], videos: [], reason: String((e && e.message) || e), requests, ms: Date.now() - t0 };
  } finally {
    try { cdp && cdp.close(); } catch { /* ignore */ }
    try { child && child.kill(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}
