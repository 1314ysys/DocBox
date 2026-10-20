import express from 'express';
import fsp from 'node:fs/promises';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads } from '../lib/files.mjs';
import { recognizeImages } from '../lib/ocr.mjs';

export const ocrRouter = express.Router();

const MODES = new Set(['both', 'text', 'barcode']);
const pickMode = (v) => (MODES.has(v) ? v : 'both');

ocrRouter.post('/api/ocr/image', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片文件' });
  try {
    const mode = pickMode(req.body.mode);
    const [result] = await recognizeImages([req.file.path], mode);
    res.json({
      ok: true,
      mode,
      name: req.file.originalname,
      text: result.text,
      confidence: result.confidence,
      chars: result.chars,
      barcodes: result.barcodes || [],
      lines: req.body.detail === '1' ? result.lines.slice(0, 300) : undefined,
    });
  } finally {
    cleanupUploads(req);
  }
}));

ocrRouter.post('/api/ocr/batch', upload.array('files', 40), ah(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '请选择图片文件' });
  try {
    const mode = pickMode(req.body.mode);
    const results = await recognizeImages(files.map((f) => f.path), mode);
    const pages = results.map((r, idx) => ({
      name: files[idx]?.originalname || ('page-' + (idx + 1)),
      text: r.text,
      confidence: r.confidence,
      chars: r.chars,
      barcodes: r.barcodes || [],
    }));
    const barcodes = pages.flatMap((p) => (p.barcodes || []).map((b) => ({ ...b, page: p.name })));
    const full = pages.map((p, i) => '===== 第 ' + (i + 1) + ' 页 =====\n' + p.text).join('\n\n');
    res.json({ ok: true, mode, pages, barcodes, text: full, chars: full.length });
  } finally {
    cleanupUploads(req);
  }
}));
