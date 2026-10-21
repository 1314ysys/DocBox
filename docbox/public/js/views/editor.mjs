import { $, esc, fmtBytes } from '../core/dom.mjs';
import { downloadUrl } from '../core/api.mjs';
import { toast } from '../core/ui.mjs';

let ed = null;

export function renderEditor() {
  ed = {
    current: null,
    history: [],
    crop: null,
    ratio: 1,
    zoom: 1,
    fit: 1,
    cssScale: 1,
    name: 'image',
    dragStart: null,
  };
  const canvas = $('#edCanvas');
  const wrap = $('#edWrap');

  $('#edPick').onclick = (e) => { e.stopPropagation(); $('#edFile').click(); };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target === $('#edEmpty')) $('#edFile').click();
  });
  wrap.addEventListener('dragover', (e) => e.preventDefault());
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) loadImage(file);
  });
  $('#edFile').onchange = () => {
    const file = $('#edFile').files?.[0];
    if (file) loadImage(file);
    $('#edFile').value = '';
  };
  $('#edChange').onclick = () => $('#edFile').click();
  $('#edUndo').onclick = undo;
  $('#edReset').onclick = reset;

  document.querySelectorAll('[data-ed]').forEach((btn) => {
    btn.onclick = () => transform(btn.dataset.ed);
  });

  $('#edWidth').oninput = syncLock;
  $('#edHeight').oninput = syncLock;
  $('#edResize').onclick = resizeImage;
  $('#edCropApply').onclick = applyCrop;
  $('#edCropClear').onclick = clearCrop;

  ['edBrightness', 'edContrast', 'edSaturation'].forEach((id) => {
    const input = $('#' + id);
    input.oninput = () => { $('#' + id + 'V').textContent = input.value + '%'; };
  });
  $('#edAdjust').onclick = applyAdjust;
  $('#edAddText').onclick = addText;
  $('#edQuality').oninput = () => { $('#edQualityV').textContent = $('#edQuality').value + '%'; };
  $('#edExport').onclick = exportImage;

  $('#edZoomIn').onclick = () => zoomAt(ed.zoom * 1.25, null);
  $('#edZoomOut').onclick = () => zoomAt(ed.zoom / 1.25, null);
  $('#edZoomFit').onclick = () => { ed.zoom = 1; applyZoom(); fitScroll(); };
  bindCropDrag();
}

function loadImage(file) {
  if (!file.type.startsWith('image/')) { toast('请选择图片文件', 'error'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    cv.getContext('2d').drawImage(img, 0, 0);
    ed.current = cv;
    ed.history = [];
    ed.name = file.name.replace(/\.[^.]+$/, '');
    ed.ratio = cv.width / cv.height;
    $('#edEmpty').hidden = true;
    $('#edWidth').value = cv.width;
    $('#edHeight').value = cv.height;
    $('#edInfo').textContent = cv.width + ' × ' + cv.height + ' px · ' + fmtBytes(file.size);
    $('#edExport').disabled = false;
    $('#edReset').disabled = false;
    $('#edUndo').disabled = true;
    render();
    toast('图片已载入');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('图片读取失败', 'error'); };
  img.src = url;
}

function render() {
  const canvas = $('#edCanvas');
  const wrap = $('#edWrap');
  if (!ed.current) return;
  // 画布始终按原图 1:1 绘制，缩放只改 CSS 尺寸：
  // 这样选区坐标永远等于原图坐标，且放大后仍是原始像素（不糊）。
  canvas.width = ed.current.width;
  canvas.height = ed.current.height;
  canvas.getContext('2d').drawImage(ed.current, 0, 0);
  const maxW = Math.min((wrap.clientWidth || 900) - 36, 1000);
  const maxH = Math.max(320, window.innerHeight * 0.62);
  ed.fit = Math.min(maxW / ed.current.width, maxH / ed.current.height, 1) || 1;
  if (ed.zoom > 1) ed.zoom = Math.min(ed.zoom, 12);
  applyZoom();
  fitScroll();
}

/** 按 fit × zoom 设置画布显示尺寸，并同步缩放百分比 */
function applyZoom() {
  const canvas = $('#edCanvas');
  if (!ed.current) return;
  ed.cssScale = Math.max(0.02, Math.min(12, (ed.fit || 1) * (ed.zoom || 1)));
  canvas.style.width = Math.max(1, Math.round(ed.current.width * ed.cssScale)) + 'px';
  canvas.style.height = Math.max(1, Math.round(ed.current.height * ed.cssScale)) + 'px';
  const zv = $('#edZoomVal');
  if (zv) zv.textContent = Math.abs(ed.zoom - 1) < 0.02 ? '适应' : Math.round(ed.cssScale * 100) + '%';
  drawCropBox();
}

/** 居中滚动（未放大时无滚动条，等同无效） */
function fitScroll() {
  const wrap = $('#edWrap');
  if (!wrap) return;
  wrap.scrollLeft = Math.max(0, (wrap.scrollWidth - wrap.clientWidth) / 2);
  wrap.scrollTop = Math.max(0, (wrap.scrollHeight - wrap.clientHeight) / 2);
}

/** 以某个锚点（鼠标位置）为中心缩放，锚点保持不动 */
function zoomAt(nextZoom, e) {
  const wrap = $('#edWrap');
  const stage = $('#edStage');
  const prev = ed.cssScale || 1;
  ed.zoom = Math.max(0.2, Math.min(12, Number(nextZoom) || 1));
  const wr = wrap.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const anchorX = e ? e.clientX - sr.left : (stage.clientWidth || 0) / 2;
  const anchorY = e ? e.clientY - sr.top : (stage.clientHeight || 0) / 2;
  const viewX = e ? e.clientX - wr.left : wrap.clientWidth / 2;
  const viewY = e ? e.clientY - wr.top : wrap.clientHeight / 2;
  applyZoom();
  const ratio = (ed.cssScale || 1) / prev;
  wrap.scrollLeft = Math.max(0, stage.offsetLeft + anchorX * ratio - viewX);
  wrap.scrollTop = Math.max(0, stage.offsetTop + anchorY * ratio - viewY);
}

/** 把鼠标位置换算成原图像素坐标 */
function toImagePoint(e) {
  const canvas = $('#edCanvas');
  const r = canvas.getBoundingClientRect();
  const s = ed.cssScale || 1;
  const x = (e.clientX - r.left) / s;
  const y = (e.clientY - r.top) / s;
  return {
    x: Math.max(0, Math.min(ed.current.width, x)),
    y: Math.max(0, Math.min(ed.current.height, y)),
  };
}

/** 按原图坐标把选区框画到屏幕上 */
function drawCropBox() {
  const box = $('#edCropBox');
  if (!box) return;
  if (!ed.crop || ed.crop.w < 0.5 || ed.crop.h < 0.5) { box.hidden = true; return; }
  const s = ed.cssScale || 1;
  box.hidden = false;
  box.style.left = Math.round(ed.crop.x * s) + 'px';
  box.style.top = Math.round(ed.crop.y * s) + 'px';
  box.style.width = Math.round(ed.crop.w * s) + 'px';
  box.style.height = Math.round(ed.crop.h * s) + 'px';
}

function snapshot() {
  ed.history.push(ed.current.toDataURL('image/png'));
  if (ed.history.length > 20) ed.history.shift();
  $('#edUndo').disabled = false;
}

function undo() {
  const last = ed.history.pop();
  if (!last) return;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    cv.getContext('2d').drawImage(img, 0, 0);
    ed.current = cv;
    ed.ratio = cv.width / cv.height;
    render();
    $('#edUndo').disabled = !ed.history.length;
    $('#edInfo').textContent = cv.width + ' × ' + cv.height + ' px';
  };
  img.src = last;
}

function reset() {
  if (!ed.name) return;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    cv.getContext('2d').drawImage(img, 0, 0);
    ed.current = cv;
    ed.history = [];
    ed.ratio = cv.width / cv.height;
    render();
    $('#edUndo').disabled = true;
    $('#edInfo').textContent = cv.width + ' × ' + cv.height + ' px';
  };
  img.src = ed.history[0] || ed.current.toDataURL('image/png');
}

function transform(kind) {
  if (!ed.current) return;
  snapshot();
  const src = ed.current;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  if (kind === 'rotate-left' || kind === 'rotate-right') {
    cv.width = src.height;
    cv.height = src.width;
    if (kind === 'rotate-right') {
      ctx.translate(cv.width, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, cv.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(src, 0, 0);
  } else {
    cv.width = src.width;
    cv.height = src.height;
    if (kind === 'flip-h') { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
    else { ctx.translate(0, cv.height); ctx.scale(1, -1); }
    ctx.drawImage(src, 0, 0);
  }
  ed.current = cv;
  ed.ratio = cv.width / cv.height;
  ed.crop = null;
  $('#edCropBox').hidden = true;
  $('#edWidth').value = cv.width;
  $('#edHeight').value = cv.height;
  render();
  $('#edInfo').textContent = cv.width + ' × ' + cv.height + ' px';
}

function syncLock() {
  if (!$('#edLock').checked) return;
  const w = Number($('#edWidth').value);
  if (w > 0 && ed.ratio > 0) $('#edHeight').value = Math.round(w / ed.ratio);
}

function resizeImage() {
  if (!ed.current) return;
  const w = Math.max(1, Math.round(Number($('#edWidth').value) || 0));
  const h = Math.max(1, Math.round(Number($('#edHeight').value) || 0));
  if (!w || !h) { toast('请填写有效尺寸', 'error'); return; }
  snapshot();
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').drawImage(ed.current, 0, 0, w, h);
  ed.current = cv;
  ed.ratio = w / h;
  render();
  $('#edInfo').textContent = w + ' × ' + h + ' px';
}

function applyAdjust() {
  if (!ed.current) return;
  snapshot();
  const brightness = Number($('#edBrightness').value);
  const contrast = Number($('#edContrast').value);
  const saturation = Number($('#edSaturation').value);
  const cv = document.createElement('canvas');
  cv.width = ed.current.width;
  cv.height = ed.current.height;
  const ctx = cv.getContext('2d');
  ctx.filter = 'brightness(' + brightness + '%) contrast(' + contrast + '%) saturate(' + saturation + '%)';
  ctx.drawImage(ed.current, 0, 0);
  ed.current = cv;
  render();
  $('#edBrightness').value = 100;
  $('#edContrast').value = 100;
  $('#edSaturation').value = 100;
  $('#edBrightnessV').textContent = '100%';
  $('#edContrastV').textContent = '100%';
  $('#edSaturationV').textContent = '100%';
}

function addText() {
  if (!ed.current) return;
  const text = $('#edText').value.trim();
  if (!text) { toast('请填写文字内容', 'error'); return; }
  snapshot();
  const size = Math.max(8, Number($('#edTextSize').value) || 48);
  const color = $('#edTextColor').value;
  const opacity = Number($('#edTextOpacity').value) / 100;
  const pos = $('#edTextPos').value;
  const cv = document.createElement('canvas');
  cv.width = ed.current.width;
  cv.height = ed.current.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(ed.current, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.font = '600 ' + size + 'px "Microsoft YaHei", sans-serif';
  const metrics = ctx.measureText(text);
  const pad = Math.round(size * 0.6);
  const positions = {
    nw: [pad, pad + size], n: [(cv.width - metrics.width) / 2, pad + size], ne: [cv.width - metrics.width - pad, pad + size],
    w: [pad, cv.height / 2], c: [(cv.width - metrics.width) / 2, cv.height / 2], e: [cv.width - metrics.width - pad, cv.height / 2],
    sw: [pad, cv.height - pad], s: [(cv.width - metrics.width) / 2, cv.height - pad], se: [cv.width - metrics.width - pad, cv.height - pad],
  };
  const [x, y] = positions[pos] || positions.c;
  ctx.fillText(text, x, y);
  ed.current = cv;
  render();
}

function bindCropDrag() {
  const box = $('#edCropBox');
  const canvas = $('#edCanvas');
  const wrap = $('#edWrap');
  let mode = null;
  let start = null;
  let startScroll = null;

  // 右键选区，所以屏蔽画布右键菜单
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (!ed.current) return;
    const isMiddle = e.button === 1;
    const isRight = e.button === 2;
    const isTouchSelect = e.button === 0 && e.pointerType !== 'mouse';

    if (isMiddle) {
      // 中键（滚轮键）按住拖动 = 平移
      e.preventDefault();
      mode = 'pan';
      start = { x: e.clientX, y: e.clientY };
      startScroll = { left: wrap.scrollLeft, top: wrap.scrollTop };
      wrap.classList.add('panning');
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (!isRight && !isTouchSelect) return;   // 左键不画选区，避免误操作

    e.preventDefault();
    mode = 'select';
    const p = toImagePoint(e);
    start = p;
    ed.crop = { x: p.x, y: p.y, w: 0, h: 0 };
    wrap.classList.add('selecting');
    drawCropBox();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!mode) return;
    if (mode === 'pan') {
      wrap.scrollLeft = startScroll.left - (e.clientX - start.x);
      wrap.scrollTop = startScroll.top - (e.clientY - start.y);
      return;
    }
    const p = toImagePoint(e);
    const x = Math.max(0, Math.min(start.x, p.x));
    const y = Math.max(0, Math.min(start.y, p.y));
    ed.crop = {
      x,
      y,
      w: Math.max(0, Math.min(ed.current.width - x, Math.abs(p.x - start.x))),
      h: Math.max(0, Math.min(ed.current.height - y, Math.abs(p.y - start.y))),
    };
    drawCropBox();
  });

  const end = (e) => {
    if (mode === 'pan') wrap.classList.remove('panning');
    if (mode === 'select') {
      wrap.classList.remove('selecting');
      if (!ed.crop || ed.crop.w < 2 || ed.crop.h < 2) { ed.crop = null; box.hidden = true; }
      else $('#edInfo').textContent = '选区 ' + Math.round(ed.crop.w) + ' × ' + Math.round(ed.crop.h) + ' px';
    }
    mode = null;
    start = null;
    try { if (e && e.pointerId != null) canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // 滚轮 = 自由缩放（以光标为中心），按住中键拖动 = 平移
  wrap.addEventListener('wheel', (e) => {
    if (!ed.current) return;
    e.preventDefault();
    zoomAt(ed.zoom * Math.exp(-e.deltaY * 0.0016), e);
  }, { passive: false });

  window.addEventListener('resize', () => { if (ed && ed.current) render(); });
}

function applyCrop() {
  if (!ed.current || !ed.crop || ed.crop.w < 4 || ed.crop.h < 4) {
    toast('请先用右键在画布上拖出要保留的区域', 'error');
    return;
  }
  // 选区坐标就是原图坐标（画布 1:1 绘制），放大/缩小都不影响精度
  const x = Math.round(ed.crop.x);
  const y = Math.round(ed.crop.y);
  const w = Math.max(1, Math.round(ed.crop.w));
  const h = Math.max(1, Math.round(ed.crop.h));
  snapshot();
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').drawImage(ed.current, x, y, w, h, 0, 0, w, h);
  ed.current = cv;
  ed.ratio = w / h;
  ed.crop = null;
  ed.zoom = 1;
  $('#edCropBox').hidden = true;
  $('#edWidth').value = w;
  $('#edHeight').value = h;
  render();
  $('#edInfo').textContent = w + ' × ' + h + ' px';
  toast('已裁剪到 ' + w + ' × ' + h);
}

function clearCrop() {
  ed.crop = null;
  $('#edCropBox').hidden = true;
}

function exportImage() {
  if (!ed.current) return;
  const format = $('#edFormat').value;
  const quality = Number($('#edQuality').value) / 100;
  const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
  ed.current.toBlob((blob) => {
    if (!blob) { toast('导出失败', 'error'); return; }
    const url = URL.createObjectURL(blob);
    downloadUrl(url, ed.name + '_edited.' + ext);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('已导出 ' + ext.toUpperCase() + ' · ' + fmtBytes(blob.size));
  }, format, quality);
}
