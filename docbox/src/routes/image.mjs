import express from 'express';
import sharp from 'sharp';
import fsp from 'node:fs/promises';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads, baseName, sendResult, fileSize } from '../lib/files.mjs';
import { applyWatermark } from '../lib/watermark.mjs';

export const imageRouter = express.Router();

async function processOneImage(file, body) {
  const op = body.op || 'compress';
  const src = sharp(file.path, { failOn: 'none' }).rotate();
  const meta = await src.metadata();
  let quality = Math.max(1, Math.min(100, Number(body.quality) || 80));
  let maxWidth = Number(body.maxWidth) || 0;
  let targetW = Number(body.width) || 0;
  let targetH = Number(body.height) || 0;
  let fmt = String(body.format || 'original').toLowerCase();
  if (fmt === 'jpg') fmt = 'jpeg';
  if (op === 'resize' && !targetW && !targetH) throw new Error('请填写目标宽度或高度');

  let pipe = sharp(file.path, { failOn: 'none' }).rotate();
  if (op === 'resize') {
    pipe = pipe.resize({
      width: targetW || undefined,
      height: targetH || undefined,
      fit: body.fit || 'inside',
      withoutEnlargement: false,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    });
  } else if (maxWidth > 0) {
    pipe = pipe.resize({ width: maxWidth, withoutEnlargement: true });
  }

  if (fmt === 'original') {
    const orig = (meta.format || '').toLowerCase();
    fmt = ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'].includes(orig) ? orig : 'jpeg';
    if (fmt === 'gif') fmt = 'png';
  }
  if (!['jpeg', 'png', 'webp', 'avif', 'tiff'].includes(fmt)) fmt = 'jpeg';

  if (fmt === 'jpeg') pipe = pipe.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true, progressive: true });
  else if (fmt === 'png') pipe = pipe.png({ compressionLevel: 9, palette: quality < 95 });
  else if (fmt === 'webp') pipe = pipe.webp({ quality, effort: 4 });
  else if (fmt === 'avif') pipe = pipe.avif({ quality, effort: 4 });
  else if (fmt === 'tiff') pipe = pipe.tiff({ quality, compression: 'lzw' });

  const buffer = await pipe.toBuffer();
  const ext = fmt === 'jpeg' ? 'jpg' : fmt;
  const suffix = op === 'compress' ? '_compressed' : op === 'resize' ? '_resized' : '';
  return { name: baseName(file.originalname) + suffix + '.' + ext, buffer };
}

imageRouter.post('/api/image/process', upload.array('files', 40), ah(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '请先选择图片文件' });
  try {
    const outputs = [];
    for (const f of files) outputs.push(await processOneImage(f, req.body));
    let note = '';
    if (req.body.op === 'compress' && files.length === 1) {
      const before = fileSize(files[0].path);
      const after = outputs[0].buffer.length;
      const pct = before ? Math.round((1 - after / before) * 100) : 0;
      note = after < before
        ? '体积减少约 ' + pct + '%（' + (before / 1024).toFixed(1) + ' KB → ' + (after / 1024).toFixed(1) + ' KB）'
        : '当前参数下体积未减小，可尝试降低质量或尺寸';
    }
    await sendResult(res, outputs, note);
  } finally {
    cleanupUploads(req);
  }
}));

imageRouter.post('/api/image/watermark-template', upload.fields([
  { name: 'files', maxCount: 40 },
  { name: 'logo', maxCount: 1 },
]), ah(async (req, res) => {
  const files = req.files?.files || [];
  const logo = req.files?.logo?.[0] || null;
  if (!files.length) return res.status(400).json({ error: '请先选择图片文件' });
  let spec = {};
  try { spec = JSON.parse(req.body.spec || '{}'); } catch { return res.status(400).json({ error: '水印参数格式错误' }); }
  const preview = String(req.query.preview || req.body.preview || '') === '1';
  try {
    const targets = preview ? files.slice(0, 1) : files;
    const outputs = [];
    for (const f of targets) {
      const buffer = await applyWatermark(f.path, spec, logo?.path || null);
      outputs.push({ name: baseName(f.originalname) + '_watermark.png', buffer, kind: 'image' });
    }
    await sendResult(res, outputs, preview ? '水印预览' : '已为 ' + targets.length + ' 张图片添加水印');
  } finally {
    cleanupUploads(req);
  }
}));

imageRouter.post('/api/image/info', upload.array('files', 40), ah(async (req, res) => {
  const files = req.files || [];
  try {
    const list = [];
    for (const f of files) {
      const meta = await sharp(f.path, { failOn: 'none' }).metadata();
      list.push({ name: f.originalname, width: meta.width, height: meta.height, format: meta.format, size: fileSize(f.path) });
    }
    res.json({ ok: true, files: list });
  } finally {
    cleanupUploads(req);
  }
}));
