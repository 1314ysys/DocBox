import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { OUTPUT_DIR, UPLOAD_DIR, TMP_DIR } from '../config.mjs';

export function decodeOriginalName(name = '') {
  if (!name) return 'file';
  try {
    const buf = Buffer.from(name, 'latin1');
    const utf8 = buf.toString('utf8');
    if (Buffer.from(utf8, 'utf8').equals(buf)) return utf8;
  } catch { /* ignore */ }
  return name;
}

export function safeName(name) {
  const base = path.basename(decodeOriginalName(name)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (!base || base === '.' || base === '..') return 'file';
  return base;
}

export function baseName(name) {
  return safeName(name).replace(/\.[^.]+$/, '') || 'file';
}

export function extName(name) {
  return (path.extname(safeName(name)) || '').toLowerCase();
}

function uniqueName(name, used) {
  let candidate = safeName(name || 'output.bin');
  let n = 1;
  while (used.has(candidate.toLowerCase())) {
    const ext = path.extname(candidate);
    const stem = candidate.slice(0, candidate.length - ext.length);
    candidate = stem + '_' + n++ + ext;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function saveOutputs(items) {
  const token = crypto.randomBytes(8).toString('hex');
  const dir = path.join(OUTPUT_DIR, token);
  await fsp.mkdir(dir, { recursive: true });
  const used = new Set();
  const files = [];
  for (const item of items) {
    const name = uniqueName(item.name || 'output.bin', used);
    await fsp.writeFile(path.join(dir, name), item.buffer);
    files.push({
      name,
      size: item.buffer.length,
      url: '/files/' + token + '/' + encodeURIComponent(name),
      kind: item.kind || '',
    });
  }
  return files;
}

export async function zipFiles(items) {
  const zip = new JSZip();
  const used = new Set();
  for (const item of items) zip.file(uniqueName(item.name, used), item.buffer);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function sendResult(res, items, note = '') {
  const list = items.filter(Boolean);
  let files;
  if (list.length > 1) {
    const zip = await zipFiles(list);
    files = await saveOutputs([{ name: 'DocBox_' + list.length + '个文件.zip', buffer: zip, kind: 'zip' }]);
  } else {
    files = await saveOutputs(list);
  }
  res.json({ ok: true, files, note });
}

export function cleanupUploads(req) {
  const groups = req.files && !Array.isArray(req.files) ? Object.values(req.files) : [req.files || []];
  for (const group of groups) for (const f of group || []) fsp.unlink(f.path).catch(() => {});
  if (req.file) fsp.unlink(req.file.path).catch(() => {});
}

export function cleanupUploadsList(files) {
  for (const f of files || []) fsp.unlink(f.path).catch(() => {});
}

export function fileSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

export async function cleanupOld(dir, maxAgeMs) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const now = Date.now();
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        const st = await fsp.stat(p);
        if (now - st.mtimeMs > maxAgeMs) await fsp.rm(p, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export async function cleanupRuntime() {
  await cleanupOld(UPLOAD_DIR, 0);
  await cleanupOld(TMP_DIR, 0);
  await cleanupOld(OUTPUT_DIR, 6 * 60 * 60 * 1000);
}
