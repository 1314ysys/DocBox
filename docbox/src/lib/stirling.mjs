import fsp from 'node:fs/promises';
import path from 'node:path';
import { STIRLING_API, STIRLING_BASE, STIRLING_TIMEOUT } from '../config.mjs';

const MIME_BY_EXT = {
  pdf: 'application/pdf', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8', csv: 'text/csv; charset=utf-8',
};

export function mimeFor(ext) {
  return MIME_BY_EXT[String(ext || '').toLowerCase().replace('.', '')] || 'application/octet-stream';
}

export async function stirlingHealth(timeoutMs = 2500) {
  try {
    const res = await fetch(STIRLING_API + '/info/status', { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { online: false, status: res.status, version: null };
    const data = await res.json().catch(() => ({}));
    return { online: true, status: res.status, version: data.version || null, state: data.status || null };
  } catch {
    return { online: false, version: null };
  }
}

function guessExtFromType(ct) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('pdf')) return 'pdf';
  if (t.includes('zip')) return 'zip';
  if (t.includes('json')) return 'json';
  if (t.includes('text/plain')) return 'txt';
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('webp')) return 'webp';
  return null;
}

function sniffExt(buf) {
  if (!buf || buf.length < 5) return null;
  const head = buf.subarray(0, 5).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
  if (buf[0] === 0x7b || buf[0] === 0x5b) return 'json';
  return null;
}

/**
 * 调用 Stirling 接口并返回二进制结果。
 * files: [{ field, path, name?, type? }]
 */
export async function callStirling(routePath, { files = [], fields = {}, timeoutMs = STIRLING_TIMEOUT } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null) continue;
    form.append(key, String(value));
  }
  for (const file of files) {
    const buf = await fsp.readFile(file.path);
    const name = file.name || path.basename(file.path);
    const type = file.type || (name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    form.append(file.field || 'fileInput', new Blob([buf], { type }), name);
  }
  let res;
  try {
    res = await fetch(STIRLING_API + routePath, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return { ok: false, status: 0, error: '无法连接 Stirling-PDF（' + (err?.message || '请求失败') + '）' };
  }
  const contentType = res.headers.get('content-type') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    let detail = buffer.toString('utf8').slice(0, 300);
    try {
      const json = JSON.parse(detail);
      detail = json.message || json.error || json.detail || detail;
    } catch { /* keep raw */ }
    return { ok: false, status: res.status, error: detail || ('Stirling 返回 HTTP ' + res.status), contentType };
  }
  const ext = guessExtFromType(contentType) || sniffExt(buffer) || 'bin';
  return { ok: true, status: res.status, buffer, contentType, ext };
}

export async function stirlingInfo() {
  const health = await stirlingHealth();
  return { ...health, base: STIRLING_BASE, api: STIRLING_API };
}
