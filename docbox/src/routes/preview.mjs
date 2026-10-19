import express from 'express';
import fsp from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads } from '../lib/files.mjs';
import { OUTPUT_DIR } from '../config.mjs';
import * as D from '../lib/docops.mjs';

export const previewRouter = express.Router();

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'log', 'ini', 'js', 'ts', 'css', 'html', 'htm', 'csv', 'srt', 'vtt']);
const MAX_TEXT = 4000;

function extOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

function textPreview(text, name, ext) {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  return {
    kind: 'text',
    name,
    ext,
    text: clean.slice(0, MAX_TEXT),
    truncated: clean.length > MAX_TEXT,
    chars: clean.length,
    lines: clean.split('\n').length,
  };
}

/** 生成与文件类型匹配的预览数据（文本 / 表格 / 幻灯片）。 */
async function buildPreview(buffer, name) {
  const ext = extOf(name);
  if (ext === 'docx') {
    const text = (await D.docxToText(buffer)).replace(/\n{3,}/g, '\n\n').trim();
    return textPreview(text, name, ext);
  }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheets = wb.SheetNames.slice(0, 3).map((n) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: '' });
      return {
        name: n,
        rows: rows.slice(0, 12).map((r) => r.slice(0, 10).map((v) => String(v == null ? '' : v))),
        totalRows: rows.length,
      };
    });
    return { kind: 'table', name, ext, sheets, sheetCount: wb.SheetNames.length };
  }
  if (ext === 'pptx') {
    const slides = await D.pptxSlides(buffer);
    return {
      kind: 'slides',
      name,
      ext,
      count: slides.length,
      slides: slides.slice(0, 12).map((s) => ({ title: s.title, lines: s.lines.slice(0, 6) })),
    };
  }
  if (ext === 'html' || ext === 'htm') {
    const text = buffer.toString('utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return textPreview(text, name, ext);
  }
  if (TEXT_EXT.has(ext)) return textPreview(buffer.toString('utf8'), name, ext);
  if (ext === 'pdf') return { kind: 'pdf', name, ext };
  return { kind: 'none', name, ext };
}

previewRouter.post('/api/preview/document', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });
  try {
    const name = req.file.originalname;
    const data = await buildPreview(await fsp.readFile(req.file.path), name);
    res.json({ ok: true, data });
  } finally {
    cleanupUploads(req);
  }
}));

previewRouter.post('/api/preview/output', ah(async (req, res) => {
  const url = String(req.body?.url || '');
  if (!url.startsWith('/files/')) return res.status(400).json({ error: '只能预览本系统生成的文件' });
  const rest = url.slice('/files/'.length);
  const slash = rest.indexOf('/');
  const token = slash < 0 ? rest : rest.slice(0, slash);
  const rawName = slash < 0 ? '' : rest.slice(slash + 1);
  const name = decodeURIComponent(rawName);
  if (!token || !name) return res.status(400).json({ error: '文件地址不完整' });
  const target = path.join(OUTPUT_DIR, token, name);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(OUTPUT_DIR))) return res.status(400).json({ error: '不合法的文件地址' });
  const buffer = await fsp.readFile(resolved).catch(() => null);
  if (!buffer) return res.status(404).json({ error: '文件已过期或不存在' });
  const data = await buildPreview(buffer, name);
  res.json({ ok: true, data });
}));
