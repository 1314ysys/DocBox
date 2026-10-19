import sharp from 'sharp';
import { WATERMARK_BY_ID, defaultSpec } from '../watermark-templates.mjs';

sharp.cache(false);
sharp.concurrency(1);

const FONT = 'Microsoft YaHei';

function escapeMarkup(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function alphaValue(opacity) {
  return Math.max(0, Math.min(65535, Math.round(Number(opacity) * 65535)));
}

async function textPng(text, { size, color = '#ffffff', alpha = 1, bold = false }) {
  const markup = '<span foreground="' + color + '" alpha="' + alphaValue(alpha) + '">' + escapeMarkup(text) + '</span>';
  const font = bold ? FONT + ' Bold ' + Math.round(size) : FONT + ' ' + Math.round(size);
  return sharp({ text: { text: markup, font, rgba: true, dpi: 96 } }).png().toBuffer();
}

async function measure(buffer) {
  const meta = await sharp(buffer).metadata();
  return { w: meta.width || 0, h: meta.height || 0 };
}

function wrapText(text, maxWidth, size) {
  const lines = [];
  let current = '';
  let currentW = 0;
  const widthOf = (ch) => (/[\x00-\x7F]/.test(ch) ? size * 0.56 : size * 0.98);
  for (const ch of String(text ?? '')) {
    if (ch === '\n') {
      if (current) lines.push(current);
      current = '';
      currentW = 0;
      continue;
    }
    const cw = widthOf(ch);
    if (currentW + cw > maxWidth && current) {
      lines.push(current);
      current = ch;
      currentW = cw;
    } else {
      current += ch;
      currentW += cw;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function hexToRgba(hex, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const v = m ? parseInt(m[1], 16) : 0x0f172a;
  return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + alpha + ')';
}

function cardBackground(w, h, { accent, radius, opacity }) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + hexToRgba('#0f172a', opacity) + '"/>' +
    '<stop offset="1" stop-color="' + hexToRgba('#020617', Math.min(0.9, opacity + 0.14)) + '"/>' +
    '</linearGradient></defs>' +
    '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="' + radius + '" fill="url(#g)"/>' +
    '<rect x="0" y="0" width="' + Math.max(5, Math.round(w * 0.008)) + '" height="' + h + '" rx="' + Math.round(w * 0.005) + '" fill="' + accent + '"/>' +
    '</svg>';
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayOf(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return WEEKDAYS[d.getDay()];
}

export function periodOf(timeStr) {
  const h = Number(String(timeStr || '').split(':')[0]);
  if (!Number.isFinite(h)) return '现场';
  if (h < 9) return '早晨';
  if (h < 12) return '上午';
  if (h < 14) return '中午';
  if (h < 18) return '下午';
  if (h < 20) return '傍晚';
  return '晚间';
}

function pad2(n) { return String(n).padStart(2, '0'); }

export function nowDate() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function nowTime() {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function normalizeSpec(raw = {}) {
  const tpl = WATERMARK_BY_ID[raw.template] || Object.values(WATERMARK_BY_ID)[0];
  const spec = defaultSpec(tpl.id);
  for (const [k, v] of Object.entries(raw || {})) {
    if (v === undefined || v === null) continue;
    spec[k] = v;
  }
  if (!spec.date) spec.date = nowDate();
  if (!spec.time) spec.time = nowTime();
  spec.lines = Array.isArray(spec.lines) ? spec.lines : String(spec.lines || '').split('\n');
  spec.lines = spec.lines.map((s) => String(s || '').trim()).filter(Boolean);
  spec.accent = spec.accent || tpl.accent;
  return { spec, tpl };
}

/**
 * 信息卡水印：左下角深色渐变卡 + 主色竖条。
 */
export async function renderCardWatermark(rawSpec, imageWidth, imageHeight) {
  const { spec, tpl } = normalizeSpec(rawSpec);
  const scale = Math.max(0.55, Math.min(1.6, Number(spec.scale) / 100 || 1));
  const cardW = Math.round(Math.min(imageWidth * 0.92, Math.max(430, imageWidth * 0.62 * scale)));
  const s = cardW / 900;
  const pad = 30 * s;
  const gap = 10 * s;
  const accent = spec.accent || tpl.accent || '#ff7a00';
  const opacity = Math.max(0.35, Math.min(0.98, Number(spec.opacity ?? 92) / 100));
  const white = '#ffffff';
  const muted = '#cbd5e1';
  const items = [];
  let cursorY = pad;
  let maxTextW = cardW - pad * 2;

  let logoBuf = null;
  let logoW = 0;
  if (spec.logo) {
    try {
      logoBuf = await sharp(spec.logo).resize({ height: Math.round(72 * s) }).png().toBuffer();
      const lm = await measure(logoBuf);
      logoW = lm.w;
      maxTextW = Math.max(120, cardW - pad * 2 - logoW - 18 * s);
    } catch { logoBuf = null; logoW = 0; }
  }

  async function addImage(buf, left, top) {
    items.push({ input: buf, left: Math.round(left), top: Math.round(top) });
  }

  async function pushLine(text, { size, color = white, alpha = 1, bold = false, gapAfter = gap, left = pad, maxWidth = maxTextW } = {}) {
    if (!text) return 0;
    for (const line of wrapText(text, maxWidth, size * s)) {
      const buf = await textPng(line, { size: size * s, color, alpha, bold });
      const m = await measure(buf);
      await addImage(buf, left, cursorY);
      cursorY += m.h + gapAfter;
    }
    return 1;
  }

  async function pushLabelValue(label, value, { size = 23, labelColor = muted, valueColor = white, gapAfter = gap } = {}) {
    if (!value) return;
    const labelText = label + '：';
    const labelBuf = await textPng(labelText, { size: size * s, color: labelColor, alpha: 0.95 });
    const labelM = await measure(labelBuf);
    const valueBuf = await textPng(value, { size: size * s, color: valueColor, alpha: 1 });
    const valueM = await measure(valueBuf);
    const w = labelM.w + valueM.w;
    if (w > maxTextW && labelM.w < maxTextW * 0.6) {
      await addImage(labelBuf, pad, cursorY);
      const rest = wrapText(value, maxTextW - labelM.w, size * s);
      const firstBuf = await textPng(rest[0], { size: size * s, color: valueColor });
      const firstM = await measure(firstBuf);
      await addImage(firstBuf, pad + labelM.w, cursorY);
      const rowH = Math.max(labelM.h, firstM.h);
      cursorY += rowH + gapAfter;
      for (const extra of rest.slice(1)) {
        const buf = await textPng(extra, { size: size * s, color: valueColor });
        const m = await measure(buf);
        await addImage(buf, pad, cursorY);
        cursorY += m.h + gapAfter;
      }
      return;
    }
    const rowH = Math.max(labelM.h, valueM.h);
    await addImage(labelBuf, pad, cursorY + (rowH - labelM.h));
    await addImage(valueBuf, pad + labelM.w, cursorY + (rowH - valueM.h));
    cursorY += rowH + gapAfter;
  }

  for (const row of tpl.rows) {
    if (row.type === 'brand') {
      const text = spec[row.key];
      if (text) await pushLine(text, { size: 34, color: white, bold: true, gapAfter: 8 * s });
    } else if (row.type === 'time') {
      const label = row.labelKey === 'period'
        ? (spec.period === 'auto' || !spec.period ? periodOf(spec.time) : spec.period)
        : (spec[row.labelKey] || '');
      const time = spec[row.key];
      if (!time) continue;
      const labelBuf = label ? await textPng(label, { size: 26 * s, color: muted, alpha: 0.95 }) : null;
      const timeBuf = await textPng(time, { size: 78 * s, color: white, bold: true });
      const timeM = await measure(timeBuf);
      const labelM = labelBuf ? await measure(labelBuf) : { w: 0, h: 0 };
      if (labelBuf) await addImage(labelBuf, pad, cursorY + timeM.h - labelM.h - 6 * s);
      await addImage(timeBuf, pad + labelM.w + (label ? 10 * s : 0), cursorY);
      cursorY += timeM.h + gap;
    } else if (row.type === 'meta') {
      const date = spec[row.dateKey];
      const weather = spec[row.weatherKey];
      const weekday = weekdayOf(date);
      const leftText = [date, weekday].filter(Boolean).join(' ');
      const rowTop = cursorY;
      let rowH = 0;
      if (leftText) {
        const buf = await textPng(leftText, { size: 26 * s, color: white, alpha: 0.95 });
        const m = await measure(buf);
        await addImage(buf, pad, rowTop);
        rowH = Math.max(rowH, m.h);
      }
      if (weather) {
        const buf = await textPng(weather, { size: 24 * s, color: '#e2e8f0', alpha: 0.9 });
        const m = await measure(buf);
        await addImage(buf, cardW - pad - m.w, rowTop);
        rowH = Math.max(rowH, m.h);
      }
      cursorY += rowH + 10 * s;
    } else if (row.type === 'location') {
      const value = spec[row.key];
      if (!value) continue;
      const dot = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="6" fill="' + accent + '"/><circle cx="9" cy="9" r="2" fill="#ffffff"/></svg>';
      const dotBuf = await sharp(Buffer.from(dot)).resize({ height: Math.round(18 * s) }).png().toBuffer();
      const dotM = await measure(dotBuf);
      const textBuf = await textPng(value, { size: 25 * s, color: white, alpha: 0.97 });
      const textM = await measure(textBuf);
      await addImage(dotBuf, pad, cursorY + Math.round((textM.h - dotM.h) / 2));
      const wrapped = wrapText(value, maxTextW - dotM.w - 12 * s, 25 * s);
      const firstBuf = await textPng(wrapped[0], { size: 25 * s, color: white, alpha: 0.97 });
      const firstM = await measure(firstBuf);
      await addImage(firstBuf, pad + dotM.w + 12 * s, cursorY);
      cursorY += Math.max(firstM.h, dotM.h) + gap;
      for (const extra of wrapped.slice(1)) {
        const buf = await textPng(extra, { size: 25 * s, color: white, alpha: 0.97 });
        const m = await measure(buf);
        await addImage(buf, pad + dotM.w + 12 * s, cursorY);
        cursorY += m.h + gap;
      }
    } else if (row.type === 'gps') {
      const value = spec[row.key];
      if (value) await pushLine('GPS ' + value, { size: 20, color: '#94a3b8', gapAfter: 8 * s });
    } else if (row.type === 'kv') {
      const label = row.label;
      const value = spec[row.key];
      if (value) await pushLabelValue(label, String(value));
    } else if (row.type === 'shot') {
      const date = spec[row.key];
      const time = spec[row.timeKey];
      if (date || time) await pushLabelValue(row.label, [date, time].filter(Boolean).join(' '), { size: 23 });
    } else if (row.type === 'note') {
      const value = spec[row.key];
      if (value) await pushLine(value, { size: 21, color: '#e2e8f0', alpha: 0.9 });
    }
  }

  const height = Math.max(190 * s, cursorY - gap + pad);
  const width = cardW;
  const bg = await sharp(Buffer.from(cardBackground(width, Math.round(height), { accent, radius: Math.round(18 * s), opacity }))).png().toBuffer();
  const composites = [{ input: bg, left: 0, top: 0 }, ...items];
  if (logoBuf) composites.push({ input: logoBuf, left: Math.round(cardW - pad - logoW), top: Math.round(pad) });

  let card = await sharp({
    create: { width, height: Math.round(height), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composites).png().toBuffer();

  let cardWidth = width;
  let cardHeight = Math.round(height);
  const maxCardHeight = Math.round(imageHeight * 0.82);
  if (cardHeight > maxCardHeight) {
    const ratio = maxCardHeight / cardHeight;
    card = await sharp(card).resize({ height: maxCardHeight }).png().toBuffer();
    cardHeight = maxCardHeight;
    cardWidth = Math.round(width * ratio);
  }
  return { buffer: card, width: cardWidth, height: cardHeight };
}

/**
 * 全图透明水印：多行文字 + 角度 + 透明度 + 行间距。
 * 平铺时按固定网格把整块文字重复铺满整张图（而不是只铺一个巨大的瓦片）。
 */
export async function renderTileWatermark(rawSpec, imageWidth, imageHeight) {
  const { spec } = normalizeSpec(rawSpec);
  const lines = spec.lines || [];
  if (!lines.length) throw new Error('请至少填写一行水印文字');
  const byWidth = Number(spec.size) > 0 ? (imageWidth * Number(spec.size)) / 100 : imageWidth * 0.032;
  const fontSize = Math.max(12, Math.min(Math.round(byWidth), Math.round(imageWidth * 0.1)));
  const color = spec.color || spec.accent || '#e11d48';
  const opacity = Math.max(0.03, Math.min(0.9, Number(spec.opacity ?? 22) / 100));
  const gapRatio = Math.max(0.4, Math.min(4, Number(spec.gap ?? 180) / 100));
  const lineGap = Math.round(fontSize * 0.55 * gapRatio * 0.6);
  const angle = Math.max(-90, Math.min(90, Number(spec.angle ?? -30)));

  const rendered = [];
  let maxW = 0;
  let totalH = 0;
  for (const line of lines) {
    const buf = await textPng(line, { size: fontSize, color, alpha: opacity, bold: true });
    const m = await measure(buf);
    rendered.push({ buf, w: m.w, h: m.h });
    maxW = Math.max(maxW, m.w);
    totalH += m.h + lineGap;
  }
  totalH -= lineGap;

  const blockPad = Math.round(fontSize * 0.3);
  const blockW = maxW + blockPad * 2;
  const blockH = totalH + blockPad * 2;
  const blockComposites = [];
  let y = blockPad;
  for (const r of rendered) {
    blockComposites.push({ input: r.buf, left: Math.round((blockW - r.w) / 2), top: y });
    y += r.h + lineGap;
  }
  const block = await sharp({
    create: { width: blockW, height: blockH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(blockComposites).png().toBuffer();

  const rotated = angle
    ? await sharp(block).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    : block;
  const rm = await measure(rotated);

  if (spec.layout === 'single') return { buffer: rotated, width: rm.w, height: rm.h, single: true };

  // 网格：步长由“行间距”控制，最小略小于文字块，保证铺满整张图
  const stepX = Math.max(Math.round(fontSize * 2.6), Math.round(rm.w * 0.42)) * Math.max(1, gapRatio * 0.55);
  const stepY = Math.max(Math.round(fontSize * 2.2), Math.round(rm.h * 0.7)) * Math.max(1, gapRatio * 0.5);
  const copies = [];
  let row = 0;
  for (let top = -rm.h; top < imageHeight + rm.h; top += stepY, row++) {
    const offset = (row % 2) * Math.round(stepX / 2);
    for (let left = -rm.w - offset; left < imageWidth + rm.w; left += stepX) {
      if (copies.length >= 160) break;
      copies.push({ input: rotated, left: Math.round(left), top: Math.round(top), blend: 'over' });
    }
    if (copies.length >= 160) break;
  }
  const canvas = await sharp({
    create: { width: imageWidth, height: imageHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(copies).png().toBuffer();
  return { buffer: canvas, width: imageWidth, height: imageHeight, single: false, copies: copies.length };
}

export async function applyWatermark(inputPath, rawSpec, logoPath = null) {
  const { spec, tpl } = normalizeSpec(rawSpec);
  if (logoPath) spec.logo = logoPath;
  const base = sharp(inputPath, { failOn: 'none' }).rotate();
  const meta = await base.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) throw new Error('无法读取图片尺寸');

  if (tpl.mode === 'tile') {
    const layer = await renderTileWatermark(spec, width, height);
    if (layer.single) {
      const pos = spec.position || 'center';
      const margin = Math.round(Math.min(width, height) * 0.06);
      let left = Math.round((width - layer.width) / 2);
      let top = Math.round((height - layer.height) / 2);
      if (pos.includes('left')) left = margin;
      if (pos.includes('right')) left = width - layer.width - margin;
      if (pos.startsWith('top')) top = margin;
      if (pos.startsWith('bottom')) top = height - layer.height - margin;
      return base.composite([{ input: layer.buffer, left: Math.max(0, left), top: Math.max(0, top), blend: 'over' }]).png().toBuffer();
    }
    return base.composite([{ input: layer.buffer, left: 0, top: 0, blend: 'over' }]).png().toBuffer();
  }

  const card = await renderCardWatermark(spec, width, height);
  const margin = Math.round(Math.min(width, height) * 0.045);
  let left = margin;
  let top = height - card.height - margin;
  const pos = spec.position || 'bottom-left';
  if (pos.includes('right')) left = width - card.width - margin;
  if (pos.startsWith('top')) top = margin;
  if (pos.startsWith('center')) {
    left = Math.round((width - card.width) / 2);
    top = Math.round((height - card.height) / 2);
  }
  return base.composite([{ input: card.buffer, left: Math.max(0, left), top: Math.max(0, top), blend: 'over' }]).png().toBuffer();
}

export { normalizeSpec };
