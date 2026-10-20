#!/usr/bin/env node
/**
 * 安装 / 升级 yt-dlp（服务端用）
 *   node scripts/fetch-ytdlp.mjs           # 优先 pip，失败再下官方单文件
 *   node scripts/fetch-ytdlp.mjs --binary  # 直接下官方单文件到 docbox/bin/
 */
import { installYtdlp, ytdlpStatus } from '../src/lib/video.mjs';

const wantBinary = process.argv.includes('--binary');
const before = await ytdlpStatus(true);
console.log(before.available ? '当前 yt-dlp：' + before.version + '（' + before.bin + '）' : '当前未检测到 yt-dlp');

if (wantBinary || !before.available) {
  const r = await installYtdlp();
  for (const s of r.steps || []) console.log(' -', s.via, s.ok ? '成功' : '失败', s.detail || '');
  console.log(r.ok ? '安装完成：yt-dlp ' + (r.version || '') + '（' + r.via + '）' : '安装失败：' + (r.hint || ''));
} else {
  console.log('已安装，无需处理。要强制升级：node scripts/fetch-ytdlp.mjs --binary');
}
process.exit(0);
