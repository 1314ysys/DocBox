/**
 * 视频网站解析：优先 yt-dlp（B 站 / YouTube / 爱奇艺 / 腾讯视频…），
 * 没有 yt-dlp 时退回「页面里找 m3u8 / 直链」+ 自带 HLS 下载器。
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { FFMPEG } from '../config.mjs';
import { isPlaylist, resolvePlaylist, downloadSegments, concatToMp4, parsePlaylist } from './hls.mjs';

const YTDLP = process.env.DOCBOX_YTDLP || 'yt-dlp';
let ytdlpCache;

function run(cmd, args, { timeout = 30000 } = {}) {
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
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, out, err: 'not found' }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err, code }); });
  });
}

export async function ytdlpStatus() {
  if (ytdlpCache !== undefined) return ytdlpCache;
  const r = await run(YTDLP, ['--version'], { timeout: 10000 });
  ytdlpCache = r.ok ? { available: true, version: r.out.trim(), bin: YTDLP } : { available: false, version: null, bin: YTDLP };
  return ytdlpCache;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function siteHint(url) {
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  if (/bilibili|b23\.tv/.test(host)) return '哔哩哔哩';
  if (/youtube|youtu\.be/.test(host)) return 'YouTube';
  if (/iqiyi/.test(host)) return '爱奇艺';
  if (/v\.qq\.com|qq\.com/.test(host)) return '腾讯视频';
  if (/youku/.test(host)) return '优酷';
  if (/mgtv/.test(host)) return '芒果 TV';
  if (/douyin|tiktok/.test(host)) return '抖音';
  return host;
}

/** 从网页 HTML / JS 里搜 m3u8 或直链 */
function scanPage(html, baseUrl) {
  const found = new Set();
  const patterns = [
    /https?:\\?\/\\?\/[^"'\s]+\.m3u8[^"'\s]*/gi,
    /"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi,
    /https?:\\?\/\\?\/[^"'\s]+\.(?:mp4|flv|m4s)[^"'\s]*/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) {
      let u = (m[1] || m[0]).replace(/\\\//g, '/');
      try { u = new URL(u, baseUrl).toString(); } catch { continue; }
      if (/\.(m3u8|mp4|flv|m4s)/i.test(u)) found.add(u);
      if (found.size > 40) break;
    }
  }
  return [...found];
}

/** 解析一个视频页 / 直链，返回可用格式 */
export async function probe(url) {
  const status = await ytdlpStatus();
  const result = { url, site: siteHint(url), ytdlp: status, formats: [], title: '', thumbnail: '', duration: null, kind: 'unknown' };

  if (status.available) {
    const r = await run(YTDLP, ['-J', '--no-warnings', '--no-playlist', '--socket-timeout', '20', url], { timeout: 60000 });
    if (r.ok) {
      try {
        const info = JSON.parse(r.out);
        result.title = info.title || '';
        result.thumbnail = info.thumbnail || '';
        result.duration = info.duration || null;
        result.uploader = info.uploader || info.channel || '';
        result.kind = 'ytdlp';
        const formats = (info.formats || []).map((f) => ({
          id: f.format_id,
          ext: f.ext,
          height: f.height || null,
          fps: f.fps || null,
          vcodec: f.vcodec || '',
          acodec: f.acodec || '',
          filesize: f.filesize || f.filesize_approx || null,
          note: f.format_note || '',
          hasVideo: f.vcodec && f.vcodec !== 'none',
          hasAudio: f.acodec && f.acodec !== 'none',
        }));
        result.formats = formats.filter((f) => f.hasVideo).slice(0, 60);
        result.audioFormats = formats.filter((f) => !f.hasVideo && f.hasAudio).slice(0, 20);
        return result;
      } catch { /* JSON 解析失败，继续走页面扫描 */ }
    } else {
      result.ytdlpError = (r.err || '').trim().split('\n').slice(-2).join(' ');
    }
  }

  // 直链或播放列表
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const ct = res.headers.get('content-type') || '';
  if (isPlaylist(url, ct)) {
    const text = await res.text();
    const parsed = parsePlaylist(text, url);
    result.kind = 'hls';
    result.title = decodeURIComponent((url.split('/').pop() || 'video').split('?')[0]);
    result.formats = parsed.isMaster
      ? parsed.variants.map((v) => ({ id: v.resolution || String(v.bandwidth), ext: 'mp4', height: Number((v.resolution.split('x')[1] || 0)) || null, note: 'HLS ' + (v.resolution || '') + ' ' + Math.round(v.bandwidth / 1000) + 'kbps', url: v.url, hasVideo: true, hasAudio: true }))
      : [{ id: 'hls', ext: 'mp4', height: null, note: 'HLS 单片播放列表（' + parsed.segments.length + ' 片）', url, hasVideo: true, hasAudio: true }];
    return result;
  }

  const html = ct.includes('text/html') ? await res.text() : '';
  const candidates = html ? scanPage(html, url) : [];
  if (candidates.length) {
    result.kind = 'page';
    result.title = (html.match(/<title[^>]*>([^<]{1,120})<\/title>/i) || [])[1] || url;
    result.candidates = candidates.slice(0, 20);
    result.formats = candidates.slice(0, 20).map((u, i) => ({ id: 'c' + i, ext: /\.m3u8/i.test(u) ? 'mp4' : (u.split('.').pop() || 'mp4'), height: null, note: (/\.m3u8/i.test(u) ? 'HLS' : '直链') + ' · ' + u.slice(-48), url: u, hasVideo: true, hasAudio: true }));
    return result;
  }

  result.reason = status.available
    ? ('未解析到可用视频流' + (result.ytdlpError ? '：' + result.ytdlpError : ''))
    : '未检测到 yt-dlp，且页面里没有找到 m3u8 / 直链（B 站/爱奇艺/腾讯/YouTube 需要 yt-dlp 支持）';
  return result;
}

/** 下载：HLS 用自带下载器，直链直接落盘，其它交给 yt-dlp */
export async function download({ url, format, dir, onProgress }) {
  await fsp.mkdir(dir, { recursive: true });
  const status = await ytdlpStatus();
  const safe = (s) => String(s || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

  const isHls = /\.m3u8(\?|$)/i.test(url);
  if (isHls) {
    const playlist = await resolvePlaylist(url, Number(format) || 0);
    const workdir = path.join(dir, 'hls-' + crypto.randomBytes(4).toString('hex'));
    const files = await downloadSegments(playlist, workdir, { concurrency: 6, onProgress: (d, t) => onProgress && onProgress(d, t) });
    const out = path.join(dir, 'hls-' + Date.now() + '.mp4');
    await concatToMp4(files, out, workdir);
    fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
    return { path: out, name: 'video-' + Date.now() + '.mp4', via: 'hls' };
  }

  if (status.available) {
    const target = path.join(dir, 'ytdlp-' + crypto.randomBytes(4).toString('hex'));
    await fsp.mkdir(target, { recursive: true });
    const args = ['--no-playlist', '--no-warnings', '-o', path.join(target, '%(title).50s.%(ext)s')];
    if (format) args.push('-f', format);
    else args.push('-f', 'bv*+ba/b');
    args.push('--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG, url);
    const r = await run(YTDLP, args, { timeout: 3600000 });
    if (!r.ok) throw new Error('yt-dlp 下载失败：' + ((r.err || '').trim().split('\n').slice(-2).join(' ') || 'exit ' + r.code));
    const files = await fsp.readdir(target);
    const file = files.find((f) => /\.(mp4|mkv|webm|flv|m4a|mp3)$/i.test(f));
    if (!file) throw new Error('yt-dlp 没有输出文件');
    return { path: path.join(target, file), name: safe(file), via: 'yt-dlp' };
  }

  // 直链落盘
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error('下载失败：HTTP ' + res.status);
  const out = path.join(dir, 'direct-' + Date.now() + '.mp4');
  const file = await fsp.open(out, 'w');
  let got = 0;
  for await (const chunk of res.body) { await file.write(chunk); got += chunk.length; if (onProgress) onProgress(got, 0); }
  await file.close();
  return { path: out, name: 'video-' + Date.now() + '.mp4', via: 'direct' };
}
