import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DOCBOX_DIR = path.resolve(__dirname, '..');
export const ROOT = path.resolve(DOCBOX_DIR, '..');
export const PUBLIC_DIR = path.join(DOCBOX_DIR, 'public');
export const UPLOAD_DIR = path.join(DOCBOX_DIR, 'uploads');
export const OUTPUT_DIR = path.join(DOCBOX_DIR, 'outputs');
export const TMP_DIR = path.join(DOCBOX_DIR, 'tmp');
export const CACHE_DIR = path.join(DOCBOX_DIR, '.cache');

export const PORT = Number(process.env.DOCBOX_PORT) || 3000;
export const HOST = process.env.DOCBOX_HOST || '127.0.0.1';
export const STIRLING_BASE = process.env.STIRLING_URL || 'http://127.0.0.1:8090';
export const STIRLING_API = STIRLING_BASE + '/api/v1';
export const STIRLING_TIMEOUT = Number(process.env.STIRLING_TIMEOUT_MS) || 180000;

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

export const EDGE_PROFILE_DIR = path.join(TMP_DIR, 'edge-profile');
export const APP_VERSION = '0.1.0_beta';
