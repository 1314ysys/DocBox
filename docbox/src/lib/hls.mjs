/**
 * HLS（m3u8）解析与下载：主播放列表 → 选码率 → 分片下载（支持 AES-128 加密）→ ffmpeg 合成为 MP4
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { FFMPEG } from '../config.mjs';

export function isPlaylist(url, text) {
  return /\.m3u8(\?|$)/i.test(url) || /^#EXTM3U/m.test(String(text || '').slice(0, 400));
}

export function parsePlaylist(text, baseUrl) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const abs = (u) => new URL(u, baseUrl).toString();
  const variants = [];
  const segments = [];
  let key = null;
  let mediaSequence = 0;
  let isMaster = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      isMaster = true;
      const bw = Number((/#BANDWIDTH=(\d+)/.exec(line) || [])[1] || 0);
      const res = (/RESOLUTION=(\d+x\d+)/.exec(line) || [])[1] || '';
      const codecs = (/CODECS="([^"]+)"/.exec(line) || [])[1] || '';
      const next = lines[i + 1];
      if (next && !next.startsWith('#')) variants.push({ bandwidth: bw, resolution: res, codecs, url: abs(next) });
    } else if (line.startsWith('#EXT-X-KEY')) {
      const method = (/METHOD=([^,]+)/.exec(line) || [])[1] || 'NONE';
      const uri = (/URI="([^"]+)"/.exec(line) || [])[1];
      const iv = (/IV=0x([0-9A-Fa-f]+)/.exec(line) || [])[1];
      key = method === 'NONE' ? null : { method, uri: uri ? abs(uri) : '', iv };
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      mediaSequence = Number(line.split(':')[1] || 0);
    } else if (!line.startsWith('#')) {
      segments.push({ index: segments.length, url: abs(line), key });
    }
  }
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return { isMaster, variants, segments, mediaSequence };
}

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function headersFor(url, extra = {}) {
  let referer = '';
  try { referer = new URL(url).origin + '/'; } catch { /* ignore */ }
  return { 'user-agent': UA, accept: '*/*', ...(referer ? { referer } : {}), ...extra };
}

async function fetchText(url, signal) {
  const res = await fetch(url, { headers: headersFor(url), signal: signal || AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('播放列表请求失败：HTTP ' + res.status);
  return res.text();
}

/** 取最终媒体播放列表（如果是 master，按码率挑一个子列表） */
export async function resolvePlaylist(url, preferHeight = 0, signal) {
  const text = await fetchText(url, signal);
  let parsed = parsePlaylist(text, url);
  if (!parsed.isMaster) return { url, ...parsed };
  if (!parsed.variants.length) throw new Error('主播放列表里没有可用码率');
  const pick = preferHeight
    ? parsed.variants.find((v) => Number((v.resolution.split('x')[1] || 0)) <= preferHeight) || parsed.variants[parsed.variants.length - 1]
    : parsed.variants[0];
  const child = await fetchText(pick.url, signal);
  return { url: pick.url, ...parsePlaylist(child, pick.url), variants: parsed.variants, picked: pick };
}

async function fetchKey(key) {
  const res = await fetch(key.uri, { headers: headersFor(key.uri), signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('密钥请求失败：HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** 下载全部分片到目录，返回分片路径数组（自动解密 AES-128） */
export async function downloadSegments(playlist, dir, { concurrency = 6, onProgress, signal } = {}) {
  await fsp.mkdir(dir, { recursive: true });
  const keys = new Map();
  const total = playlist.segments.length;
  let done = 0;
  const files = new Array(total);
  const queue = [...playlist.segments];

  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (queue.length) {
      const seg = queue.shift();
      const name = 'seg-' + String(seg.index).padStart(5, '0') + '.ts';
      const file = path.join(dir, name);
      if (signal && signal.aborted) throw new Error('已取消');
      const res = await fetch(seg.url, { headers: headersFor(seg.url), signal: signal || AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('分片下载失败：HTTP ' + res.status + ' ' + seg.url);
      let buf = Buffer.from(await res.arrayBuffer());
      if (seg.key && seg.key.method === 'AES-128') {
        const kid = seg.key.uri;
        if (!keys.has(kid)) keys.set(kid, await fetchKey(seg.key));
        const key = keys.get(kid);
        const iv = seg.key.iv
          ? Buffer.from(seg.key.iv, 'hex')
          : Buffer.from(String(playlist.mediaSequence + seg.index).padStart(32, '0'), 'hex');
        const algo = key.length === 16 ? 'aes-128-cbc' : 'aes-256-cbc';
        const d = crypto.createDecipheriv(algo, key, iv);
        buf = Buffer.concat([d.update(buf), d.final()]);
      }
      await fsp.writeFile(file, buf);
      files[seg.index] = file;
      done += 1;
      if (onProgress) onProgress(done, total);
    }
  });
  await Promise.all(workers);
  return files.filter(Boolean);
}

/** 用 ffmpeg 把 ts 分片合成 mp4（-c copy，不重编码） */
export function concatToMp4(files, outPath, workdir) {
  const listFile = path.join(workdir, 'concat.txt');
  return fsp.writeFile(listFile, files.map((f) => "file '" + f.replace(/'/g, "'\\''") + "'").join('\n'), 'utf8').then(() => new Promise((resolve, reject) => {
    const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', outPath];
    const child = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve(outPath);
      reject(new Error('合并失败：' + (err.trim().split('\n').pop() || ('ffmpeg exit ' + code))));
    });
  }));
}
