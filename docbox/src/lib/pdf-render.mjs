/**
 * PDF 渲染与文本提取（纯本地方案）：pdfjs-dist + @napi-rs/canvas，无需外部服务。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { DOCBOX_DIR } from '../config.mjs';

const STANDARD_FONTS = pathToFileURL(path.join(DOCBOX_DIR, 'node_modules', 'pdfjs-dist', 'standard_fonts')).href + '/';

let pdfjsMod = null;
async function pdfjs() {
  if (!pdfjsMod) pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsMod;
}

export async function openPdf(buffer) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
    disableFontFace: false,
  });
  return task.promise;
}

export async function pdfMeta(doc) {
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info || {};
  return {
    pages: doc.numPages,
    title: info.Title || '',
    author: info.Author || '',
    subject: info.Subject || '',
    keywords: info.Keywords || '',
    creator: info.Creator || '',
    producer: info.Producer || '',
    creationDate: info.CreationDate || '',
  };
}

export async function pageSize(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  return { width: Math.round(vp.width), height: Math.round(vp.height), rotation: (page.rotate || 0) % 360 };
}

export async function renderPage(doc, pageNumber, { dpi = 150, format = 'png', quality = 85 } = {}) {
  const page = await doc.getPage(pageNumber);
  const scale = Math.max(0.2, Math.min(Number(dpi) / 72, 6));
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const buf = format === 'jpg' || format === 'jpeg'
    ? await canvas.encode('jpeg', Math.round(Math.min(100, Math.max(30, Number(quality) || 85))))
    : await canvas.encode('png');
  page.cleanup();
  return { buffer: Buffer.from(buf), width, height };
}

export async function pageText(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('');
  page.cleanup();
  return text.replace(/[ \t]+\n/g, '\n').trim();
}

export async function allText(doc) {
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push({ page: i, text: await pageText(doc, i) });
  return pages;
}

export async function closePdf(doc) {
  try { await doc.destroy(); } catch { /* ignore */ }
}
