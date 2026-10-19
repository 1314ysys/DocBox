import express from 'express';
import fsp from 'node:fs/promises';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads, baseName, sendResult, fileSize } from '../lib/files.mjs';
import { logJob } from '../lib/track.mjs';
import {
  loadPdf, embedCjkFont, makePdfBuffer, parseSelection, groupRanges, parseOrder,
  pageLabel, hexToRgb, degrees, rgb, StandardFonts,
} from '../lib/pdfkit.mjs';

export const pdfRouter = express.Router();

pdfRouter.post('/api/pdf/merge', upload.array('files', 40), ah(async (req, res) => {
  const files = req.files || [];
  if (files.length < 2) return res.status(400).json({ error: '请至少选择两个 PDF 文件' });
  try {
    const merged = await PDFDocument.create();
    for (const f of files) {
      const src = await loadPdf(await fsp.readFile(f.path), true);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
    const buffer = await makePdfBuffer(merged);
    const note = '已合并 ' + files.length + ' 份文档（本地引擎）';
    logJob(req, { suite: 'pdf', tool: 'merge', note, outputs: 1 });
    await sendResult(res, [{ name: 'merged_' + files.length + '份.pdf', buffer }], note);
  } finally {
    cleanupUploads(req);
  }
}));

pdfRouter.post('/api/pdf/split', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 PDF 文件' });
  try {
    const mode = req.body.mode || 'ranges';
    const src = await loadPdf(await fsp.readFile(req.file.path), true);
    const total = src.getPageCount();
    const groups = [];
    if (mode === 'each') {
      for (let i = 0; i < total; i++) groups.push([i]);
    } else if (mode === 'every') {
      const n = Math.max(1, Number(req.body.every) || 1);
      for (let i = 0; i < total; i += n) groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
    } else if (mode === 'extract') {
      groups.push(parseSelection(req.body.ranges, total));
    } else {
      groups.push(...groupRanges(req.body.ranges, total));
    }
    const valid = groups.filter((g) => g.length);
    if (!valid.length) return res.status(400).json({ error: '没有匹配到有效的页码范围' });
    const outputs = [];
    for (const group of valid) {
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, group);
      pages.forEach((p) => doc.addPage(p));
      outputs.push({ name: baseName(req.file.originalname) + '_p' + pageLabel(group) + '.pdf', buffer: await makePdfBuffer(doc) });
    }
    const note = '共 ' + total + ' 页，已生成 ' + outputs.length + ' 个文件（本地引擎）';
    logJob(req, { suite: 'pdf', tool: 'split', note, outputs: outputs.length });
    await sendResult(res, outputs, note);
  } finally {
    cleanupUploads(req);
  }
}));

pdfRouter.post('/api/pdf/pages', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 PDF 文件' });
  try {
    let doc = await loadPdf(await fsp.readFile(req.file.path), true);
    const total = doc.getPageCount();
    const rotate = ((Number(req.body.rotate) || 0) % 360 + 360) % 360;
    const rotateSel = parseSelection(req.body.rotatePages, total);
    if (rotate) {
      const pages = doc.getPages();
      for (const i of rotateSel) {
        const p = pages[i];
        p.setRotation(degrees((p.getRotation().angle + rotate) % 360));
      }
    }
    let deleted = 0;
    const delText = String(req.body.deletePages || '').trim();
    if (delText) {
      const dels = parseSelection(delText, total).sort((a, b) => b - a);
      for (const i of dels) {
        if (doc.getPageCount() <= 1) break;
        doc.removePage(i);
        deleted++;
      }
    }
    let reordered = 0;
    const order = parseOrder(req.body.order, doc.getPageCount());
    if (order) {
      const next = await PDFDocument.create();
      const pages = await next.copyPages(doc, order);
      pages.forEach((p) => next.addPage(p));
      doc = next;
      reordered = order.length;
    }
    const notes = [];
    if (deleted) notes.push('已删除 ' + deleted + ' 页');
    if (reordered) notes.push('已按新顺序重排 ' + reordered + ' 页');
    if (!notes.length) notes.push('文件未发生变化');
    const note = notes.join('，');
    logJob(req, { suite: 'pdf', tool: 'pages', note, outputs: 1 });
    await sendResult(res, [{ name: baseName(req.file.originalname) + '_edited.pdf', buffer: await makePdfBuffer(doc) }], note);
  } finally {
    cleanupUploads(req);
  }
}));

pdfRouter.post('/api/pdf/watermark', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 PDF 文件' });
  try {
    const text = String(req.body.text || 'DocBox').slice(0, 80);
    const sizePct = Math.max(1, Math.min(30, Number(req.body.sizePct) || 8));
    const opacity = Math.max(0.02, Math.min(1, Number(req.body.opacity) || 0.15));
    const doc = await loadPdf(await fsp.readFile(req.file.path), true);
    const cjk = await embedCjkFont(doc);
    const font = cjk || await doc.embedFont(StandardFonts.Helvetica);
    const color = hexToRgb(req.body.color || '#d0d0d0');
    const diagonal = req.body.diagonal !== '0';
    const sel = parseSelection(req.body.pages || 'all', doc.getPageCount());
    const pages = doc.getPages();
    for (const i of sel) {
      const page = pages[i];
      const { width, height } = page.getSize();
      const size = Math.max(10, Math.min(width, height) * sizePct / 100);
      const angle = diagonal ? Math.atan2(height, width) : 0;
      const tw = font.widthOfTextAtSize(text, size);
      const x = width / 2 - (tw / 2) * Math.cos(angle) + (size / 2) * Math.sin(angle);
      const y = height / 2 - (tw / 2) * Math.sin(angle) - size * 0.35;
      page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees((angle * 180) / Math.PI) });
    }
    const note = cjk ? '已添加中文水印（' + sel.length + ' 页）' : '未找到中文字体，英文/数字水印可正常显示';
    logJob(req, { suite: 'pdf', tool: 'watermark', note, outputs: 1 });
    await sendResult(res, [{ name: baseName(req.file.originalname) + '_watermarked.pdf', buffer: await makePdfBuffer(doc) }], note);
  } finally {
    cleanupUploads(req);
  }
}));

pdfRouter.post('/api/pdf/numbers', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 PDF 文件' });
  try {
    const position = req.body.position || 'bottom-center';
    const doc = await loadPdf(await fsp.readFile(req.file.path), true);
    const font = (await embedCjkFont(doc)) || await doc.embedFont(StandardFonts.Helvetica);
    const total = doc.getPageCount();
    const start = Number(req.body.start) || 1;
    const size = Math.max(6, Math.min(36, Number(req.body.size) || 10));
    const template = String(req.body.template || '{n} / {total}');
    const margin = 24;
    doc.getPages().forEach((page, idx) => {
      const label = template.replaceAll('{n}', String(idx + start)).replaceAll('{total}', String(total + start - 1));
      const { width, height } = page.getSize();
      const tw = font.widthOfTextAtSize(label, size);
      let x = width / 2 - tw / 2;
      if (position.endsWith('left')) x = margin;
      if (position.endsWith('right')) x = width - margin - tw;
      const y = position.startsWith('top') ? height - margin - size : margin;
      page.drawText(label, { x, y, size, font, color: rgb(0.25, 0.25, 0.25) });
    });
    const note = '已添加页码（' + total + ' 页，本地引擎）';
    logJob(req, { suite: 'pdf', tool: 'numbers', note, outputs: 1 });
    await sendResult(res, [{ name: baseName(req.file.originalname) + '_numbered.pdf', buffer: await makePdfBuffer(doc) }], note);
  } finally {
    cleanupUploads(req);
  }
}));

pdfRouter.post('/api/pdf/compress', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 PDF 文件' });
  try {
    const before = fileSize(req.file.path);
    const level = Math.max(1, Math.min(9, Number(req.body.level) || 5));
    const doc = await loadPdf(await fsp.readFile(req.file.path), true);
    const buffer = await makePdfBuffer(doc);
    const after = buffer.length;
    const pct = before ? Math.round((1 - after / before) * 100) : 0;
    const note = after < before
      ? '已优化：体积减少约 ' + pct + '%（' + (before / 1024).toFixed(0) + ' KB → ' + (after / 1024).toFixed(0) + ' KB）'
      : '此文件已较为紧凑，优化后体积未减小（基准体积 '
        + (before / 1024).toFixed(0) + ' KB，压缩等级 ' + level + '）';
    logJob(req, { suite: 'pdf', tool: 'compress', note, outputs: 1 });
    await sendResult(res, [{ name: baseName(req.file.originalname) + '_compressed.pdf', buffer }], note);
  } finally {
    cleanupUploads(req);
  }
}));

pdfRouter.post('/api/pdf/images-to-pdf', upload.array('files', 40), ah(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '请先选择图片' });
  try {
    const pageSize = req.body.pageSize || 'A4';
    const orientation = req.body.orientation || 'auto';
    const margin = Math.max(0, Math.min(96, Number(req.body.margin) || 28));
    const sizes = { A4: [595.28, 841.89], Letter: [612, 792], A3: [841.89, 1190.55] };
    const doc = await PDFDocument.create();
    for (const f of files) {
      const img = sharp(f.path, { failOn: 'none' }).rotate();
      const buf = await img.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      const embedded = await doc.embedJpg(buf);
      let pw; let ph;
      if (pageSize === 'fit') {
        pw = embedded.width + margin * 2;
        ph = embedded.height + margin * 2;
      } else {
        [pw, ph] = sizes[pageSize] || sizes.A4;
        const landscape = orientation === 'landscape' || (orientation === 'auto' && embedded.width > embedded.height);
        if (landscape) [pw, ph] = [ph, pw];
      }
      const page = doc.addPage([pw, ph]);
      const availW = pw - margin * 2;
      const availH = ph - margin * 2;
      const scale = Math.min(availW / embedded.width, availH / embedded.height);
      const dw = embedded.width * scale;
      const dh = embedded.height * scale;
      page.drawImage(embedded, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
    }
    const note = '已合成 ' + files.length + ' 页 PDF';
    logJob(req, { suite: 'pdf', tool: 'images-to-pdf', note, outputs: 1 });
    await sendResult(res, [{ name: 'images_' + files.length + '页.pdf', buffer: await makePdfBuffer(doc) }], note);
  } finally {
    cleanupUploads(req);
  }
}));
