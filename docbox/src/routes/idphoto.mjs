import express from 'express';
import sharp from 'sharp';
import fsp from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads, baseName, sendResult } from '../lib/files.mjs';

export const idphotoRouter = express.Router();

export const ID_PRESETS = [
  { id: '1cun', name: '1 寸（25×35mm）', w: 25, h: 35, px: 295, ph: 413 },
  { id: 'small-1cun', name: '小 1 寸（22×32mm）', w: 22, h: 32, px: 260, ph: 378 },
  { id: '2cun', name: '2 寸（35×49mm）', w: 35, h: 49, px: 413, ph: 579 },
  { id: 'large-2cun', name: '大 2 寸（35×53mm）', w: 35, h: 53, px: 413, ph: 626 },
  { id: 'small-2cun', name: '小 2 寸（35×45mm）', w: 35, h: 45, px: 413, ph: 531 },
  { id: 'large-1cun', name: '大一寸（33×48mm）', w: 33, h: 48, px: 390, ph: 567 },
  { id: 'passport', name: '护照（33×48mm）', w: 33, h: 48, px: 390, ph: 567 },
  { id: 'visa', name: '签证（35×45mm）', w: 35, h: 45, px: 413, ph: 531 },
  { id: 'idcard', name: '二代身份证（26×32mm）', w: 26, h: 32, px: 307, ph: 378 },
  { id: 'driver', name: '驾驶证（22×32mm）', w: 22, h: 32, px: 260, ph: 378 },
];

const PAPER = { w: 2480, h: 3508, margin: 92, gap: 46 };

idphotoRouter.get('/api/idphoto/presets', (_req, res) => {
  res.json({ ok: true, presets: ID_PRESETS, paper: { w: 210, h: 297, dpi: 300 } });
});

idphotoRouter.post('/api/idphoto/sheet', upload.single('photo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请先上传或拍摄证件照' });
  try {
    const sizeId = req.body.size || '1cun';
    const preset = ID_PRESETS.find((p) => p.id === sizeId) || ID_PRESETS[0];
    const fullPage = req.body.mode === 'fullpage' || sizeId === 'household';
    const copies = Math.max(1, Math.min(30, Number(req.body.copies) || 6));
    const bg = req.body.bg || '#ffffff';
    const cut = req.body.cut !== '0';
    const format = req.body.format || 'pdf';

    const photo = await sharp(req.file.path, { failOn: 'none' }).rotate()
      .flatten({ background: bg }).jpeg({ quality: 95, mozjpeg: true }).toBuffer();

    if (fullPage) {
      const page = await sharp(photo).resize({ width: PAPER.w, height: PAPER.h, fit: 'cover', position: 'center' })
        .png().toBuffer();
      const composite = await sharp({ create: { width: PAPER.w, height: PAPER.h, channels: 3, background: bg } })
        .composite([{ input: page, left: 0, top: 0 }]).jpeg({ quality: 94 }).toBuffer();
      await outputSheet(res, composite, req.file.originalname, format, preset, fullPage);
      return;
    }

    const cellW = preset.px;
    const cellH = preset.ph;
    const cols = Math.max(1, Math.floor((PAPER.w - PAPER.margin * 2 + PAPER.gap) / (cellW + PAPER.gap)));
    const rows = Math.max(1, Math.floor((PAPER.h - PAPER.margin * 2 + PAPER.gap) / (cellH + PAPER.gap)));
    const capacity = cols * rows;
    const total = Math.min(copies, capacity);
    const count = Math.max(1, total);
    const usedCols = Math.min(cols, count);
    const usedRows = Math.ceil(count / usedCols);
    const gridW = usedCols * cellW + (usedCols - 1) * PAPER.gap;
    const gridH = usedRows * cellH + (usedRows - 1) * PAPER.gap;
    const startX = Math.round((PAPER.w - gridW) / 2);
    const startY = Math.round((PAPER.h - gridH) / 2);

    const cell = await sharp(photo).resize({ width: cellW, height: cellH, fit: 'cover', position: 'center' }).png().toBuffer();
    const composites = [];
    const lines = [];
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / usedCols);
      const c = i % usedCols;
      const left = startX + c * (cellW + PAPER.gap);
      const top = startY + r * (cellH + PAPER.gap);
      composites.push({ input: cell, left, top });
      if (cut) lines.push(`<rect x="${left - 3}" y="${top - 3}" width="${cellW + 6}" height="${cellH + 6}" fill="none" stroke="#9ca3af" stroke-width="2" stroke-dasharray="7 6"/>`);
    }
    if (cut) {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + PAPER.w + '" height="' + PAPER.h + '">' + lines.join('') + '</svg>';
      composites.push({ input: Buffer.from(svg), left: 0, top: 0 });
    }
    const sheet = await sharp({ create: { width: PAPER.w, height: PAPER.h, channels: 3, background: bg } })
      .composite(composites).jpeg({ quality: 94 }).toBuffer();
    await outputSheet(res, sheet, req.file.originalname, format, preset, false, count);
  } finally {
    cleanupUploads(req);
  }
}));

async function outputSheet(res, jpegBuffer, originalName, format, preset, fullPage, count) {
  const base = baseName(originalName) + '_' + (fullPage ? 'A4整页' : preset.name.replace(/[（）()]/g, '').replace(/\s+/g, '').replace(/×/g, 'x'));
  const note = fullPage ? '已按 A4 整页输出' : '已排版 ' + count + ' 张 ' + preset.name;
  if (format === 'png') {
    const png = await sharp(jpegBuffer).png().toBuffer();
    await sendResult(res, [{ name: base + '_A4.png', buffer: png, kind: 'image' }], note + '（300dpi A4）');
    return;
  }
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpegBuffer);
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  const bytes = await doc.save();
  await sendResult(res, [{ name: base + '_A4.pdf', buffer: Buffer.from(bytes) }], note + '（A4 PDF，可直接打印）');
}