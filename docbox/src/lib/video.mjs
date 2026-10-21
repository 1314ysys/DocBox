/**
 * 视频网站解析与下载（统一入口）
 *
 * 解析顺序：
 *   1) 站点内置解析（哔哩哔哩 API）：不需要 yt-dlp 就能出清晰度
 *   2) yt-dlp（如已安装）：站点信息 + 站内 m3u8 优先，交给自带 HLS 引擎
 *   3) 网页抓取：HTML / 内嵌 JS / iframe 里找 m3u8 与直链
 *
 * 下载：m3u8 -> 内置 HLS 引擎；DASH -> 分别抓视频+音频再 ffmpeg 合成；
 *       直链 -> 流式落盘（带 Referer 等站点要求的头）；其余 -> yt-dlp。
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { FFMPEG, DOCBOX_DIR, ROOT } from '../config.mjs';
import { isPlaylist, resolvePlaylist, downloadSegments, concatToMp4, UA } from './hls.mjs';
import { resolveBySite } from './sites.mjs';
import { sniffMedia, browserStatus } from './browser.mjs';

let ytdlpCache;

function errLines(text, n = 2) {
  const lines = String(text || '').split('\n').map((s) => s.trim())
    .filter((l) => l && !/Deprecated Feature|You are using an unsupported|Please update to Python/i.test(l));
  const errors = lines.filter((l) => /^ERROR/i.test(l));
  return (errors.length ? errors.slice(-n) : lines.slice(-n)).join(' ');
}

function run(cmd, args, { timeout = 30000, signal, cwd } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, cwd });
    } catch {
      return resolve({ ok: false, out: '', err: 'spawn failed' });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeout);
    const onAbort = () => { try { child.kill(); } catch { /* ignore */ } };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, out, err: 'not found' }); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ ok: code === 0, out, err, code });
    });
  });
}

const PY = process.platform === 'win32' ? 'python' : 'python3';

function ytdlpCandidates() {
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const list = [];
  if (process.env.DOCBOX_YTDLP) list.push({ bin: process.env.DOCBOX_YTDLP, prefix: [] });
  list.push({ bin: path.join(DOCBOX_DIR, 'bin', exe), prefix: [] });
  list.push({ bin: exe, prefix: [] });
  list.push({ bin: PY, prefix: ['-m', 'yt_dlp'] });
  return list;
}

/** 检测 yt-dlp：环境变量 / 项目 bin 目录 / PATH / python -m yt_dlp */
export async function ytdlpStatus(force = false) {
  if (ytdlpCache && !force) return ytdlpCache;
  for (const c of ytdlpCandidates()) {
    const r = await run(c.bin, [...c.prefix, '--version'], { timeout: 20000 });
    const v = (r.out || '').trim().split('\n').pop();
    if (r.ok && /^\d{4}\.\d{2}\.\d{2}/.test(v)) {
      ytdlpCache = { available: true, version: v, bin: c.bin, prefix: c.prefix };
      return ytdlpCache;
    }
  }
  ytdlpCache = {
    available: false,
    version: null,
    install: {
      pip: PY + ' -m pip install -U yt-dlp',
      script: 'node scripts/fetch-ytdlp.mjs',
      env: '设置环境变量 DOCBOX_YTDLP 指向 yt-dlp 可执行文件',
      api: 'POST /api/video/ytdlp/install（本页面按钮，一键安装）',
    },
  };
  return ytdlpCache;
}

export function refreshYtdlp() {
  ytdlpCache = undefined;
  return ytdlpStatus(true);
}

async function runYtdlp(args, opts) {
  const st = await ytdlpStatus();
  if (!st.available) throw new Error('未安装 yt-dlp');
  return run(st.bin, [...st.prefix, ...args], opts);
}

/** 一键安装 / 升级 yt-dlp：优先 pip，其次下载官方单文件 */
export async function installYtdlp() {
  const steps = [];
  const pip = await run(PY, ['-m', 'pip', 'install', '-U', '--disable-pip-version-check', 'yt-dlp'], { timeout: 300000 });
  steps.push({ via: 'pip', ok: pip.ok, detail: (pip.ok ? 'pip 安装完成' : (pip.err || '').trim().split('\n').slice(-2).join(' ')) });
  if (pip.ok) {
    const st = await refreshYtdlp();
    if (st.available) return { ok: true, via: 'pip', version: st.version, steps };
  }

  // 退路：直接下官方二进制
  try {
    const rel = await (await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'user-agent': 'docbox', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    })).json();
    const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const asset = (rel.assets || []).find((a) => a.name === name);
    if (!asset) throw new Error('release 里找不到 ' + name);
    const res = await fetch(asset.browser_download_url, { headers: { 'user-agent': 'docbox' }, signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = path.join(DOCBOX_DIR, 'bin');
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, name);
    await fsp.writeFile(target, buf);
    if (process.platform !== 'win32') await fsp.chmod(target, 0o755);
    steps.push({ via: 'binary', ok: true, detail: '已下载 ' + Math.round(buf.length / 1024 / 1024) + ' MB 到 ' + target });
    const st = await refreshYtdlp();
    return { ok: st.available, via: 'binary', version: st.version || null, steps };
  } catch (e) {
    steps.push({ via: 'binary', ok: false, detail: String(e.message || e) });
    return { ok: false, via: 'none', version: null, steps, hint: '可手动执行：' + PY + ' -m pip install -U yt-dlp' };
  }
}

export function siteHint(url) {
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  if (/bilibili|b23\.tv/.test(host)) return '哔哩哔哩';
  if (/youtube|youtu\.be/.test(host)) return 'YouTube';
  if (/iqiyi/.test(host)) return '爱奇艺';
  if (/v\.qq\.com/.test(host)) return '腾讯视频';
  if (/youku/.test(host)) return '优酷';
  if (/mgtv/.test(host)) return '芒果 TV';
  if (/douyin|tiktok/.test(host)) return '抖音';
  if (/weibo/.test(host)) return '微博';
  if (/xiaohongshu/.test(host)) return '小红书';
  return host;
}

export function isM3u8(url) {
  return /\.m3u8(\?|#|$)/i.test(String(url || ''));
}

/** 从 HTML / 内嵌 JS 里找出 m3u8 与常见直链（兼容 JSON 转义与 \u002F） */
export function scanPage(html, baseUrl) {
  const text = String(html || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/');
  const found = new Map();
  const patterns = [
    /https?:\/\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/gi,
    /["'](?:url|src|playurl|m3u8|hls|video_url|master_url)["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/gi,
    /["']([^"']+\.m3u8[^"']*)["']/gi,
    /https?:\/\/[^"'\s\\]+?\.(?:mp4|m4v|flv|webm|m4s)[^"'\s\\]*/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const raw = (m[1] || m[0] || '').trim();
      if (!raw || raw.length < 8) continue;
      let abs;
      try { abs = new URL(raw, baseUrl).toString(); } catch { continue; }
      if (!/\.(m3u8|mp4|m4v|flv|webm|m4s)(\?|#|$)/i.test(abs)) continue;
      if (!found.has(abs)) found.set(abs, { url: abs, type: isM3u8(abs) ? 'hls' : 'file' });
      if (found.size >= 40) break;
    }
  }
  return [...found.values()].sort((a, b) => (a.type === 'hls' ? -1 : 1) - (b.type === 'hls' ? -1 : 1));
}

export function scanFrames(html, baseUrl) {
  const out = [];
  const re = /<iframe[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { out.push(new URL(m[1], baseUrl).toString()); } catch { /* ignore */ }
    if (out.length >= 5) break;
  }
  return out;
}

async function fetchPage(url, signal) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    redirect: 'follow',
    signal: signal || AbortSignal.timeout(30000),
  });
  const ct = res.headers.get('content-type') || '';
  if (isPlaylist(url, ct)) return { kind: 'hls', res, status: res.status, contentType: ct };
  if (!ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('javascript')) {
    return { kind: 'binary', res, status: res.status, contentType: ct };
  }
  const html = await res.text();
  return { kind: 'html', res, html, status: res.status, contentType: ct };
}

function hlsFormats(parsed, headers) {
  if (parsed.isMaster && parsed.variants.length) {
    return parsed.variants.map((v) => ({
      id: v.url,
      ext: 'mp4',
      height: Number((v.resolution.split('x')[1] || 0)) || null,
      note: 'HLS ' + (v.resolution || 'auto') + ' ' + Math.round(v.bandwidth / 1000) + 'kbps',
      type: 'hls',
      url: v.url,
      headers,
      hasVideo: true,
      hasAudio: true,
    }));
  }
  return [{
    id: parsed.url || 'hls',
    ext: 'mp4',
    height: null,
    note: 'HLS 单片列表（' + parsed.segments.length + ' 片）',
    type: 'hls',
    url: parsed.url,
    headers,
    hasVideo: true,
    hasAudio: true,
  }];
}

/** 内置浏览器嗅探：无头 Edge/Chrome 打开页面，抓 Network 里的 m3u8（含 Cookie/Referer） */
async function sniffStep(url, info, diag, { preferHeight = 0, signal, deep = false } = {}) {
  try {
    const st = await browserStatus();
    if (!st.available) {
      diag.steps.push({ step: '内置浏览器嗅探', ok: false, detail: st.hint });
      return null;
    }
    const r = await sniffMedia(url, { timeoutMs: deep ? 20000 : 15000 });
    diag.steps.push({
      step: '内置浏览器嗅探',
      ok: Boolean(r.m3u8 && r.m3u8.length),
      detail: (r.title ? '《' + String(r.title).slice(0, 20) + '》 · ' : '') + '请求 ' + (r.requests || 0) + ' 个 · ' + ((r.m3u8 || []).length) + ' 个 m3u8 · ' + (r.ms || 0) + 'ms' + (r.reason ? ' · ' + r.reason : ''),
    });
    if (!r.m3u8 || !r.m3u8.length) return null;

    const baseHeaders = { referer: url };
    if (r.cookie) baseHeaders.cookie = r.cookie;
    if (!info.title && r.title) info.title = r.title;

    for (const cand of r.m3u8.slice(0, 3)) {
      try {
        const headers = { ...baseHeaders, ...(cand.headers && cand.headers.referer ? { referer: cand.headers.referer } : {}) };
        const parsed = await resolvePlaylist(cand.url, preferHeight, signal, headers);
        info.kind = 'browser';
        info.engine = 'builtin-browser';
        info.manifest = cand.url;
        info.headers = headers;
        info.formats = hlsFormats({ ...parsed, url: cand.url }, headers);
        info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note }));
        info.engine = 'builtin-browser';
        diag.steps.push({ step: '解析浏览器抓到的 m3u8', ok: true, detail: info.formats.length + ' 个码率 · ' + cand.url.slice(-60) });
        return info;
      } catch (e) {
        diag.steps.push({ step: '解析浏览器抓到的 m3u8', ok: false, detail: String((e && e.message) || e).slice(0, 120) });
      }
    }
    return null;
  } catch (e) {
    diag.steps.push({ step: '内置浏览器嗅探', ok: false, detail: String((e && e.message) || e).slice(0, 140) });
    return null;
  }
}

/**
 * 统一解析：站点内置 -> （深度）内置浏览器 -> yt-dlp -> 网页抓取 -> 内置浏览器兜底
 */
export async function resolveSource(url, { preferHeight = 0, signal, depth = 0, deep = false, sniff = true } = {}) {
  const info = {
    url, site: siteHint(url), title: '', thumbnail: '', duration: null, uploader: '',
    kind: 'unknown', engine: '', formats: [], streams: [], ytdlp: await ytdlpStatus(),
    diagnose: { steps: [] },
  };
  const diag = info.diagnose;

  // 0) m3u8 直链
  if (isM3u8(url)) {
    const parsed = await resolvePlaylist(url, preferHeight, signal);
    info.kind = 'hls';
    info.engine = 'hls';
    info.title = decodeURIComponent((url.split('?')[0].split('/').pop() || 'video'));
    info.formats = hlsFormats({ ...parsed, url });
    info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note }));
    diag.steps.push({ step: 'm3u8 直链', ok: true, detail: info.formats.length + ' 个码率' });
    return info;
  }

  // 1) 站点内置解析（不依赖 yt-dlp）
  try {
    const site = await resolveBySite(url);
    if (site) {
      if (site.formats && site.formats.length) {
        Object.assign(info, site);
        info.diagnose = diag;
        diag.steps.push({ step: '站点内置解析', ok: true, detail: site.engine + ' · ' + site.formats.length + ' 个清晰度' });
        return info;
      }
      diag.steps.push({ step: '站点内置解析', ok: false, detail: site.note || '没有可用流' });
    }
  } catch (e) {
    diag.steps.push({ step: '站点内置解析', ok: false, detail: String(e.message || e).slice(0, 160) });
  }

  // 2) yt-dlp
  if (info.ytdlp.available) {
    const r = await runYtdlp(['-J', '--no-warnings', '--no-playlist', '--socket-timeout', '15', '--retries', '2', '--extractor-retries', '1', url], { timeout: 60000, signal });
    if (r.ok) {
      try {
        const meta = JSON.parse(r.out);
        info.title = meta.title || '';
        info.thumbnail = meta.thumbnail || '';
        info.duration = meta.duration || null;
        info.uploader = meta.uploader || meta.channel || '';
        info.kind = 'ytdlp';
        info.engine = 'yt-dlp ' + (info.ytdlp.version || '');
        const list = meta.formats || [];
        const hlsEntry = list.filter((f) => /m3u8/i.test(String(f.protocol || '')) && f.url);
        if (hlsEntry.length) {
          const best = hlsEntry.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
          try {
            const parsed = await resolvePlaylist(best.url, preferHeight, signal);
            info.formats = hlsFormats({ ...parsed, url: best.url });
            info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note }));
            info.manifest = best.url;
            diag.steps.push({ step: 'yt-dlp', ok: true, detail: '站内 m3u8 → ' + info.formats.length + ' 个码率' });
            return info;
          } catch { /* 退回 yt-dlp 直链 */ }
        }
        info.formats = list
          .filter((f) => f.format_id && f.vcodec && f.vcodec !== 'none')
          .map((f) => ({
            id: f.format_id,
            ext: f.ext,
            height: f.height || null,
            fps: f.fps || null,
            note: f.format_note || (f.ext || '').toUpperCase(),
            filesize: f.filesize || f.filesize_approx || null,
            type: 'file',
            url: '',
            hasVideo: true,
            hasAudio: Boolean(f.acodec && f.acodec !== 'none'),
          }))
          .slice(0, 60);
        info.streams = info.formats.map((f) => ({ type: 'file', formatId: f.id, label: f.height ? f.height + 'P' : f.note }));
        diag.steps.push({ step: 'yt-dlp', ok: info.formats.length > 0, detail: info.formats.length + ' 个格式' });
        if (info.formats.length) return info;
      } catch (e) {
        diag.steps.push({ step: 'yt-dlp', ok: false, detail: 'JSON 解析失败：' + String(e.message || e).slice(0, 120) });
      }
    } else {
      const msg = errLines(r.err);
      info.ytdlpError = msg || (r.code === null || r.code === undefined ? '超时（60s 内没解析出来，通常是该站在当前网络不可达）' : 'exit ' + r.code);
      diag.steps.push({ step: 'yt-dlp', ok: false, detail: String(info.ytdlpError).slice(0, 200) });
    }
  } else {
    diag.steps.push({ step: 'yt-dlp', ok: false, detail: '未安装（可在本页一键安装）' });
  }

  // 3) 网页抓取
  let page;
  try {
    page = await fetchPage(url, signal);
  } catch (e) {
    diag.steps.push({ step: '抓取网页', ok: false, detail: '请求失败：' + String(e.message || e).slice(0, 120) });
    info.reason = '网页打不开（' + String(e.message || e).slice(0, 80) + '），可能是站点需要登录、限流或本机网络访问不到该站。';
    return info;
  }

  if (page.kind === 'hls') {
    const parsed = await resolvePlaylist(url, preferHeight, signal);
    info.kind = 'hls';
    info.engine = 'hls';
    info.formats = hlsFormats({ ...parsed, url });
    info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note }));
    diag.steps.push({ step: '抓取网页', ok: true, detail: '链接就是 m3u8' });
    return info;
  }

  let candidates = page.kind === 'html' ? scanPage(page.html, url) : [];
  info.title = info.title || (String(page.html || '').match(/<title[^>]*>([^<]{1,120})<\/title>/i) || [])[1] || '';
  diag.steps.push({
    step: '抓取网页',
    ok: candidates.length > 0,
    detail: 'HTTP ' + page.status + ' · ' + (page.contentType || '?').slice(0, 30) + ' · ' + (page.html ? Math.round(page.html.length / 1024) + 'KB' : '二进制') + ' · 命中 ' + candidates.length + ' 个地址',
  });

  if (!candidates.length && page.kind === 'html' && depth < 2) {
    const frames = scanFrames(page.html, url);
    for (const frame of frames) {
      try {
        const child = await resolveSource(frame, { preferHeight, signal, depth: depth + 1 });
        if (child.formats && child.formats.length) {
          info.kind = 'embed';
          info.engine = child.engine;
          info.formats = child.formats;
          info.streams = child.streams;
          info.embedFrom = frame;
          info.title = info.title || child.title;
          diag.steps.push({ step: 'iframe 跟进', ok: true, detail: frame.slice(0, 80) });
          return info;
        }
      } catch { /* 下一个 */ }
    }
    if (frames.length) diag.steps.push({ step: 'iframe 跟进', ok: false, detail: frames.length + ' 个 iframe 都没拿到流' });
  }

  if (candidates.length) {
    const first = candidates[0];
    if (first.type === 'hls') {
      try {
        const parsed = await resolvePlaylist(first.url, preferHeight, signal);
        info.kind = 'page';
        info.engine = 'hls';
        info.manifest = first.url;
        info.formats = hlsFormats({ ...parsed, url: first.url });
        info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note }));
        info.candidates = candidates.slice(0, 10).map((c) => c.url);
        diag.steps.push({ step: '解析 m3u8', ok: true, detail: info.formats.length + ' 个码率' });
        return info;
      } catch (e) {
        info.hlsError = e.message;
        diag.steps.push({ step: '解析 m3u8', ok: false, detail: String(e.message || e).slice(0, 140) });
      }
    }
    info.kind = 'page';
    info.engine = 'direct';
    info.candidates = candidates.slice(0, 20).map((c) => c.url);
    info.formats = candidates.slice(0, 20).map((c, i) => ({
      id: 'c' + i, ext: c.type === 'hls' ? 'mp4' : (c.url.split('.').pop() || 'mp4').slice(0, 5),
      height: null, note: (c.type === 'hls' ? 'HLS' : '直链') + ' · ' + c.url.slice(-48),
      type: c.type, url: c.url, hasVideo: true, hasAudio: true,
    }));
    info.streams = info.formats.map((f) => ({ type: f.type, url: f.url, label: f.note }));
    return info;
  }

  // 兜底：内置浏览器嗅探（默认开启，可 sniff:false 关闭）
  if (sniff !== false) {
    const hit = await sniffStep(url, info, diag, { preferHeight, signal, deep });
    if (hit) return hit;
  }

  const missing = [];
  if (!info.ytdlp.available) missing.push('未安装 yt-dlp（请在页面点「一键安装 yt-dlp」，或执行 ' + PY + ' -m pip install -U yt-dlp）');
  else if (info.ytdlpError) missing.push('yt-dlp 解析失败：' + info.ytdlpError.slice(0, 160));
  missing.push('网页与内置浏览器里都没有出现 m3u8 / mp4（站点可能需要登录、真人验证或地区解锁）');
  info.reason = missing.join('；');
  return info;
}

/** 兼容旧调用 */
export async function probe(url) {
  return resolveSource(url);
}

/** 通用文件下载（带站点要求的 Referer 等头），支持进度与取消 */
async function downloadTo(url, outPath, { headers, onProgress, signal, label } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, ...(headers || {}) },
    signal: signal || AbortSignal.timeout(1800000),
  });
  if (!res.ok) throw new Error((label || '下载') + '失败：HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  const fh = await fsp.open(outPath, 'w');
  let got = 0;
  try {
    for await (const chunk of res.body) {
      await fh.write(chunk);
      got += chunk.length;
      if (onProgress) onProgress(got, total);
      if (signal && signal.aborted) throw new Error('已取消');
    }
  } finally {
    await fh.close();
  }
  return { size: got, total };
}

/**
 * 下载：DASH（视频+音频合成） / m3u8 / 直链 / yt-dlp
 * format 既可以是格式 id 字符串，也可以是解析结果里的格式对象
 */
export async function download({ url, format, dir, onProgress, signal, manifest, headers }) {
  await fsp.mkdir(dir, { recursive: true });
  const stamp = Date.now();
  const pick = (() => {
    if (format && typeof format === 'object') return format;
    if (typeof format === 'string' && format) {
      if (isM3u8(format)) return { type: 'hls', url: format };
      if (/^https?:\/\//i.test(format)) return { type: 'file', url: format };
      return { type: 'ytdlp', id: format };
    }
    if (isM3u8(url)) return { type: 'hls', url };
    if (manifest && isM3u8(manifest)) return { type: 'hls', url: manifest };
    return { type: 'ytdlp', id: '' };
  })();

  // 1) DASH：视频、音频分开取，再用 ffmpeg 合成
  if (pick.type === 'dash' && pick.url) {
    const vPath = path.join(dir, 'dash-v-' + stamp + '.mp4');
    const aPath = path.join(dir, 'dash-a-' + stamp + '.m4a');
    await downloadTo(pick.url, vPath, { headers: pick.headers || headers, signal, onProgress: (d, t) => onProgress && onProgress(d, t ? t * 2 : 0) });
    let audioOk = false;
    if (pick.audioUrl) {
      try {
        await downloadTo(pick.audioUrl, aPath, { headers: pick.headers || headers, signal, onProgress: (d, t) => onProgress && onProgress(d, t ? t * 2 : 0) });
        audioOk = true;
      } catch { /* 音轨失败就只要视频 */ }
    }
    const out = path.join(dir, 'dash-' + stamp + '.mp4');
    if (audioOk) {
      const r = await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', vPath, '-i', aPath, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', out], { timeout: 600000 });
      if (!r.ok) throw new Error('合成失败：' + (r.err || '').trim().split('\n').slice(-2).join(' '));
      fsp.rm(vPath, { force: true }).catch(() => {});
      fsp.rm(aPath, { force: true }).catch(() => {});
      return { path: out, name: 'video-' + stamp + '.mp4', via: 'dash+ffmpeg' };
    }
    return { path: vPath, name: 'video-' + stamp + '.mp4', via: 'dash-video' };
  }

  // 2) m3u8
  const hlsUrl = pick.type === 'hls' ? pick.url : (isM3u8(url) ? url : (manifest && isM3u8(manifest) ? manifest : (isM3u8(pick.url) ? pick.url : '')));
  if (hlsUrl) {
    const playlist = await resolvePlaylist(hlsUrl, Number(pick.height) || 0, signal);
    const workdir = path.join(dir, 'hls-' + crypto.randomBytes(4).toString('hex'));
    const files = await downloadSegments(playlist, workdir, { concurrency: 6, onProgress, signal, headers: pick.headers || headers });
    const out = path.join(dir, 'hls-' + stamp + '.mp4');
    await concatToMp4(files, out, workdir);
    fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
    return { path: out, name: 'video-' + stamp + '.mp4', via: 'hls' };
  }

  // 3) 直链
  if (pick.type === 'file' && pick.url) {
    const out = path.join(dir, 'file-' + stamp + '.mp4');
    await downloadTo(pick.url, out, { headers: pick.headers || headers, onProgress, signal });
    return { path: out, name: 'video-' + stamp + '.mp4', via: 'direct' };
  }

  // 4) yt-dlp
  const status = await ytdlpStatus();
  if (!status.available) {
    throw new Error('需要 yt-dlp 才能下载该站点：请先点页面上的「一键安装 yt-dlp」');
  }
  const target = path.join(dir, 'ytdlp-' + crypto.randomBytes(4).toString('hex'));
  await fsp.mkdir(target, { recursive: true });
  const args = ['--no-playlist', '--no-warnings', '--newline', '-o', path.join(target, '%(title).50s.%(ext)s')];
  if (pick.id) args.push('-f', String(pick.id));
  else args.push('-f', 'bv*+ba/b');
  args.push('--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG, url);
  const r = await runYtdlp(args, { timeout: 3600000, signal });
  if (!r.ok) throw new Error('yt-dlp 下载失败：' + (errLines(r.err) || 'exit ' + r.code));
  const files = await fsp.readdir(target);
  const file = files.find((f) => /\.(mp4|mkv|webm|flv|m4a|mp3)$/i.test(f));
  if (!file) throw new Error('yt-dlp 没有输出文件');
  return { path: path.join(target, file), name: file.replace(/[\\/:*?"<>|]/g, '_'), via: 'yt-dlp' };
}
