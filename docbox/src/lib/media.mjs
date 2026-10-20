/**
 * 音视频处理引擎：内置 ffmpeg/ffprobe（npm 静态二进制），无需外部服务与端口。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { FFMPEG, FFPROBE, TMP_DIR, MEDIA_TIMEOUT, findFont } from '../config.mjs';

export class MediaError extends Error {}
const fail = (msg) => { throw new MediaError(msg); };

const tick = () => crypto.randomBytes(5).toString('hex');
const tmpFile = (ext) => path.join(TMP_DIR, 'media-' + tick() + '.' + ext);

function exec(bin, args, timeoutMs = MEDIA_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } reject(new MediaError('处理超时（超过 ' + Math.round(timeoutMs / 60000) + ' 分钟），已终止')); }, timeoutMs);
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { err += c.toString(); if (err.length > 200000) err = err.slice(-100000); });
    child.on('error', (e) => { clearTimeout(timer); reject(new MediaError('无法启动 ffmpeg：' + e.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else {
        const tail = err.split(/\r?\n/).filter(Boolean).slice(-4).join(' / ');
        reject(new MediaError('ffmpeg 处理失败（' + code + '）：' + tail.slice(-260)));
      }
    });
  });
}

export async function probe(filePath) {
  const { out } = await exec(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath], 60000);
  return JSON.parse(out || '{}');
}

export function summarizeProbe(info) {
  const v = (info.streams || []).find((s) => s.codec_type === 'video');
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  const fmt = info.format || {};
  const duration = Number(fmt.duration || v?.duration || a?.duration || 0);
  return {
    duration: Math.round(duration * 100) / 100,
    size: Number(fmt.size || 0),
    bitrate: Number(fmt.bit_rate || 0),
    format: fmt.format_name || '',
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: v.avg_frame_rate || v.r_frame_rate, pixFmt: v.pix_fmt } : null,
    audio: a ? { codec: a.codec_name, channels: a.channels, sampleRate: a.sample_rate, bitrate: Number(a.bit_rate || 0) } : null,
  };
}

const AUDIO_CODEC = {
  mp3: ['-c:a', 'libmp3lame'],
  wav: ['-c:a', 'pcm_s16le'],
  aac: ['-c:a', 'aac'],
  m4a: ['-c:a', 'aac'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis'],
  opus: ['-c:a', 'libopus'],
};

const VIDEO_CODEC = {
  mp4: { v: ['-c:v', 'libx264'], a: ['-c:a', 'aac', '-b:a', '160k'], ext: 'mp4' },
  mkv: { v: ['-c:v', 'libx264'], a: ['-c:a', 'aac', '-b:a', '160k'], ext: 'mkv' },
  mov: { v: ['-c:v', 'libx264'], a: ['-c:a', 'aac', '-b:a', '160k'], ext: 'mov' },
  webm: { v: ['-c:v', 'libvpx-vp9', '-b:v', '0'], a: ['-c:a', 'libopus', '-b:a', '96k'], ext: 'webm' },
};

const baseOf = (name) => String(name || 'media').replace(/\.[^.]+$/, '').replace(/\s+/g, '_').slice(0, 70) || 'media';

function escapeDrawText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
}

const POS = {
  tl: 'x=24:y=24',
  tr: 'x=w-tw-24:y=24',
  bl: 'x=24:y=h-th-24',
  br: 'x=w-tw-24:y=h-th-24',
  center: 'x=(w-tw)/2:y=(h-th)/2',
};

function outMeta(id, file, ext) {
  return { name: baseOf(file) + '_' + id.replace(/^media-/, '') + '.' + ext };
}

async function convert(file, f) {
  const out = tmpFile(f.format || 'mp4');
  const codec = VIDEO_CODEC[f.format] || VIDEO_CODEC.mp4;
  const crf = Math.max(16, Math.min(32, Number(f.crf) || 23));
  await exec(FFMPEG, ['-y', '-i', file.path, ...codec.v, '-crf', String(crf), '-preset', f.preset || 'medium', ...codec.a, out]);
  return { outputs: [{ ...outMeta('media-convert', file.name, codec.ext), path: out }], note: '已转码为 ' + codec.ext.toUpperCase() + '（CRF ' + crf + '）' };
}

async function compress(file, f) {
  const out = tmpFile('mp4');
  const crf = Math.max(20, Math.min(36, Number(f.crf) || 28));
  const args = ['-y', '-i', file.path];
  if (f.resolution && f.resolution !== 'original') args.push('-vf', 'scale=-2:' + f.resolution);
  args.push('-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', out);
  await exec(FFMPEG, args);
  return { outputs: [{ ...outMeta('media-compress', file.name, 'mp4'), path: out }], note: '已压缩（CRF ' + crf + (f.resolution !== 'original' ? '，' + f.resolution + 'p' : '') + '）' };
}

async function extractAudio(file, f) {
  const ext = f.format || 'mp3';
  const out = tmpFile(ext);
  const args = ['-y', '-i', file.path, '-vn', ...(AUDIO_CODEC[ext] || AUDIO_CODEC.mp3), '-b:a', (f.bitrate || 192) + 'k', out];
  await exec(FFMPEG, args);
  return { outputs: [{ ...outMeta('media-extract-audio', file.name, ext), path: out }], note: '已提取音频为 ' + ext.toUpperCase() };
}

async function audioConvert(file, f) {
  const ext = f.format || 'mp3';
  const out = tmpFile(ext);
  const args = ['-y', '-i', file.path, ...(AUDIO_CODEC[ext] || AUDIO_CODEC.mp3), '-b:a', (f.bitrate || 192) + 'k'];
  if (f.samplerate && f.samplerate !== 'keep') args.push('-ar', f.samplerate);
  args.push(out);
  await exec(FFMPEG, args);
  return { outputs: [{ ...outMeta('media-audio-convert', file.name, ext), path: out }], note: '已转为 ' + ext.toUpperCase() };
}

async function trim(file, f) {
  const ext = (file.name.match(/\.([^.]+)$/) || [, 'mp4'])[1].toLowerCase();
  const out = tmpFile(ext);
  const start = Math.max(0, Number(f.start) || 0);
  const end = Number(f.end) || 0;
  const args = ['-y', '-ss', String(start), '-i', file.path];
  if (end > start) args.push('-to', String(end));
  if (f.reencode === 'false') args.push('-c', 'copy');
  else args.push('-c:v', 'libx264', '-crf', '20', '-c:a', 'aac');
  args.push(out);
  await exec(FFMPEG, args);
  return { outputs: [{ ...outMeta('media-trim', file.name, ext), path: out }], note: '已截取 ' + start + 's → ' + (end > start ? end + 's' : '结尾') };
}

async function merge(files, f) {
  const fmt = (f.format || 'mp4').toLowerCase();
  const isAudio = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'opus'].includes(fmt);
  const ext = fmt;
  const out = tmpFile(ext);
  const list = tmpFile('txt');
  await fsp.writeFile(list, files.map((x) => "file '" + x.path.replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
  if (isAudio) {
    await exec(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, ...(AUDIO_CODEC[ext] || AUDIO_CODEC.mp3), out]);
  } else {
    const codec = VIDEO_CODEC[fmt] || VIDEO_CODEC.mp4;
    try {
      await exec(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
    } catch {
      await exec(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, ...codec.v, '-crf', '22', ...codec.a, out]);
    }
  }
  await fsp.rm(list, { force: true });
  return { outputs: [{ ...outMeta('media-merge', files[0].name, ext), path: out }], note: '已合并 ' + files.length + ' 个文件' };
}

async function gif(file, f) {
  const out = tmpFile('gif');
  const fps = Number(f.fps) || 12;
  const width = Math.max(120, Math.min(1280, Number(f.width) || 480));
  const start = Math.max(0, Number(f.start) || 0);
  const duration = Math.max(0.5, Math.min(60, Number(f.duration) || 5));
  const filter = 'fps=' + fps + ',scale=' + width + ':-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse';
  await exec(FFMPEG, ['-y', '-ss', String(start), '-t', String(duration), '-i', file.path, '-vf', filter, '-loop', '0', out]);
  return { outputs: [{ ...outMeta('media-gif', file.name, 'gif'), path: out }], note: '已生成 GIF（' + duration + 's / ' + fps + 'fps）' };
}

async function frame(file, f) {
  const ext = f.format === 'jpg' ? 'jpg' : 'png';
  const out = tmpFile(ext);
  await exec(FFMPEG, ['-y', '-ss', String(Math.max(0, Number(f.time) || 0)), '-i', file.path, '-frames:v', '1', '-q:v', '2', out]);
  return { outputs: [{ ...outMeta('media-frame', file.name, ext), path: out }], note: '已截取第 ' + (f.time || 0) + ' 秒画面' };
}

async function resize(file, f) {
  const ext = (file.name.match(/\.([^.]+)$/) || [, 'mp4'])[1].toLowerCase();
  const out = tmpFile(ext === 'webm' ? 'webm' : 'mp4');
  const w = Math.max(64, Number(f.width) || 1280);
  const h = Number(f.height) > 0 ? Number(f.height) : -2;
  await exec(FFMPEG, ['-y', '-i', file.path, '-vf', 'scale=' + w + ':' + h, '-c:v', 'libx264', '-crf', '22', '-c:a', 'aac', out]);
  return { outputs: [{ ...outMeta('media-resize', file.name, 'mp4'), path: out }], note: '已调整为 ' + w + '×' + (h === -2 ? '自动' : h) };
}

function atempoChain(factor) {
  const parts = [];
  let x = factor;
  while (x > 2) { parts.push('atempo=2.0'); x /= 2; }
  while (x < 0.5) { parts.push('atempo=0.5'); x /= 0.5; }
  parts.push('atempo=' + x.toFixed(3));
  return parts.join(',');
}

async function speed(file, f) {
  const factor = Math.max(0.25, Math.min(4, Number(f.factor) || 1.5));
  const out = tmpFile('mp4');
  const info = await probe(file.path).catch(() => ({}));
  const hasAudio = (info.streams || []).some((s) => s.codec_type === 'audio');
  const args = ['-y', '-i', file.path, '-vf', 'setpts=' + (1 / factor).toFixed(4) + '*PTS'];
  if (hasAudio) args.push('-af', atempoChain(factor), '-c:a', 'aac');
  else args.push('-an');
  args.push('-c:v', 'libx264', '-crf', '22', out);
  await exec(FFMPEG, args);
  return { outputs: [{ ...outMeta('media-speed', file.name, 'mp4'), path: out }], note: '已变速为 ' + factor + '×' };
}

async function volume(file, f) {
  const ext = (file.name.match(/\.([^.]+)$/) || [, 'mp3'])[1].toLowerCase();
  const out = tmpFile(ext);
  const filter = f.mode === 'gain' ? 'volume=' + (Number(f.gain) || 0) + 'dB' : 'loudnorm=I=-16:TP=-1.5:LRA=11';
  await exec(FFMPEG, ['-y', '-i', file.path, '-af', filter, '-vn', ...(AUDIO_CODEC[ext] ? AUDIO_CODEC[ext] : ['-c:a', 'libmp3lame']), out]);
  return { outputs: [{ ...outMeta('media-volume', file.name, ext), path: out }], note: f.mode === 'gain' ? '已调整音量 ' + (Number(f.gain) || 0) + ' dB' : '已完成响度标准化' };
}

async function muteTool(file) {
  const out = tmpFile('mp4');
  await exec(FFMPEG, ['-y', '-i', file.path, '-an', '-c:v', 'copy', out]);
  return { outputs: [{ ...outMeta('media-mute', file.name, 'mp4'), path: out }], note: '已移除音轨' };
}

async function rotateTool(file, f) {
  const out = tmpFile('mp4');
  const map = { cw90: 'transpose=1', ccw90: 'transpose=2', '180': 'transpose=1,transpose=1', flipH: 'hflip', flipV: 'vflip' };
  await exec(FFMPEG, ['-y', '-i', file.path, '-vf', map[f.mode] || 'transpose=1', '-c:a', 'copy', '-c:v', 'libx264', '-crf', '22', out]);
  return { outputs: [{ ...outMeta('media-rotate', file.name, 'mp4'), path: out }], note: '已应用 ' + (f.mode || 'cw90') };
}

async function watermark(file, f, extra) {
  const out = tmpFile('mp4');
  const opacity = Math.max(0.05, Math.min(1, Number(f.opacity) || 0.35));
  const size = Math.max(10, Math.min(120, Number(f.fontsize) || 32));
  let filter;
  if (extra && extra.path) {
    const pos = { tl: '24:24', tr: 'W-w-24:24', bl: '24:H-h-24', br: 'W-w-24:H-h-24', center: '(W-w)/2:(H-h)/2' }[f.position || 'br'];
    filter = '[1:v]format=rgba,colorchannelmixer=aa=' + opacity + '[wm];[0:v][wm]overlay=' + pos;
  } else {
    const font = findFont();
    if (!font) fail('未找到中文字体，无法绘制文字水印');
    filter = 'drawtext=fontfile=\'' + font.replace(/\\/g, '/').replace(/:/g, '\\:') + '\':text=\'' + escapeDrawText(f.text || 'DocBox') + "\':fontsize=" + size + ':fontcolor=white@' + opacity + ':' + (POS[f.position] || POS.br) + ':borderw=1:bordercolor=black@0.35';
  }
  await exec(FFMPEG, ['-y', '-i', file.path, ...(extra && extra.path ? ['-i', extra.path] : []), '-filter_complex', filter, '-c:a', 'copy', '-c:v', 'libx264', '-crf', '22', out]);
  return { outputs: [{ ...outMeta('media-watermark', file.name, 'mp4'), path: out }], note: '已添加水印' };
}

async function slideshow(files, f) {
  const out = tmpFile('mp4');
  const per = Math.max(0.5, Math.min(30, Number(f.duration) || 2));
  const width = Math.max(128, Number(f.width) || 1280);
  const list = tmpFile('txt');
  const lines = [];
  for (const file of files) {
    lines.push("file '" + file.path.replace(/'/g, "'\\''") + "'");
    lines.push('duration ' + per);
  }
  lines.push("file '" + files[files.length - 1].path.replace(/'/g, "'\\''") + "'");
  await fsp.writeFile(list, lines.join('\n'), 'utf8');
  await exec(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', "scale=w='min(iw," + width + ")':h=-2,format=yuv420p", '-r', '30', '-c:v', 'libx264', '-crf', '22', out]);
  await fsp.rm(list, { force: true });
  return { outputs: [{ ...outMeta('media-slideshow', files[0].name, 'mp4'), path: out }], note: '已生成 ' + files.length + ' 张图片的轮播视频（每张 ' + per + 's）' };
}

async function fade(file, f) {
  const info = summarizeProbe(await probe(file.path));
  const dur = Math.max(0.1, Number(info.duration) || 10);
  const d = Math.max(0.2, Math.min(10, Number(f.duration) || 1.5));
  const out = tmpFile('mp4');
  const args = ['-y', '-i', file.path];
  const vf = [];
  const af = [];
  if (f.type !== 'audio') vf.push('fade=t=in:st=0:d=' + d, 'fade=t=out:st=' + Math.max(0, dur - d).toFixed(2) + ':d=' + d);
  if (f.type !== 'video' && info.audio) af.push('afade=t=in:st=0:d=' + d, 'afade=t=out:st=' + Math.max(0, dur - d).toFixed(2) + ':d=' + d);
  if (vf.length) args.push('-vf', vf.join(','));
  if (af.length) args.push('-af', af.join(','));
  args.push('-c:v', 'libx264', '-crf', '22', '-c:a', 'aac', out);
  await exec(FFMPEG, args);
  return { outputs: [{ ...outMeta('media-fade', file.name, 'mp4'), path: out }], note: '已添加 ' + d + 's 淡入淡出' };
}

async function stripMeta(file) {
  const ext = (file.name.match(/\.([^.]+)$/) || [, 'mp4'])[1].toLowerCase();
  const out = tmpFile(ext);
  await exec(FFMPEG, ['-y', '-i', file.path, '-map_metadata', '-1', '-c', 'copy', out]);
  return { outputs: [{ ...outMeta('media-strip-meta', file.name, ext), path: out }], note: '已清除元数据' };
}

const IMPL = {
  'convert': convert,
  'compress': compress,
  'extract-audio': extractAudio,
  'audio-convert': audioConvert,
  'trim': trim,
  'merge': merge,
  'gif': gif,
  'frame': frame,
  'resize': resize,
  'speed': speed,
  'volume': volume,
  'mute': muteTool,
  'rotate': rotateTool,
  'watermark': watermark,
  'slideshow': slideshow,
  'fade': fade,
  'strip-meta': stripMeta,
};

export const MEDIA_TOOL_IDS = [...Object.keys(IMPL), 'probe'];

export async function runMediaTool(id, files, fields) {
  if (!files || !files.length) fail('请先选择音视频文件');
  if (id === 'probe') {
    const info = await probe(files[0].path);
    return { data: { file: files[0].name, ...summarizeProbe(info), raw: info }, note: files[0].name };
  }
  const fn = IMPL[id];
  if (!fn) fail('未知的音视频工具：' + id);
  const file = files[0];
  if (id === 'merge' || id === 'slideshow') return fn(files, fields || {});
  if (id === 'watermark') return fn(file, fields || {}, files[1] || null);
  return fn(file, fields || {});
}

export async function mediaHealth() {
  try {
    const { err } = await exec(FFMPEG, ['-version'], 15000);
    const line = err.split(/\r?\n/)[0] || '';
    return { ok: true, path: FFMPEG, version: (line.match(/version\s+(\S+)/) || [])[1] || 'unknown', probe: FFPROBE };
  } catch (e) {
    return { ok: false, path: FFMPEG, error: String(e.message || e) };
  }
}

export async function cleanupMediaFiles(paths) {
  for (const p of paths) await fsp.rm(p, { force: true }).catch(() => {});
}

export { fs };
