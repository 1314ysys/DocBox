/**
 * 文档能力库：DOCX 生成（公文/HTML 转 Word）、PPTX 转 PDF、Word 转 TXT、Markdown 工具。
 * 不依赖 Office / LibreOffice：DOCX 用 OOXML 直写，PDF 用本机 Edge 打印。
 */
import JSZip from 'jszip';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { marked } from 'marked';

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export const FONTS = {
  body: '仿宋_GB2312',
  bodyAlt: '仿宋',
  title: '方正小标宋简体',
  heiti: '黑体',
  kaiti: '楷体',
  song: '宋体',
  mono: 'Consolas',
};

export function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function rPr(opts) {
  const o = opts || {};
  const font = o.font || FONTS.body;
  const size = o.size || 32;
  return '<w:rPr><w:rFonts w:ascii="' + (o.ascii || 'Times New Roman') + '" w:hAnsi="' + (o.ascii || 'Times New Roman') +
    '" w:eastAsia="' + font + '"/>' + (o.bold ? '<w:b/>' : '') + (o.italic ? '<w:i/>' : '') +
    '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' +
    (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + '</w:rPr>';
}

function runs(text, opts) {
  const base = opts || {};
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  let out = '';
  lines.forEach((line, i) => {
    if (i) out += '<w:r>' + rPr(base) + '<w:br/></w:r>';
    const tokens = line.split(/(\*\*[^*]+\*\*|\`[^\`]+\`)/g);
    for (const token of tokens) {
      if (!token) continue;
      if (/^\*\*[^*]+\*\*$/.test(token)) {
        out += '<w:r>' + rPr(Object.assign({}, base, { bold: true })) + '<w:t xml:space="preserve">' + escXml(token.slice(2, -2)) + '</w:t></w:r>';
      } else if (/^\`[^\`]+\`$/.test(token)) {
        out += '<w:r>' + rPr(Object.assign({}, base, { font: FONTS.mono, ascii: FONTS.mono })) + '<w:t xml:space="preserve">' + escXml(token.slice(1, -1)) + '</w:t></w:r>';
      } else {
        out += '<w:r>' + rPr(base) + '<w:t xml:space="preserve">' + escXml(token) + '</w:t></w:r>';
      }
    }
  });
  return out || '<w:r>' + rPr(base) + '<w:t xml:space="preserve"></w:t></w:r>';
}

/** 生成一个段落；size 单位为半磅（三号=32，二号=44）。 */
export function para(text, opts) {
  const o = opts || {};
  const size = o.size || 32;
  const align = o.align || 'both';
  let ind = '';
  if (o.firstLineIndent) ind = '<w:ind w:firstLineChars="200" w:firstLine="' + size * 20 + '"/>';
  else if (o.leftChars) ind = '<w:ind w:leftChars="' + o.leftChars * 100 + '" w:left="' + o.leftChars * size * 20 + '"/>';
  const pPr = '<w:pPr>' + (o.pageBreak ? '<w:pageBreakBefore/>' : '') + (o.keepNext ? '<w:keepNext/>' : '') +
    '<w:spacing w:line="' + (o.line || 560) + '" w:lineRule="exact" w:before="' + (o.before || 0) + '" w:after="' + (o.after || 0) + '"/>' +
    ind + '<w:jc w:val="' + align + '"/>' + rPr(o) + '</w:pPr>';
  const body = runs(text, o);
  return '<w:p>' + pPr + body + '</w:p>';
}

function footerXml(withPage) {
  if (!withPage) return '';
  const fld = '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>1</w:t></w:r>' +
    '<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>';
  return XML_HEAD + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:t>— </w:t></w:r>' + fld +
    '<w:r><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:t> —</w:t></w:r></w:p></w:ftr>';
}

const STYLES = XML_HEAD + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="' + FONTS.body + '"/>' +
  '<w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="560" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';

/**
 * 打包 DOCX。paragraphs 为 para()/自定义 XML 段落的数组。
 */
export async function buildDocx(paragraphs, options) {
  const o = Object.assign({
    landscape: false,
    pageNumbers: true,
    marginTop: 25.4,
    marginRight: 25.4,
    marginBottom: 25.4,
    marginLeft: 25.4,
    title: 'DocBox 文档',
  }, options || {});
  const mg = (v) => Math.round(Number(v) * 56.6929);
  const pgW = o.landscape ? 16838 : 11906;
  const pgH = o.landscape ? 11906 : 16838;
  const body = paragraphs.join('');
  const sect = '<w:sectPr>' + (o.pageNumbers ? '<w:footerReference w:type="default" r:id="rId2"/>' : '') +
    '<w:pgSz w:w="' + pgW + '" w:h="' + pgH + '"/>' +
    '<w:pgMar w:top="' + mg(o.marginTop) + '" w:right="' + mg(o.marginRight) + '" w:bottom="' + mg(o.marginBottom) +
    '" w:left="' + mg(o.marginLeft) + '" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>';
  const documentXml = XML_HEAD + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + body + sect + '</w:body></w:document>';

  const contentTypes = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    (o.pageNumbers ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';

  const rootRels = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';

  const docRels = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    (o.pageNumbers ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '') +
    '</Relationships>';

  const core = XML_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + escXml(o.title) + '</dc:title><dc:creator>DocBox</dc:creator>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:created>' +
    '</cp:coreProperties>';

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rootRels);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/_rels/document.xml.rels', docRels);
  if (o.pageNumbers) zip.file('word/footer1.xml', footerXml(true));
  zip.file('docProps/core.xml', core);
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/* ============================ Markdown / 标题层级 → DOCX 段落 ============================ */

const HEADING_SIZE = { 1: 40, 2: 34, 3: 32, 4: 30, 5: 28, 6: 28 };

export function markdownToBlocks(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let fence = null;
  let tableBuf = [];
  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.filter((l) => !/^\s*\|?[-: |]+\|?\s*$/.test(l));
    blocks.push({ kind: 'table', rows: rows.map((l) => l.split('|').map((c) => c.trim()).filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''))) });
    tableBuf = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      if (fence) { blocks.push({ kind: 'code', text: fence.lines.join('\n') }); fence = null; }
      else { flushTable(); fence = { lines: [] }; }
      continue;
    }
    if (fence) { fence.lines.push(raw); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { tableBuf.push(line); continue; }
    flushTable();
    const t = line.trim();
    if (!t) { if (blocks.length && blocks[blocks.length - 1].kind !== 'p') continue; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { blocks.push({ kind: 'h' + h[1].length, text: h[2].trim() }); continue; }
    const b = /^[-*+]\s+(.*)$/.exec(t);
    if (b) { blocks.push({ kind: 'bullet', text: b[1].trim() }); continue; }
    const ol = /^(\d+)[.、)]\s+(.*)$/.exec(t);
    if (ol) { blocks.push({ kind: 'ordered', text: ol[2].trim(), num: ol[1] }); continue; }
    if (/^>\s?/.test(t)) { blocks.push({ kind: 'quote', text: t.replace(/^>\s?/, '').trim() }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { blocks.push({ kind: 'hr' }); continue; }
    blocks.push({ kind: 'p', text: t });
  }
  flushTable();
  if (fence) blocks.push({ kind: 'code', text: fence.lines.join('\n') });
  return blocks;
}

export function blocksToDocx(blocks, opts) {
  const o = opts || {};
  const out = [];
  blocks.forEach((b) => {
    if (b.kind === 'title') { out.push(para(b.text, { size: 44, font: FONTS.title, align: 'center', after: 240, line: 640 })); return; }
    if (/^h[1-6]$/.test(b.kind)) {
      const lv = Number(b.kind.slice(1));
      out.push(para(b.text, { size: HEADING_SIZE[lv], font: FONTS.heiti, bold: true, before: 180, after: 100, line: 480, keepNext: true }));
      return;
    }
    if (b.kind === 'bullet') { out.push(para('• ' + b.text, { size: 32, leftChars: 1, line: 520 })); return; }
    if (b.kind === 'ordered') { out.push(para((b.num || '1') + '. ' + b.text, { size: 32, leftChars: 1, line: 520 })); return; }
    if (b.kind === 'quote') { out.push(para(b.text, { size: 30, italic: true, leftChars: 1, line: 520 })); return; }
    if (b.kind === 'code') { out.push(para(b.text || ' ', { size: 20, font: FONTS.mono, ascii: FONTS.mono, leftChars: 1, line: 300, align: 'left' })); return; }
    if (b.kind === 'hr') { out.push(para('', { size: 16, line: 200 })); return; }
    if (b.kind === 'table') { out.push(para(b.rows.map((r) => r.join('  |  ')).join('\n'), { size: 28, line: 360, align: 'left' })); return; }
    out.push(para(b.text, { size: o.bodySize || 32, firstLineIndent: o.gongwen !== true, line: o.line || 560, align: 'both' }));
  });
  return out;
}

/* ============================ Word / HTML 转换 ============================ */

export async function docxToText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

export async function docxToHtml(buffer) {
  const result = await mammoth.convertToHtml({ buffer });
  return { html: result.value || '', messages: result.messages || [] };
}

export function htmlToMarkdown(html) {
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  return turndown.turndown(String(html || ''));
}

export function markdownToHtml(md) {
  return marked.parse(String(md || ''), { gfm: true, breaks: false });
}

/** 去掉脚本、内联事件与 javascript: 协议，避免导出的 HTML/预览执行任意代码。 */
export function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

export function standaloneHtml(bodyHtml, title) {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escXml(title || '文档') + '</title><style>' +
    '@page{size:A4;margin:18mm 16mm}body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:15px;line-height:1.85;color:#1f2937;max-width:820px;margin:0 auto;padding:32px 20px}' +
    'h1,h2,h3,h4{line-height:1.35;color:#111827;margin:1.1em 0 .5em}h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}' +
    'table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #cbd5e1;padding:6px 9px;text-align:left}th{background:#f1f5f9}' +
    'pre{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;overflow:auto}code{font-family:Consolas,monospace;font-size:13px}' +
    'blockquote{border-left:3px solid #93c5fd;margin:1em 0;padding:.2em 0 .2em 12px;color:#4b5563}img{max-width:100%}' +
    '</style></head><body>' + bodyHtml + '</body></html>';
}

/* ============================ HTML → Word ============================ */

export async function htmlToDocx(html, title) {
  const md = htmlToMarkdown(html);
  const blocks = markdownToBlocks(md);
  const paragraphs = blocksToDocx(blocks, {});
  return await buildDocx(paragraphs, { title: title || '文档', marginLeft: 25, marginRight: 25, marginTop: 25, marginBottom: 25 });
}

/* ============================ PPTX → PDF（文本与图片兜底渲染） ============================ */

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', emf: 'image/emf',
};

export async function pptxSlides(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  names.sort((a, b) => Number(a.replace(/\D+/g, '')) - Number(b.replace(/\D+/g, '')));
  const slides = [];
  for (const name of names) {
    const xml = await zip.file(name).async('string');
    const relPath = name.replace('slides/', 'slides/_rels/') + '.rels';
    const relXml = zip.file(relPath) ? await zip.file(relPath).async('string') : '';
    const rels = {};
    for (const m of relXml.matchAll(/Id="(rId\d+)"[^>]*?Target="([^"]+)"/g)) rels[m[1]] = m[2];
    const images = [];
    for (const m of xml.matchAll(/<a:blip[^>]*r:embed="(rId\d+)"/g)) {
      const target = rels[m[1]];
      if (!target) continue;
      const mediaPath = target.replace(/^\.\.\//, 'ppt/').replace(/^\//, '');
      const f = zip.file(mediaPath);
      if (!f) continue;
      const ext = (mediaPath.split('.').pop() || '').toLowerCase();
      if (!MIME_BY_EXT[ext]) continue;
      const b64 = await f.async('base64');
      images.push('data:' + MIME_BY_EXT[ext] + ';base64,' + b64);
    }
    const paras = [];
    for (const pm of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
      let text = '';
      for (const tm of pm[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) text += decodeXml(tm[1]);
      text = text.replace(/\s+/g, ' ').trim();
      if (text) paras.push(text);
    }
    slides.push({
      index: slides.length + 1,
      title: paras[0] || '幻灯片 ' + (slides.length + 1),
      lines: paras.slice(1),
      images,
    });
  }
  return slides;
}

export function slidesToHtml(slides, title) {
  const body = slides.map((s) => (
    '<section class="slide"><header><span class="sn">' + String(s.index).padStart(2, '0') + '</span><h2>' + escXml(s.title) + '</h2></header>' +
    (s.lines.length ? '<ul>' + s.lines.map((l) => '<li>' + escXml(l) + '</li>').join('') + '</ul>' : '') +
    (s.images.length ? '<div class="imgs">' + s.images.map((src) => '<img src="' + src + '" alt="">').join('') + '</div>' : '') +
    '</section>'
  )).join('');
  const css = '@page{size:A4 landscape;margin:8mm}' +
    'body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#111827;margin:0}' +
    '.slide{page-break-after:always;height:186mm;padding:10mm 12mm;box-sizing:border-box;display:flex;flex-direction:column;gap:6mm}' +
    '.slide:last-child{page-break-after:auto}' +
    '.slide header{display:flex;align-items:baseline;gap:10px;border-bottom:2px solid #2563eb;padding-bottom:6px}' +
    '.slide header .sn{font-size:12pt;color:#2563eb;font-weight:700;letter-spacing:.06em}' +
    '.slide header h2{font-size:26pt;margin:0;line-height:1.25}' +
    '.slide ul{margin:0;padding-left:8mm;font-size:16pt;line-height:1.7}' +
    '.slide .imgs{display:flex;flex-wrap:wrap;gap:6mm;align-items:flex-start}' +
    '.slide .imgs img{max-height:96mm;max-width:46%;object-fit:contain;border:1px solid #e5e7eb;border-radius:4px}' +
    '.slide-plain{font-size:12pt;color:#6b7280}';
  return { html: body, css, title: title || '演示文稿' };
}

/* ============================ 公文排版 ============================ */

export function gongwenBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
  const blocks = [];
  let titleDone = false;
  for (const line of lines) {
    if (!line) continue;
    if (!titleDone) { blocks.push({ kind: 'title', text: line }); titleDone = true; continue; }
    if (/^[一二三四五六七八九十]+、/.test(line)) { blocks.push({ kind: 'h1', text: line }); continue; }
    if (/^（[一二三四五六七八九十]+）/.test(line)) { blocks.push({ kind: 'h2', text: line }); continue; }
    if (/^\d+[.、．]/.test(line)) { blocks.push({ kind: 'h3', text: line }); continue; }
    if (/^附件[：:]?/.test(line)) { blocks.push({ kind: 'attachment', text: line }); continue; }
    blocks.push({ kind: 'p', text: line });
  }
  return blocks;
}

export function gongwenToDocx(blocks, opts) {
  const o = Object.assign({ pageNumbers: true, lineTwips: 560, attachBreak: true, bodySize: 32 }, opts || {});
  const paras = [];
  blocks.forEach((b) => {
    if (b.kind === 'title') {
      paras.push(para(b.text, { size: 44, font: FONTS.title, align: 'center', line: 560, before: 0, after: 320 }));
    } else if (b.kind === 'h1') {
      paras.push(para(b.text, { size: 32, font: FONTS.heiti, firstLineIndent: true, line: o.lineTwips, before: 60, after: 0 }));
    } else if (b.kind === 'h2') {
      paras.push(para(b.text, { size: 32, font: FONTS.kaiti, firstLineIndent: true, line: o.lineTwips, before: 60, after: 0 }));
    } else if (b.kind === 'h3') {
      paras.push(para(b.text, { size: 32, font: FONTS.body, bold: true, firstLineIndent: true, line: o.lineTwips }));
    } else if (b.kind === 'attachment') {
      paras.push(para(b.text, { size: 32, font: FONTS.heiti, line: o.lineTwips, pageBreak: o.attachBreak, before: 240, after: 120 }));
    } else {
      paras.push(para(b.text, { size: o.bodySize, font: FONTS.body, firstLineIndent: true, line: o.lineTwips }));
    }
  });
  return paras;
}

export function gongwenToHtml(blocks, opts) {
  const o = Object.assign({ attachBreak: true }, opts || {});
  const css = '@page{size:A4;margin:37mm 26mm 35mm 28mm}' +
    'body{font-family:"FangSong_GB2312","FangSong","仿宋_GB2312","仿宋",serif;font-size:16pt;line-height:1.75;color:#111}' +
    '.title{font-family:"FZXiaoBiaoSong-B05S","方正小标宋简体","STZhongsong","SimSun",serif;font-size:22pt;text-align:center;margin:0 0 18pt;line-height:1.5}' +
    '.h1{font-family:"SimHei","黑体",sans-serif;font-size:16pt;margin:6pt 0 0}' +
    '.h2{font-family:"KaiTi","楷体",serif;font-size:16pt;margin:6pt 0 0}' +
    '.h3{font-weight:700;font-size:16pt;margin:6pt 0 0}' +
    '.p{margin:0;text-indent:2em}' +
    '.attachment{page-break-before:always;font-family:"SimHei","黑体",sans-serif;margin:12pt 0 6pt}' +
    '@media print{.attachment{page-break-before:always}}';
  const body = blocks.map((b) => {
    if (b.kind === 'title') return '<div class="title">' + escXml(b.text) + '</div>';
    if (b.kind === 'h1') return '<div class="h1">' + escXml(b.text) + '</div>';
    if (b.kind === 'h2') return '<div class="h2">' + escXml(b.text) + '</div>';
    if (b.kind === 'h3') return '<div class="h3">' + escXml(b.text) + '</div>';
    if (b.kind === 'attachment') return '<div class="attachment">' + escXml(b.text) + '</div>';
    return '<p class="p">' + escXml(b.text) + '</p>';
  }).join('');
  return { html: body, css };
}

/* ============================ Markdown 表格生成器 ============================ */

export function mdTableMarkdown(opts) {
  const o = opts || {};
  const rows = Math.min(Math.max(Number(o.rows) || 3, 1), 50);
  const cols = Math.min(Math.max(Number(o.cols) || 3, 1), 20);
  const aligns = String(o.align || 'left').split(',');
  const names = String(o.headers || '').split(',').map((s) => s.trim()).filter(Boolean);
  const header = Array.from({ length: cols }, (_, i) => names[i] || '列' + (i + 1));
  const alignOf = (i) => {
    const a = (aligns[i] || aligns[0] || 'left').trim();
    if (a === 'center' || a === '中') return 'center';
    if (a === 'right' || a === '右') return 'right';
    return 'left';
  };
  const sep = header.map((_, i) => (alignOf(i) === 'center' ? ':---:' : alignOf(i) === 'right' ? '---:' : ':---'));
  const line = '| ' + header.join(' | ') + ' |';
  const sepLine = '| ' + sep.join(' | ') + ' |';
  const body = [];
  for (let r = 1; r <= rows; r++) {
    const cells = [];
    for (let c = 1; c <= cols; c++) cells.push(o.placeholder || ('单元格' + r + '-' + c));
    body.push('| ' + cells.join(' | ') + ' |');
  }
  return [line, sepLine, ...body].join('\n');
}
