/**
 * 视频网站解析与下载（统一入口）
 *
 * 解析顺序（网页 -> m3u8 -> 下载 融合成一条链路）：
 *   1) 链接本身就是 m3u8 播放列表  -> 解析 master/meida，枚举码率
 *   2) yt-dlp 可用                 -> -J 拿信息，优先取其中的 m3u8 流，再交给自带 HLS 下载器
 *   3) 普通网页                    -> 抓 HTML/内嵌 iframe，正则找出 m3u8 / 直链，再解析 m3u8
 *
 * 下载：m3u8 一律走内置 HLS 下载器（分片并发 + AES-128 + ffmpeg 合成）；
 *       其它交给 yt-dlp；都没有时按直链流式落盘。
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { FFMPEG } from '../config.mjs';
import { isPlaylist, resolvePlaylist, downloadSegments, concatToMp4, parsePlaylist, UA } from './hls.mjs';

const YTDLP = process.env.DOCBOX_YTDLP || 'yt-dlp';
let ytdlpCache;

function run(cmd, args, { timeout = 30000, signal } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
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

export async function ytdlpStatus() {
  if (ytdlpCache !== undefined) return ytdlpCache;
  const r = await run(YTDLP, ['--version'], { timeout: 10000 });
  ytdlpCache = r.ok ? { available: true, version: r.out.trim(), bin: YTDLP } : { available: false, version: null, bin: YTDLP };
  return ytdlpCache;
}

export function siteHint(url) {
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  if (/bilibili|b23\.tv/.test(host)) return '哔哩哔哩';
  if (/youtube|youtu\.be/.test(host)) return 'YouTube';
  if (/iqiyi/.test(host)) return '爱奇艺';
  if (/v\.qq\.com|qq\.com/.test(host)) return '腾讯视频';
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
    /["'](?:url|src|playurl|m3u8|hls|video_url)["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/gi,
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
  // m3u8 优先
  return [...found.values()].sort((a, b) => (a.type === 'hls' ? -1 : 1) - (b.type === 'hls' ? -1 : 1));
}

/** 找出页面里的 iframe（可能藏着播放器） */
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
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' },
    redirect: 'follow',
    signal: signal || AbortSignal.timeout(30000),
  });
  const ct = res.headers.get('content-type') || '';
  if (isPlaylist(url, ct)) return { kind: 'hls', res };
  if (!ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('javascript')) {
    return { kind: 'binary', res };
  }
  return { kind: 'html', res, html: await res.text() };
}

function hlsFormats(parsed) {
  if (parsed.isMaster && parsed.variants.length) {
    return parsed.variants.map((v) => ({
      id: v.url,
      ext: 'mp4',
      height: Number((v.resolution.split('x')[1] || 0)) || null,
      note: 'HLS ' + (v.resolution || 'auto') + ' ' + Math.round(v.bandwidth / 1000) + 'kbps',
      type: 'hls',
      url: v.url,
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
    hasVideo: true,
    hasAudio: true,
  }];
}

/**
 * 统一解析：网页 -> m3u8 -> 码率列表
 * 返回 { kind, engine, title, site, thumbnail, duration, formats, streams, ytdlp }
 */
export async function resolveSource(url, { preferHeight = 0, signal, depth = 0 } = {}) {
  const info = {
    url, site: siteHint(url), title: '', thumbnail: '', duration: null, uploader: '',
    kind: 'unknown', engine: '', formats: [], streams: [], ytdlp: await ytdlpStatus(),
  };

  // 1) 直接给的就是 m3u8
  if (isM3u8(url)) {
    const parsed = await resolvePlaylist(url, preferHeight, signal);
    info.kind = 'hls';
    info.engine = 'hls';
    info.title = decodeURIComponent((url.split('?')[0].split('/').pop() || 'video'));
    info.formats = hlsFormats({ ...parsed, url });
    info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note, height: f.height }));
    return info;
  }

  // 2) yt-dlp：优先用它找到站内 m3u8，再交给自带下载器
  if (info.ytdlp.available) {
    const r = await run(YTDLP, ['-J', '--no-warnings', '--no-playlist', '--socket-timeout', '20', url], { timeout: 90000, signal });
    if (r.ok) {
      try {
        const meta = JSON.parse(r.out);
        info.title = meta.title || '';
        info.thumbnail = meta.thumbnail || '';
        info.duration = meta.duration || null;
        info.uploader = meta.uploader || meta.channel || '';
        info.kind = 'ytdlp';
        info.engine = 'yt-dlp';
        const list = meta.formats || [];
        const hlsEntry = list.filter((f) => /m3u8/i.test(String(f.protocol || '')) && f.url);
        if (hlsEntry.length) {
          // 有站内 m3u8：枚举码率，下载走 HLS 引擎
          const best = hlsEntry.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
          try {
            const parsed = await resolvePlaylist(best.url, preferHeight, signal);
            info.formats = hlsFormats({ ...parsed, url: best.url });
            info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note, height: f.height }));
            info.hls = true;
            info.manifest = best.url;
            return info;
          } catch { /* m3u8 打不开就退回 yt-dlp 直链 */ }
        }
        info.formats = list
          .filter((f) => f.format_id)
          .map((f) => ({
            id: f.format_id,
            ext: f.ext,
            height: f.height || null,
            fps: f.fps || null,
            note: f.format_note || (f.vcodec && f.vcodec !== 'none' ? 'video' : 'audio'),
            filesize: f.filesize || f.filesize_approx || null,
            type: 'file',
            url: f.url || '',
            hasVideo: Boolean(f.vcodec && f.vcodec !== 'none'),
            hasAudio: Boolean(f.acodec && f.acodec !== 'none'),
          }))
          .filter((f) => f.hasVideo)
          .slice(0, 60);
        info.streams = info.formats.map((f) => ({ type: 'file', formatId: f.id, label: (f.height ? f.height + 'P' : f.note), url: '' }));
        return info;
      } catch { /* JSON 坏了继续走网页扫描 */ }
    } else {
      info.ytdlpError = (r.err || '').trim().split('\n').slice(-2).join(' ');
    }
  }

  // 3) 网页：找 m3u8 / 直链（含一层 iframe）
  const page = await fetchPage(url, signal);
  if (page.kind === 'hls') {
    const parsed = await resolvePlaylist(url, preferHeight, signal);
    info.kind = 'hls';
    info.engine = 'hls';
    info.formats = hlsFormats({ ...parsed, url });
    info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note, height: f.height }));
    return info;
  }

  let candidates = page.kind === 'html' ? scanPage(page.html, url) : [];
  info.title = (String(page.html || '').match(/<title[^>]*>([^<]{1,120})<\/title>/i) || [])[1] || '';

  if (!candidates.length && page.kind === 'html' && depth < 2) {
    for (const frame of scanFrames(page.html, url)) {
      try {
        const child = await resolveSource(frame, { preferHeight, signal, depth: depth + 1 });
        if (child.formats && child.formats.length) {
          info.kind = 'embed';
          info.engine = child.engine;
          info.formats = child.formats;
          info.streams = child.streams;
          info.embedFrom = frame;
          info.title = info.title || child.title;
          return info;
        }
      } catch { /* 下一个 */ }
    }
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
        info.streams = info.formats.map((f) => ({ type: 'hls', url: f.url, label: f.note, height: f.height }));
        info.candidates = candidates.slice(0, 10).map((c) => c.url);
        return info;
      } catch (e) {
        info.hlsError = e.message;
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

  info.reason = info.ytdlp.available
    ? ('未解析到可用视频流' + (info.ytdlpError ? '：' + info.ytdlpError : '（页面里没有 m3u8，可能是登录态/地区限制/需要 JS 渲染）'))
    : '未检测到 yt-dlp，且页面里没有找到 m3u8 / 直链（B 站/爱奇艺/腾讯/YouTube 需要 yt-dlp 支持）';
  return info;
}

/** 兼容旧调用 */
export async function probe(url) {
  const info = await resolveSource(url);
  info.formats = info.formats || [];
  return info;
}

/**
 * 下载：优先走 m3u8（自带 HLS 引擎），其次 yt-dlp，最后直链。
 * onProgress(done, total) 用于进度上报；signal 用于任务取消。
 */
export async function download({ url, format, dir, onProgress, signal, manifest }) {
  await fsp.mkdir(dir, { recursive: true });
  const status = await ytdlpStatus();
  const clean = (s) => String(s || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

  // 1) m3u8（含通过 format 传进来的子播放列表地址）
  const hlsUrl = isM3u8(url) ? url : (isM3u8(format) ? format : (manifest && isM3u8(manifest) ? manifest : ''));
  if (hlsUrl) {
    const playlist = await resolvePlaylist(hlsUrl, Number(format) || 0, signal);
    const workdir = path.join(dir, 'hls-' + crypto.randomBytes(4).toString('hex'));
    const files = await downloadSegments(playlist, workdir, { concurrency: 6, onProgress, signal });
    const out = path.join(dir, 'hls-' + Date.now() + '.mp4');
    await concatToMp4(files, out, workdir);
    fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
    return { path: out, name: 'video-' + Date.now() + '.mp4', via: 'hls' };
  }

  // 2) yt-dlp
  if (status.available) {
    const target = path.join(dir, 'ytdlp-' + crypto.randomBytes(4).toString('hex'));
    await fsp.mkdir(target, { recursive: true });
    const args = ['--no-playlist', '--no-warnings', '--newline', '-o', path.join(target, '%(title).50s.%(ext)s')];
    if (format && format !== 'auto') args.push('-f', format);
    else args.push('-f', 'bv*+ba/b');
    args.push('--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG, url);
    const r = await run(YTDLP, args, { timeout: 3600000, signal });
    if (!r.ok) throw new Error('yt-dlp 下载失败：' + ((r.err || '').trim().split('\n').slice(-2).join(' ') || 'exit ' + r.code));
    const files = await fsp.readdir(target);
    const file = files.find((f) => /\.(mp4|mkv|webm|flv|m4a|mp3)$/i.test(f));
    if (!file) throw new Error('yt-dlp 没有输出文件');
    return { path: path.join(target, file), name: clean(file), via: 'yt-dlp' };
  }

  // 3) 直链
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: signal || AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error('下载失败：HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  const out = path.join(dir, 'direct-' + Date.now() + '.mp4');
  const fh = await fsp.open(out, 'w');
  let got = 0;
  for await (const chunk of res.body) {
    await fh.write(chunk);
    got += chunk.length;
    if (onProgress) onProgress(got, total);
  }
  await fh.close();
  return { path: out, name: 'video-' + Date.now() + '.mp4', via: 'direct' };
}
