/**
 * 无浏览器兜底：把 HTML 文档排成纯文本 PDF（pdf-lib + 中文字体）。
 * 仅在系统没有 Edge/Chrome（如容器/服务器）时使用：保文字内容与分页，不保表格样式。
 */
import { PDFDocument, rgb } from 'pdf-lib';
import { embedCjkFont } from './pdfkit.mjs';

const A4 = [595.28, 841.89];
const MARGIN = 50;
const BODY = 11.5;
const LINE = 18;
const MAX_W = A4[0] - MARGIN * 2;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name) => {
    const key = name.toLowerCase();
    if (ENTITIES[key]) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
    return m;
  });
}

export function htmlToLines(html) {
  let s = String(html || '');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<\/t[dh]>/gi, '  ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line, i, arr) => line || (i > 0 && arr[i - 1]));
}

function wrap(text, font, size) {
  const out = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (font.widthOfTextAtSize(test, size) > MAX_W && line) {
      out.push(line);
      line = ch === ' ' ? '' : ch;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

export async function htmlTextToPdf(html, options = {}) {
  const title = options.title || '文档';
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const cjk = await embedCjkFont(doc);
  const font = cjk || await doc.embedFont('Helvetica');
  const color = rgb(0.12, 0.16, 0.22);

  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  const newPage = () => { page = doc.addPage(A4); y = A4[1] - MARGIN; };

  for (const block of htmlToLines(html)) {
    for (const line of wrap(block, font, BODY)) {
      if (y < MARGIN + LINE) newPage();
      page.drawText(line, { x: MARGIN, y, size: BODY, font, color });
      y -= LINE;
    }
    y -= 4;
  }
  return Buffer.from(await doc.save());
}
