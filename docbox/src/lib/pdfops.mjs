/**
 * 原生 PDF 工具箱（替代外置 Stirling-PDF）：页面组织、增强、安全、转换、信息。
 * 全部在进程内完成：pdf-lib（编辑/加密）+ pdfjs（渲染/文本）+ sharp（图像分析）。
 */
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import sharp from 'sharp';
import { openPdf, pdfMeta, pageSize, renderPage, pageText, allText, closePdf } from './pdf-render.mjs';

export class PdfError extends Error {}

const fail = (msg) => { throw new PdfError(msg); };

export function parseRanges(input, total) {
  const text = String(input || '').trim();
  if (!text || text === 'all') return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set();
  for (const part of text.split(/[,，;；\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
    if (m) {
      let [a, b] = [Number(m[1]), Number(m[2])];
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n >= 1 && n <= total) out.add(n);
    } else if (/^\d+\s*[nN]\+?$/.test(part) || /^\d+n$/i.test(part)) {
      const n = Number(part.replace(/[^\d]/g, ''));
      if (n >= 1) for (let i = n; i <= total; i++) out.add(i);
    }
  }
  if (!out.size) fail('页码解析为空，请检查输入（例如 1,3,5-9）');
  return [...out].sort((a, b) => a - b);
}

async function loadDoc(buffer, password) {
  try {
    return await PDFDocument.load(buffer, { ignoreEncryption: false, password, updateMetadata: false });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (/encrypt|password|decrypt/i.test(msg)) fail('文件已加密，请先使用“PDF 解密”并提供正确密码');
    fail('无法解析该 PDF：' + msg.slice(0, 120));
  }
}

async function newDocWithPages(src, indices, meta = true) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices.map((i) => i - 1));
  pages.forEach((p) => out.addPage(p));
  if (meta) {
    out.setProducer('DocBox 0.1.1');
    out.setCreator('DocBox');
    const t = src.getTitle(); if (t) out.setTitle(t);
  }
  return out;
}

const pageBytes = async (doc) => Buffer.from(await doc.save({ useObjectStreams: true }));

// ---------------------------------------------------------------- 页面组织
async function rotate(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const total = doc.getPageCount();
  const pages = parseRanges(f.pages || 'all', total);
  const angle = ((Number(f.angle) || 90) % 360 + 360) % 360;
  for (const n of pages) {
    const page = doc.getPage(n - 1);
    page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  }
  return { outputs: [{ name: baseOf(file.name) + '_rotated.pdf', buffer: await pageBytes(doc) }], note: `旋转 ${pages.length} 页 ${angle}°（本地引擎）` };
}

async function removePages(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const total = doc.getPageCount();
  const remove = new Set(parseRanges(f.pages, total));
  const keep = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !remove.has(n));
  if (!keep.length) fail('不能删除全部页面');
  const out = await newDocWithPages(doc, keep);
  return { outputs: [{ name: baseOf(file.name) + '_removed.pdf', buffer: await pageBytes(out) }], note: `已删除 ${remove.size} 页，剩余 ${keep.length} 页` };
}

async function rearrange(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const total = doc.getPageCount();
  const order = parseRanges(f.order, total);
  if (!order.length) fail('请给出新的页面顺序');
  const seen = new Set(order);
  const rest = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !seen.has(n));
  const finalOrder = [...order, ...rest];
  const out = await newDocWithPages(doc, finalOrder);
  return { outputs: [{ name: baseOf(file.name) + '_reordered.pdf', buffer: await pageBytes(out) }], note: `按新顺序重排 ${finalOrder.length} 页` };
}

async function contentBBox(buffer) {
  const img = sharp(buffer);
  const { info } = await img.trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
  return info;
}

async function crop(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const total = doc.getPageCount();
  const pages = parseRanges(f.pages || 'all', total);
  let applied = 0;
  if (f.autoCrop === 'true' || f.autoCrop === true) {
    const pdfjsDoc = await openPdf(await doc.save({ useObjectStreams: true }));
    for (const n of pages) {
      const page = doc.getPage(n - 1);
      const { width, height } = page.getSize();
      const rendered = await renderPage(pdfjsDoc, n, { dpi: 72 });
      const trimmed = await sharp(rendered.buffer).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
      const t = trimmed.info;
      const px = rendered.width / width;
      const x = Math.max(0, Math.floor(t.trimOffsetLeft / px));
      const y = Math.max(0, Math.floor(t.trimOffsetTop / px));
      const w = Math.max(20, Math.ceil(t.width / px));
      const h = Math.max(20, Math.ceil(t.height / px));
      page.setCropBox(x, y, Math.min(w, width - x), Math.min(h, height - y));
      applied++;
    }
    await closePdf(pdfjsDoc);
  } else {
    const x = Number(f.x) || 0;
    const y = Number(f.y) || 0;
    for (const n of pages) {
      const page = doc.getPage(n - 1);
      const { width, height } = page.getSize();
      const w = Number(f.width) > 0 ? Math.min(Number(f.width), width - x) : width - x;
      const h = Number(f.height) > 0 ? Math.min(Number(f.height), height - y) : height - y;
      if (w < 10 || h < 10) continue;
      page.setCropBox(x, y, w, h);
      applied++;
    }
  }
  return { outputs: [{ name: baseOf(file.name) + '_cropped.pdf', buffer: await pageBytes(doc) }], note: `已裁剪 ${applied} 页（本地引擎）` };
}

const PAPER = { a4: [595.28, 841.89], a3: [841.89, 1190.55], letter: [612, 792], legal: [612, 1008] };

async function scalePages(file, f) {
  const src = await loadDoc(file.buffer, f.password);
  const total = src.getPageCount();
  const pages = parseRanges(f.pages || 'all', total);
  const factor = Number(f.factor) || 1;
  const mode = f.mode || 'a4';
  const out = await PDFDocument.create();
  for (const n of pages) {
    const page = src.getPage(n - 1);
    const { width, height } = page.getSize();
    let targetW = width * factor;
    let targetH = height * factor;
    if (mode === 'paper') {
      const size = PAPER[String(f.paper || 'a4').toLowerCase()] || PAPER.a4;
      const landscape = String(f.orientation) === 'landscape' || width > height;
      targetW = landscape ? size[1] : size[0];
      targetH = landscape ? size[0] : size[1];
    }
    const target = out.addPage([targetW, targetH]);
    const embedded = await out.embedPage(page);
    const fit = Math.min(targetW / width, targetH / height);
    target.drawPage(embedded, {
      x: (targetW - width * fit) / 2,
      y: (targetH - height * fit) / 2,
      width: width * fit,
      height: height * fit,
    });
  }
  return { outputs: [{ name: baseOf(file.name) + '_scaled.pdf', buffer: await pageBytes(out) }], note: `已重排 ${pages.length} 页到 ${mode === 'paper' ? f.paper || 'A4' : factor + ' 倍'}` };
}

const GRID = { 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3], 16: [4, 4] };

async function nup(file, f) {
  const src = await loadDoc(file.buffer, f.password);
  const total = src.getPageCount();
  const per = [2, 4, 6, 9, 16].includes(Number(f.perSheet)) ? Number(f.perSheet) : 4;
  const [cols, rows] = GRID[per];
  const paper = PAPER[String(f.paper || 'a4').toLowerCase()] || PAPER.a4;
  const portrait = String(f.orientation) !== 'landscape';
  const [pw, ph] = portrait ? paper : [paper[1], paper[0]];
  const margin = 14;
  const cellW = (pw - margin * 2) / cols;
  const cellH = (ph - margin * 2) / rows;
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());
  for (let i = 0; i < total; i += per) {
    const sheet = out.addPage([pw, ph]);
    for (let k = 0; k < per && i + k < total; k++) {
      const ep = embedded[i + k];
      const box = ep.scale(1);
      const fit = Math.min((cellW - 6) / box.width, (cellH - 6) / box.height);
      const w = box.width * fit;
      const h = box.height * fit;
      const col = k % cols;
      const row = Math.floor(k / cols);
      sheet.drawPage(ep, {
        x: margin + col * cellW + (cellW - w) / 2,
        y: ph - margin - (row + 1) * cellH + (cellH - h) / 2,
        width: w,
        height: h,
      });
    }
  }
  return { outputs: [{ name: baseOf(file.name) + `_${per}up.pdf`, buffer: await pageBytes(out) }], note: `每页 ${per} 张，共 ${Math.ceil(total / per)} 页` };
}

async function booklet(file, f) {
  const src = await loadDoc(file.buffer, f.password);
  const total = src.getPageCount();
  const paper = PAPER[String(f.paper || 'a4').toLowerCase()] || PAPER.a4;
  const [pw, ph] = [paper[1], paper[0]];
  const out = await PDFDocument.create();
  const embedded = await out.embedPages(src.getPages());
  const sheets = Math.ceil(total / 4);
  const pw2 = pw / 2;
  const put = (sheet, index, left) => {
    if (index < 0 || index >= total) return;
    const ep = embedded[index];
    const box = ep.scale(1);
    const fit = Math.min((pw2 - 20) / box.width, (ph - 20) / box.height);
    const w = box.width * fit;
    const h = box.height * fit;
    sheet.drawPage(ep, { x: (left ? 10 : pw2 + 10) + (pw2 - 20 - w) / 2, y: (ph - h) / 2, width: w, height: h });
  };
  for (let s = 0; s < sheets; s++) {
    const front = out.addPage([pw, ph]);
    put(front, total - 2 * s - 1, true);
    put(front, 2 * s, false);
    const back = out.addPage([pw, ph]);
    put(back, 2 * s + 1, true);
    if (total - 2 * s - 2 >= 0) put(back, total - 2 * s - 2, false);
  }
  return { outputs: [{ name: baseOf(file.name) + '_booklet.pdf', buffer: await pageBytes(out) }], note: `小册子：${sheets} 张纸（${sheets * 2} 页）` };
}

async function splitPdf(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const total = doc.getPageCount();
  const mode = f.mode || 'every';
  const groups = [];
  if (mode === 'ranges') {
    const text = String(f.ranges || '').trim();
    if (!text) fail('请填写页码范围，例如 1-2,3-5');
    for (const part of text.split(/[,，;；]+/).filter(Boolean)) {
      groups.push({ label: part.replace(/[^\d-]/g, ''), pages: parseRanges(part, total) });
    }
  } else if (mode === 'sections') {
    const size = Math.max(1, Number(f.size) || 5);
    for (let i = 0; i < total; i += size) {
      groups.push({ label: `${i + 1}-${Math.min(total, i + size)}`, pages: Array.from({ length: Math.min(size, total - i) }, (_, k) => i + k + 1) });
    }
  } else {
    const every = Math.max(1, Number(f.every) || 1);
    for (let i = 0; i < total; i += every) {
      groups.push({ label: `${i + 1}`, pages: Array.from({ length: Math.min(every, total - i) }, (_, k) => i + k + 1) });
    }
  }
  const outputs = [];
  for (const g of groups) {
    if (!g.pages.length) continue;
    const out = await newDocWithPages(doc, g.pages, false);
    outputs.push({ name: `${baseOf(file.name)}_p${g.label}.pdf`, buffer: await pageBytes(out) });
  }
  if (!outputs.length) fail('没有生成任何分段');
  return { outputs, note: `共 ${total} 页，已生成 ${outputs.length} 个文件` };
}

// ---------------------------------------------------------------- 页面增强
async function overlay(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const overlayDoc = await loadDoc(f.overlayFile, f.overlayPassword);
  const total = doc.getPageCount();
  const pages = parseRanges(f.pages || 'all', total);
  const [ov] = await doc.embedPdf(overlayDoc, [0]);
  for (const n of pages) {
    const page = doc.getPage(n - 1);
    const { width, height } = page.getSize();
    const box = ov.scale(1);
    const fit = Math.min(width / box.width, height / box.height);
    page.drawPage(ov, { x: (width - box.width * fit) / 2, y: (height - box.height * fit) / 2, width: box.width * fit, height: box.height * fit, opacity: 1 });
  }
  return { outputs: [{ name: baseOf(file.name) + '_overlay.pdf', buffer: await pageBytes(doc) }], note: `已叠加水印页到 ${pages.length} 页` };
}

async function singlePage(file, f) {
  const src = await loadDoc(file.buffer, f.password);
  const total = src.getPageCount();
  const embedded = await src.embedPages(src.getPages());
  const gap = Number(f.gap) || 0;
  let maxW = 0;
  let sumH = 0;
  for (const ep of embedded) {
    const box = ep.scale(1);
    maxW = Math.max(maxW, box.width);
    sumH += box.height + gap;
  }
  const out = await PDFDocument.create();
  const page = out.addPage([maxW, sumH]);
  let y = sumH;
  for (const ep of embedded) {
    const box = ep.scale(1);
    y -= box.height;
    page.drawPage(ep, { x: (maxW - box.width) / 2, y, width: box.width, height: box.height });
    y -= gap;
  }
  return { outputs: [{ name: baseOf(file.name) + '_single.pdf', buffer: await pageBytes(out) }], note: `已拼接 ${total} 页为一页（高 ${Math.round(sumH)}pt）` };
}

async function decompress(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const before = file.buffer.length;
  const buffer = Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false }));
  const delta = buffer.length - before;
  return {
    outputs: [{ name: baseOf(file.name) + '_decompressed.pdf', buffer }],
    note: `已重写结构、移除对象流压缩（${fmtKb(before)} → ${fmtKb(buffer.length)}${delta >= 0 ? '+' : ''}${fmtKb(delta)}）`,
  };
}

async function flatten(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  let fields = 0;
  try {
    const form = doc.getForm();
    fields = form.getFields().length;
    if (fields) form.flatten();
  } catch { /* 没有表单 */ }
  return {
    outputs: [{ name: baseOf(file.name) + '_flat.pdf', buffer: await pageBytes(doc) }],
    note: fields ? `已扁平化 ${fields} 个表单字段` : '该文档没有可扁平化的表单字段（已原样输出）',
  };
}

async function removeBlanks(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const total = doc.getPageCount();
  const pdfjsDoc = await openPdf(await doc.save({ useObjectStreams: true }));
  const keep = [];
  const removed = [];
  for (let n = 1; n <= total; n++) {
    const text = await pageText(pdfjsDoc, n);
    let blank = text.length === 0;
    if (blank) {
      const rendered = await renderPage(pdfjsDoc, n, { dpi: 50 });
      const stats = await sharp(rendered.buffer).greyscale().stats();
      blank = stats.channels[0].stdev < 2.2 && stats.channels[0].mean > 245;
    }
    if (blank) removed.push(n); else keep.push(n);
  }
  await closePdf(pdfjsDoc);
  if (!keep.length) fail('所有页面都被判定为空白，已取消操作');
  const out = await newDocWithPages(doc, keep);
  return {
    outputs: [{ name: baseOf(file.name) + '_noblank.pdf', buffer: await pageBytes(out) }],
    note: removed.length ? `已移除 ${removed.length} 个空白页（第 ${removed.join(',')} 页）` : '未发现空白页',
  };
}

// ---------------------------------------------------------------- 安全
async function encrypt(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  const userPassword = String(f.userPassword || '');
  const ownerPassword = String(f.ownerPassword || '') || userPassword;
  if (!userPassword) fail('请填写打开密码');
  const permissions = {
    printing: f.allowPrinting === 'true' ? 'highResolution' : false,
    copying: f.allowCopying === 'true',
    modifying: f.allowModifying === 'true',
    annotating: f.allowAnnotating === 'true',
    fillingForms: f.allowModifying === 'true',
    contentAccessibility: true,
    documentAssembly: false,
  };
  doc.encrypt({ userPassword, ownerPassword, permissions, algorithm: f.algorithm || 'AES-256' });
  return {
    outputs: [{ name: baseOf(file.name) + '_encrypted.pdf', buffer: Buffer.from(await doc.save({ useObjectStreams: true })) }],
    note: `已加密（${f.algorithm || 'AES-256'}），打开密码 ${userPassword.length} 位`,
  };
}

async function decrypt(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  if (!doc.isEncrypted) return { outputs: [{ name: baseOf(file.name) + '_decrypted.pdf', buffer: file.buffer }], note: '该文档未加密，已原样输出' };
  return { outputs: [{ name: baseOf(file.name) + '_decrypted.pdf', buffer: await pageBytes(doc) }], note: '已移除加密保护' };
}

async function sanitize(file) {
  const { PDFName, PDFDict, PDFArray } = await import('@cantoo/pdf-lib');
  const doc = await loadDoc(file.buffer);
  const ctx = doc.context;
  const catalog = doc.catalog;
  const removed = [];
  const drop = (dict, key, label) => {
    const name = PDFName.of(key);
    if (dict.has && dict.has(name)) { dict.delete(name); removed.push(label); }
  };
  for (const key of ['OpenAction', 'AA', 'Metadata', 'Outlines', 'Names']) {
    if (key === 'Names') { drop(catalog, 'Names', '嵌入式文件/命名树'); continue; }
    drop(catalog, key, key === 'Metadata' ? 'XMP 元数据' : key);
  }
  const namesDict = catalog.get(PDFName.of('Names'));
  const namesValue = namesDict ? ctx.lookup(namesDict) : null;
  if (namesValue instanceof PDFDict && namesValue.has(PDFName.of('EmbeddedFiles'))) {
    namesValue.delete(PDFName.of('EmbeddedFiles'));
    removed.push('附件');
  }
  let jsCount = 0;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      if (obj.has(PDFName.of('JS')) || obj.has(PDFName.of('JavaScript'))) {
        obj.delete(PDFName.of('JS'));
        obj.delete(PDFName.of('JavaScript'));
        jsCount++;
      }
      if (obj.has(PDFName.of('OpenAction'))) obj.delete(PDFName.of('OpenAction'));
    }
    if (obj instanceof PDFArray && obj.size() > 0) {
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.lookup(i);
        if (v instanceof PDFDict && (v.has(PDFName.of('JS')) || v.has(PDFName.of('JavaScript')))) {
          obj.remove(i); i--; jsCount++;
        }
      }
    }
  }
  if (jsCount) removed.push(`脚本动作 ×${jsCount}`);
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setCreator('DocBox');
  doc.setProducer('DocBox 0.1.1');
  return {
    outputs: [{ name: baseOf(file.name) + '_sanitized.pdf', buffer: await pageBytes(doc) }],
    note: removed.length ? '已清理：' + [...new Set(removed)].join('、') : '未发现可清理的脚本/附件/元数据（已重写文档）',
  };
}

// ---------------------------------------------------------------- 元数据 / 书签
async function metadata(file) {
  const doc = await loadDoc(file.buffer, file.password);
  const pdfjsDoc = await openPdf(await doc.save({ useObjectStreams: true }));
  const meta = await pdfMeta(pdfjsDoc);
  const sizes = [];
  const set = new Set();
  for (let i = 1; i <= Math.min(meta.pages, 20); i++) {
    const s = await pageSize(pdfjsDoc, i);
    sizes.push({ page: i, ...s });
    set.add(`${s.width}×${s.height}`);
  }
  await closePdf(pdfjsDoc);
  return {
    data: {
      pages: meta.pages,
      title: doc.getTitle() || meta.title || '',
      author: doc.getAuthor() || meta.author || '',
      subject: doc.getSubject() || meta.subject || '',
      keywords: (doc.getKeywords() || meta.keywords || '').slice(0, 500),
      creator: doc.getCreator() || meta.creator || '',
      producer: doc.getProducer() || meta.producer || '',
      creationDate: meta.creationDate,
      encrypted: Boolean(doc.isEncrypted),
      sizes: sizes.slice(0, 10),
      sizeVariants: [...set].slice(0, 8),
      fileSize: file.buffer.length,
    },
    note: `${meta.pages} 页 · ${[...set].join(' / ')}`,
  };
}

async function setMetadata(file, f) {
  const doc = await loadDoc(file.buffer, f.password);
  if (f.title !== undefined) doc.setTitle(String(f.title));
  if (f.author !== undefined) doc.setAuthor(String(f.author));
  if (f.subject !== undefined) doc.setSubject(String(f.subject));
  if (f.keywords !== undefined) doc.setKeywords(String(f.keywords).split(/[,，;；\s]+/).filter(Boolean));
  if (f.creator !== undefined) doc.setCreator(String(f.creator));
  doc.setProducer('DocBox 0.1.1');
  doc.setModificationDate(new Date());
  return { outputs: [{ name: baseOf(file.name) + '_meta.pdf', buffer: await pageBytes(doc) }], note: '已更新文档属性' };
}

async function bookmarks(file, f) {
  const lib = await import('@cantoo/pdf-lib');
  const { PDFName, PDFDict } = lib;
  const doc = await loadDoc(file.buffer, f.password);
  const ctx = doc.context;
  const outline = [];
  const dictOf = (ref) => {
    if (!ref) return undefined;
    const v = ctx.lookup(ref);
    return v instanceof PDFDict ? v : undefined;
  };
  const walk = (node, depth) => {
    let guard = 0;
    while (node && guard++ < 500 && outline.length < 500) {
      const titleObj = node.get(PDFName.of('Title'));
      let text = '';
      if (titleObj) {
        const v = ctx.lookup(titleObj);
        text = String(v && v.decodeText ? v.decodeText() : v || '').replace(/^\(|\)$/g, '');
      }
      if (text) outline.push({ depth, title: text });
      const child = dictOf(node.get(PDFName.of('First')));
      if (child && depth < 5) walk(child, depth + 1);
      node = dictOf(node.get(PDFName.of('Next')));
    }
  };
  const outlines = dictOf(doc.catalog.get(PDFName.of('Outlines')));
  if (outlines) walk(dictOf(outlines.get(PDFName.of('First'))), 0);
  return { data: { count: outline.length, outline }, note: outline.length ? `共 ${outline.length} 条书签` : '该文档没有书签' };
}

// ---------------------------------------------------------------- 转换
async function pdfToImages(file, f) {
  const doc = await openPdf(file.buffer);
  const total = doc.numPages;
  const pages = parseRanges(f.pages || 'all', total);
  const format = f.format === 'jpg' ? 'jpg' : 'png';
  const dpi = Math.max(72, Math.min(Number(f.dpi) || 150, 400));
  const outputs = [];
  for (const n of pages) {
    const img = await renderPage(doc, n, { dpi, format, quality: Number(f.quality) || 85 });
    outputs.push({ name: `${baseOf(file.name)}_p${n}.${format}`, buffer: img.buffer });
  }
  await closePdf(doc);
  return { outputs, note: `已导出 ${outputs.length} 张图片（${dpi} DPI）` };
}

async function pdfToText(file, f) {
  const doc = await openPdf(file.buffer);
  const pages = await allText(doc);
  await closePdf(doc);
  const withHeader = f.withPageMarkers !== 'false';
  const body = pages.map((p) => (withHeader ? `\n===== 第 ${p.page} 页 =====\n` : '') + p.text).join('\n');
  return {
    outputs: [{ name: baseOf(file.name) + '.txt', buffer: Buffer.from(body, 'utf8') }],
    note: `已提取 ${pages.length} 页文字（${body.length} 字）`,
  };
}

async function extractImages(file, f) {
  const { PDFName, PDFDict, PDFRawStream, PDFStream } = await import('@cantoo/pdf-lib');
  const doc = await loadDoc(file.buffer, f.password);
  const outputs = [];
  let index = 0;
  const seen = new Set();
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    if (!resources) continue;
    const xobj = resources.lookup(PDFName.of('XObject'), PDFDict);
    if (!xobj) continue;
    for (const [key] of xobj.entries()) {
      const ref = xobj.get(key);
      const refKey = ref && ref.toString ? ref.toString() : key.toString();
      if (seen.has(refKey)) continue;
      seen.add(refKey);
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFStream) && !(stream instanceof PDFRawStream)) continue;
      const dict = stream.dict;
      const subtype = doc.context.lookup(dict.get(PDFName.of('Subtype')));
      if (!subtype || String(subtype) !== '/Image') continue;
      const filterObj = doc.context.lookup(dict.get(PDFName.of('Filter')));
      const filterName = filterObj ? String(filterObj) : '';
      const widthObj = doc.context.lookup(dict.get(PDFName.of('Width')));
      const heightObj = doc.context.lookup(dict.get(PDFName.of('Height')));
      const width = widthObj && widthObj.asNumber ? widthObj.asNumber() : 0;
      const height = heightObj && heightObj.asNumber ? heightObj.asNumber() : 0;
      if (width * height < 2500) continue;
      try {
        let buffer = null;
        let ext = 'png';
        if (filterName.includes('DCTDecode')) {
          buffer = Buffer.from(stream.contents);
          ext = 'jpg';
        } else {
          const raw = stream instanceof PDFRawStream ? await stream.decode() : stream.getContents();
          const csObj = doc.context.lookup(dict.get(PDFName.of('ColorSpace')));
          const colorSpace = csObj ? String(csObj) : '/DeviceRGB';
          const channels = colorSpace.includes('Gray') ? 1 : colorSpace.includes('CMYK') ? 4 : 3;
          buffer = await sharp(Buffer.from(raw), { raw: { width, height, channels } }).png().toBuffer();
          ext = 'png';
        }
        if (!buffer || !buffer.length) continue;
        outputs.push({ name: `${baseOf(file.name)}_img${++index}.${ext}`, buffer });
        if (outputs.length >= 40) break;
      } catch { /* 跳过无法解码的图像 */ }
    }
    if (outputs.length >= 40) break;
  }
  if (!outputs.length) fail('未在该 PDF 中找到可提取的嵌入图片');
  return { outputs, note: `提取 ${outputs.length} 张嵌入图片` };
}

async function imagesToPdf(files, f) {
  const doc = await PDFDocument.create();
  const paper = PAPER[String(f.pageSize || 'fit').toLowerCase()];
  for (const file of files) {
    const isJpg = /\.jpe?g$/i.test(file.name);
    let image;
    if (isJpg) {
      try { image = await doc.embedJpg(file.buffer); } catch { image = await doc.embedPng(await sharp(file.buffer).png().toBuffer()); }
    } else {
      image = await doc.embedPng(await sharp(file.buffer).rotate().png().toBuffer());
    }
    if (paper) {
      const landscape = image.width > image.height;
      const [pw, ph] = landscape ? [paper[1], paper[0]] : paper;
      const page = doc.addPage([pw, ph]);
      const margin = Number(f.margin) || 0;
      const fit = Math.min((pw - margin * 2) / image.width, (ph - margin * 2) / image.height);
      page.drawImage(image, { x: (pw - image.width * fit) / 2, y: (ph - image.height * fit) / 2, width: image.width * fit, height: image.height * fit });
    } else {
      const page = doc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
  }
  return { outputs: [{ name: 'images_' + files.length + 'p.pdf', buffer: await pageBytes(doc) }], note: `已合成 ${files.length} 页 PDF（本地引擎）` };
}

// ---------------------------------------------------------------- 工具表
const IMPL = {
  'rotate': rotate,
  'remove-pages': removePages,
  'rearrange': rearrange,
  'crop': crop,
  'scale': scalePages,
  'nup': nup,
  'booklet': booklet,
  'split': splitPdf,
  'overlay': overlay,
  'single-page': singlePage,
  'decompress': decompress,
  'flatten': flatten,
  'remove-blanks': removeBlanks,
  'encrypt': encrypt,
  'decrypt': decrypt,
  'sanitize': sanitize,
  'metadata': metadata,
  'set-metadata': setMetadata,
  'pdf2img': pdfToImages,
  'pdf2text': pdfToText,
  'extract-images': extractImages,
  'img2pdf': imagesToPdf,
  'bookmarks': bookmarks,
};

export const PDF_TOOL_IDS = Object.keys(IMPL);

export async function runPdfTool(id, files, fields) {
  const fn = IMPL[id];
  if (!fn) fail('未知的 PDF 工具：' + id);
  const file = files && files[0] ? files[0] : null;
  if (!file && id !== 'img2pdf') fail('请先选择 PDF 文件');
  return fn(id === 'img2pdf' ? files : file, fields || {});
}

function baseOf(name) {
  return String(name || 'file').replace(/\.[^.]+$/, '').replace(/\s+/g, '_').slice(0, 80) || 'file';
}
function fmtKb(n) {
  const v = Number(n) || 0;
  return v >= 1024 * 1024 ? (v / 1024 / 1024).toFixed(1) + 'MB' : Math.round(v / 1024) + 'KB';
}
