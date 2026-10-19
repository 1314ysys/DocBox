import fsp from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { findFont } from '../config.mjs';

export async function loadPdf(buffer, ignoreEncryption = true) {
  return PDFDocument.load(buffer, { ignoreEncryption, updateMetadata: false });
}

export async function embedCjkFont(doc) {
  const file = findFont();
  if (!file) return null;
  try {
    doc.registerFontkit(fontkit);
    const bytes = await fsp.readFile(file);
    return await doc.embedFont(bytes, { subset: true });
  } catch {
    return null;
  }
}

export async function makePdfBuffer(doc) {
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  return Buffer.from(bytes);
}

export function parseSelection(input, total) {
  const text = String(input || '').trim();
  if (!text || text === 'all') return Array.from({ length: total }, (_, i) => i);
  const set = new Set();
  for (const part of text.split(/[,，\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let i = Math.max(1, a); i <= Math.min(total, b); i++) set.add(i - 1);
  }
  return [...set].sort((x, y) => x - y);
}

export function groupRanges(input, total) {
  const text = String(input || '').trim();
  if (!text) return [Array.from({ length: total }, (_, i) => i)];
  const groups = [];
  for (const part of text.split(/[,，\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    const group = [];
    for (let i = Math.max(1, a); i <= Math.min(total, b); i++) group.push(i - 1);
    if (group.length) groups.push(group);
  }
  return groups;
}

export function parseOrder(input, total) {
  const text = String(input || '').trim();
  if (!text) return null;
  const order = [];
  const seen = new Set();
  for (const part of text.split(/[,，\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let i = Math.max(1, a); i <= Math.min(total, b); i++) {
      if (!seen.has(i - 1)) { seen.add(i - 1); order.push(i - 1); }
    }
  }
  return order.length ? order : null;
}

export function pageLabel(indices) {
  const labels = indices.map((i) => String(i + 1));
  if (labels.length === 1) return labels[0];
  const contiguous = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
  return contiguous ? labels[0] + '-' + labels[labels.length - 1] : labels.join('_');
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return rgb(0.85, 0.1, 0.1);
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

export { StandardFonts, rgb, degrees };
