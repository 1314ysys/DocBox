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
import * as D from '../lib/docops.mjs';

export const docRouter = express.Router();

function extOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

function sheetToHtml(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames.map((name, idx) => {
    const html = XLSX.utils.sheet_to_html(wb.Sheets[name], { header: '', footer: '' });
    return '<div class="' + (idx ? 'page-break' : '') + '"><h2>' + escapeHtml(name) + '</h2>' + html + '</div>';
  }).join('');
}

/** 把任意受支持的文档转成可打印 HTML；不支持的扩展名抛出中文错误。 */
function docToHtml(buffer, ext, title) {
  if (ext === 'docx') return mammoth.convertToHtml({ buffer }).then((r) => r.value);
  if (ext === 'txt') return '<pre>' + escapeHtml(buffer.toString('utf8')) + '</pre>';
  if (ext === 'md' || ext === 'markdown') return D.markdownToHtml(buffer.toString('utf8'));
  if (ext === 'html' || ext === 'htm') {
    const html = buffer.toString('utf8');
    return html;
  }
  if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') return sheetToHtml(buffer);
  throw new Error('暂不支持 .' + ext + ' 转 PDF，可用 Word(.docx) / PowerPoint(.pptx) / Markdown / HTML / Excel / CSV');
}

const ALLOWED = {
  'word-to-pdf': ['docx'],
  'excel-to-pdf': ['xlsx', 'xls', 'csv'],
  'md-to-pdf': ['md', 'markdown'],
  'txt-to-pdf': ['txt'],
};

async function documentPdfRoute(req, res, allowed) {
  if (!req.file) return res.status(400).json({ error: '请选择文档文件' });
  try {
    const ext = extOf(req.file.originalname);
    if (allowed && !allowed.includes(ext)) {
      return res.status(400).json({ error: '该工具只接受 ' + allowed.map((e) => '.' + e).join(' / ') + ' 文件，当前是 .' + ext });
    }
    const buffer = await fsp.readFile(req.file.path);
    const title = baseName(req.file.originalname);
    const html = await docToHtml(buffer, ext, title);
    const pdf = await htmlToPdf(wrapHtml(html, title));
    await sendResult(res, [{ name: title + '.pdf', buffer: pdf }], '已用本机 Edge 打印为 PDF');
  } finally {
    cleanupUploads(req);
  }
}

docRouter.post('/api/doc/to-pdf', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文档文件' });
  try {
    const ext = extOf(req.file.originalname);
    const buffer = await fsp.readFile(req.file.path);
    const title = baseName(req.file.originalname);
    if (ext === 'pptx') {
      const slides = await D.pptxSlides(buffer);
      if (!slides.length) return res.status(400).json({ error: '这个 PPTX 里没有可读取的幻灯片' });
      const out = D.slidesToHtml(slides, title);
      const pdf = await htmlToPdf(wrapHtml(out.html, out.title, out.css));
      return await sendResult(res, [{ name: title + '.pdf', buffer: pdf }], '已按 ' + slides.length + ' 页幻灯片打印为横向 PDF');
    }
    const html = await docToHtml(buffer, ext, title);
    const pdf = await htmlToPdf(wrapHtml(html, title));
    await sendResult(res, [{ name: title + '.pdf', buffer: pdf }], '已用本机 Edge 打印为 PDF');
  } finally {
    cleanupUploads(req);
  }
}));

for (const [route, exts] of Object.entries(ALLOWED)) {
  docRouter.post('/api/doc/' + route, upload.single('file'), ah(async (req, res) => {
    await documentPdfRoute(req, res, exts);
  }));
}

/* -------- PowerPoint 转 PDF -------- */
docRouter.post('/api/doc/pptx-to-pdf', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 .pptx 文件' });
  try {
    const ext = extOf(req.file.originalname);
    if (ext !== 'pptx') return res.status(400).json({ error: '请上传 PowerPoint .pptx 文件（旧版 .ppt 请先另存为 .pptx）' });
    const buffer = await fsp.readFile(req.file.path);
    const title = baseName(req.file.originalname);
    const slides = await D.pptxSlides(buffer);
    if (!slides.length) return res.status(400).json({ error: '这个 PPTX 里没有可读取的幻灯片' });
    const out = D.slidesToHtml(slides, title);
    const pdf = await htmlToPdf(wrapHtml(out.html, out.title, out.css));
    await sendResult(res, [{ name: title + '.pdf', buffer: pdf }], '已按 ' + slides.length + ' 页幻灯片打印为横向 PDF（文字与图片）');
  } finally {
    cleanupUploads(req);
  }
}));

/* -------- Word 转 TXT -------- */
docRouter.post('/api/doc/word-to-txt', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 .docx 文件' });
  try {
    const ext = extOf(req.file.originalname);
    if (ext !== 'docx') return res.status(400).json({ error: '请上传 Word .docx 文件' });
    const buffer = await fsp.readFile(req.file.path);
    const text = (await D.docxToText(buffer)).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    await sendResult(res, [{ name: baseName(req.file.originalname) + '.txt', buffer: Buffer.from(text, 'utf8') }], '已提取纯文本');
  } finally {
    cleanupUploads(req);
  }
}));

/* -------- HTML 转 Word -------- */
docRouter.post('/api/doc/html-to-docx', upload.single('file'), ah(async (req, res) => {
  try {
    let html = String(req.body?.html || '');
    let name = 'html';
    if (req.file) {
      const ext = extOf(req.file.originalname);
      if (!['html', 'htm'].includes(ext)) return res.status(400).json({ error: '请上传 .html 文件，或直接粘贴 HTML 内容' });
      html = await fsp.readFile(req.file.path, 'utf8');
      name = baseName(req.file.originalname);
    }
    if (!html.trim()) return res.status(400).json({ error: '请上传 .html 文件，或直接粘贴 HTML 内容' });
    const docx = await D.htmlToDocx(html, name);
    await sendResult(res, [{ name: name + '.docx', buffer: docx }], '已生成可编辑的 Word 文档');
  } finally {
    cleanupUploads(req);
  }
}));

/* -------- Markdown 转 HTML -------- */
docRouter.post('/api/doc/md-to-html', upload.single('file'), ah(async (req, res) => {
  try {
    let md = String(req.body?.md || '');
    let name = 'markdown';
    if (req.file) {
      const ext = extOf(req.file.originalname);
      if (!['md', 'markdown', 'txt'].includes(ext)) return res.status(400).json({ error: '请上传 .md / .txt 文件，或直接粘贴 Markdown' });
      md = await fsp.readFile(req.file.path, 'utf8');
      name = baseName(req.file.originalname);
    }
    if (!md.trim()) return res.status(400).json({ error: '请上传 .md 文件，或直接粘贴 Markdown 内容' });
    const body = D.sanitizeHtml(D.markdownToHtml(md));
    const html = D.standaloneHtml(body, name);
    await sendResult(res, [{ name: name + '.html', buffer: Buffer.from(html, 'utf8') }], '已生成带样式的独立 HTML');
  } finally {
    cleanupUploads(req);
  }
}));

/* -------- Word 批量格式转换（TXT / HTML / MD / PDF） -------- */
docRouter.post('/api/doc/batch-convert', upload.array('files', 20), ah(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '请选择要转换的文件' });
  const target = String(req.body?.target || 'txt').toLowerCase();
  if (!['txt', 'html', 'md', 'pdf'].includes(target)) return res.status(400).json({ error: '目标格式只支持 txt / html / md / pdf' });
  const out = [];
  try {
    for (const f of files) {
      const ext = extOf(f.originalname);
      const name = baseName(f.originalname);
      const buffer = await fsp.readFile(f.path);
      if (target === 'txt') {
        let text;
        if (ext === 'docx') text = await D.docxToText(buffer);
        else if (ext === 'html' || ext === 'htm') text = buffer.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n');
        else text = buffer.toString('utf8');
        out.push({ name: name + '.txt', buffer: Buffer.from(text, 'utf8') });
      } else if (target === 'html') {
        let html;
        if (ext === 'docx') html = (await D.docxToHtml(buffer)).html;
        else if (ext === 'md' || ext === 'markdown') html = D.markdownToHtml(buffer.toString('utf8'));
        else if (ext === 'html' || ext === 'htm') html = buffer.toString('utf8');
        else html = '<pre>' + escapeHtml(buffer.toString('utf8')) + '</pre>';
        out.push({ name: name + '.html', buffer: Buffer.from(D.standaloneHtml(D.sanitizeHtml(html), name), 'utf8') });
      } else if (target === 'md') {
        let md;
        if (ext === 'docx') md = D.htmlToMarkdown((await D.docxToHtml(buffer)).html);
        else if (ext === 'html' || ext === 'htm') md = D.htmlToMarkdown(buffer.toString('utf8'));
        else md = buffer.toString('utf8');
        out.push({ name: name + '.md', buffer: Buffer.from(md, 'utf8') });
      } else {
        const html = await docToHtml(buffer, ext, name);
        out.push({ name: name + '.pdf', buffer: await htmlToPdf(wrapHtml(html, name)) });
      }
    }
    const shown = target === 'pdf' ? '已转换为 PDF' : '已转换为 ' + target.toUpperCase();
    await sendResult(res, out, files.length + ' 个文件' + shown);
  } finally {
    cleanupUploads(req);
  }
}));

/* -------- 公文一键排版 -------- */
docRouter.post('/api/doc/gongwen', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 Word 公文文件' });
  try {
    const ext = extOf(req.file.originalname);
    const buffer = await fsp.readFile(req.file.path);
    let text;
    if (ext === 'docx') text = await D.docxToText(buffer);
    else if (ext === 'txt' || ext === 'md' || ext === 'markdown') text = buffer.toString('utf8').replace(/^#+\s*/gm, '');
    else return res.status(400).json({ error: '请上传 .docx / .txt / .md 文件' });
    if (!text.trim()) return res.status(400).json({ error: '文档内容为空' });
    const name = baseName(req.file.originalname) || '公文';
    const output = String(req.body?.output || 'both');
    const pageNumbers = String(req.body?.pageNumbers ?? '1') !== '0';
    const attachBreak = String(req.body?.attachBreak ?? '1') !== '0';
    const lineSpacing = Math.min(Math.max(Number(req.body?.lineSpacing) || 28, 16), 40);
    const blocks = D.gongwenBlocks(text);
    const results = [];
    if (output !== 'pdf') {
      const docx = await D.buildDocx(D.gongwenToDocx(blocks, {
        pageNumbers, attachBreak, lineTwips: Math.round(lineSpacing * 20),
      }), { title: name, marginTop: 37, marginBottom: 35, marginLeft: 28, marginRight: 26, pageNumbers });
      results.push({ name: name + '_公文排版.docx', buffer: docx });
    }
    if (output !== 'docx') {
      const out = D.gongwenToHtml(blocks, { attachBreak });
      results.push({ name: name + '_公文排版.pdf', buffer: await htmlToPdf(wrapHtml(out.html, name, out.css)) });
    }
    await sendResult(res, results, '已按 A4 公文版式排版（标题小标宋二号、正文仿宋三号、首行缩进两字、' + lineSpacing + ' 磅行距' + (pageNumbers ? '、页码' : '') + (attachBreak ? '、附件换页' : '') + '）');
  } finally {
    cleanupUploads(req);
  }
}));

/* -------- Markdown 表格生成器 -------- */
docRouter.post('/api/doc/md-table', ah(async (req, res) => {
  const markdown = D.mdTableMarkdown({
    rows: req.body?.rows,
    cols: req.body?.cols,
    headers: req.body?.headers,
    align: req.body?.align,
    placeholder: req.body?.placeholder,
  });
  res.json({ ok: true, data: { markdown, rows: Number(req.body?.rows) || 3, cols: Number(req.body?.cols) || 3 }, note: '已生成 Markdown 表格模板' });
}));

/* -------- Markdown 编辑器预览 -------- */
docRouter.post('/api/doc/md-render', ah(async (req, res) => {
  const md = String(req.body?.md || '');
  const html = D.sanitizeHtml(D.markdownToHtml(md));
  res.json({ ok: true, data: { html, standalone: D.standaloneHtml(html, req.body?.title || 'Markdown'), words: md.replace(/\s/g, '').length }, note: '已渲染 ' + md.split('\n').length + ' 行' });
}));

/* -------- 既有接口 -------- */
docRouter.post('/api/doc/docx-to-html', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 .docx 文件' });
  try {
    const out = await D.docxToHtml(await fsp.readFile(req.file.path));
    const html = wrapHtml(out.html, baseName(req.file.originalname));
    await sendResult(res, [{ name: baseName(req.file.originalname) + '.html', buffer: Buffer.from(html, 'utf8') }],
      out.messages.length ? '已转换，含 ' + out.messages.length + ' 条提示' : '已转换为独立 HTML');
  } finally {
    cleanupUploads(req);
  }
}));

docRouter.post('/api/doc/to-markdown', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 .docx 或 .html 文件' });
  try {
    const buffer = await fsp.readFile(req.file.path);
    const ext = extOf(req.file.originalname);
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
