import express from 'express';
import fsp from 'node:fs/promises';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { marked } from 'marked';
import XLSX from 'xlsx';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads, baseName, sendResult } from '../lib/files.mjs';
import { htmlToPdf, wrapHtml, escapeHtml } from '../lib/html2pdf.mjs';

export const docRouter = express.Router();

function sheetToHtml(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames.map((name, idx) => {
    const html = XLSX.utils.sheet_to_html(wb.Sheets[name], { header: '', footer: '' });
    return '<div class="' + (idx ? 'page-break' : '') + '"><h2>' + escapeHtml(name) + '</h2>' + html + '</div>';
  }).join('');
}

docRouter.post('/api/doc/to-pdf', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文档文件' });
  try {
    const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
    const buffer = await fsp.readFile(req.file.path);
    let html;
    let title = baseName(req.file.originalname);
    if (ext === 'docx') {
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
    } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
      const text = buffer.toString('utf8');
      html = ext === 'txt' ? '<pre>' + escapeHtml(text) + '</pre>' : marked.parse(text);
    } else if (ext === 'html' || ext === 'htm') {
      html = buffer.toString('utf8');
      const m = /<title>([^<]+)<\/title>/i.exec(html);
      if (m) title = m[1].trim();
    } else if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
      html = sheetToHtml(buffer);
    } else {
      return res.status(400).json({ error: '暂不支持 .' + ext + ' 转 PDF，请使用 Word(.docx) / Markdown / HTML / Excel / CSV' });
    }
    const pdf = await htmlToPdf(wrapHtml(html, title));
    await sendResult(res, [{ name: title + '.pdf', buffer: pdf }], '已用本机 Edge 打印为 PDF');
  } finally {
    cleanupUploads(req);
  }
}));

docRouter.post('/api/doc/docx-to-html', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 .docx 文件' });
  try {
    const result = await mammoth.convertToHtml({ buffer: await fsp.readFile(req.file.path) });
    const html = wrapHtml(result.value, baseName(req.file.originalname));
    await sendResult(res, [{ name: baseName(req.file.originalname) + '.html', buffer: Buffer.from(html, 'utf8') }],
      result.messages?.length ? '已转换，含 ' + result.messages.length + ' 条提示' : '已转换为独立 HTML');
  } finally {
    cleanupUploads(req);
  }
}));

docRouter.post('/api/doc/to-markdown', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 .docx 或 .html 文件' });
  try {
    const buffer = await fsp.readFile(req.file.path);
    const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
    let html;
    if (ext === 'docx') html = (await mammoth.convertToHtml({ buffer })).value;
    else if (ext === 'html' || ext === 'htm') html = buffer.toString('utf8');
    else return res.status(400).json({ error: '请上传 .docx 或 .html 文件' });
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    const md = turndown.turndown(html);
    await sendResult(res, [{ name: baseName(req.file.originalname) + '.md', buffer: Buffer.from(md, 'utf8') }], '已转换为 Markdown');
  } finally {
    cleanupUploads(req);
  }
}));
