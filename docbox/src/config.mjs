import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const DOCBOX_DIR = path.resolve(__dirname, '..');
export const ROOT = path.resolve(DOCBOX_DIR, '..');
export const PUBLIC_DIR = path.join(DOCBOX_DIR, 'public');
export const UPLOAD_DIR = path.join(DOCBOX_DIR, 'uploads');
export const OUTPUT_DIR = path.join(DOCBOX_DIR, 'outputs');
export const TMP_DIR = path.join(DOCBOX_DIR, 'tmp');
export const CACHE_DIR = path.join(DOCBOX_DIR, '.cache');

export const PORT = Number(process.env.DOCBOX_PORT) || 3000;
export const HOST = process.env.DOCBOX_HOST || '127.0.0.1';
export const APP_VERSION = '0.1.4';

// ---------------------------------------------------------------- 本地数据库
export const DB = {
  host: process.env.DOCBOX_DB_HOST || '127.0.0.1',
  port: Number(process.env.DOCBOX_DB_PORT) || 3306,
  user: process.env.DOCBOX_DB_USER || 'root',
  password: process.env.DOCBOX_DB_PASSWORD ?? 'root',
  database: process.env.DOCBOX_DB_NAME || 'docbox',
  connectionLimit: 6,
};

// ---------------------------------------------------------------- 字体 / 浏览器
export const FONT_CANDIDATES = [
  path.join(ROOT, 'fonts', 'SourceHanSansSC-Regular.otf'),
  path.join(ROOT, 'fonts', 'simhei.ttf'),
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/Deng.ttf',
  'C:/Windows/Fonts/msyh.ttc',
];
export const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

export const LIMITS = { fileSize: 200 * 1024 * 1024, files: 40 };

for (const dir of [UPLOAD_DIR, OUTPUT_DIR, TMP_DIR, CACHE_DIR]) fs.mkdirSync(dir, { recursive: true });

export function findFont() {
  for (const f of FONT_CANDIDATES) {
    try { if (fs.existsSync(f)) return f; } catch { /* ignore */ }
  }
  return null;
}

export function findEdge() {
  for (const f of EDGE_CANDIDATES) {
    try { if (fs.existsSync(f)) return f; } catch { /* ignore */ }
  }
  return null;
}

// ---------------------------------------------------------------- 音视频引擎
function resolveBin(pkg, fallbackName) {
  try {
    const mod = require(pkg);
    const p = typeof mod === 'string' ? mod : mod.path;
    if (p && fs.existsSync(p)) return p;
  } catch { /* ignore */ }
  return fallbackName;
}
export const FFMPEG = process.env.DOCBOX_FFMPEG || resolveBin('@ffmpeg-installer/ffmpeg', 'ffmpeg');
export const FFPROBE = process.env.DOCBOX_FFPROBE || resolveBin('@ffprobe-installer/ffprobe', 'ffprobe');
export const MEDIA_TIMEOUT = Number(process.env.DOCBOX_MEDIA_TIMEOUT_MS) || 20 * 60 * 1000;

export const EDGE_PROFILE_DIR = path.join(TMP_DIR, 'edge-profile');
