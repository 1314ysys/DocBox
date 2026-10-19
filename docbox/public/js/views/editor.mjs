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
  const maxW = Math.min(wrap.clientWidth || 900, 1000);
  const maxH = Math.max(320, window.innerHeight * 0.62);
  const scale = Math.min(maxW / ed.current.width, maxH / ed.current.height, 1);
  canvas.width = Math.round(ed.current.width * scale);
  canvas.height = Math.round(ed.current.height * scale);
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';
  canvas.getContext('2d').drawImage(ed.current, 0, 0, canvas.width, canvas.height);
  ed.scale = scale;
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
  let start = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!ed.current) return;
    start = { x: e.offsetX, y: e.offsetY };
    box.hidden = false;
    box.style.left = start.x + 'px';
    box.style.top = start.y + 'px';
    box.style.width = '0px';
    box.style.height = '0px';
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!start) return;
    const x = Math.min(start.x, e.offsetX);
    const y = Math.min(start.y, e.offsetY);
    const w = Math.abs(e.offsetX - start.x);
    const h = Math.abs(e.offsetY - start.y);
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    ed.crop = { x, y, w, h };
  });
  const end = () => { start = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (ed?.current) render(); });
}

function applyCrop() {
  if (!ed.current || !ed.crop || ed.crop.w < 4 || ed.crop.h < 4) {
    toast('请先在画布上拖出选区', 'error');
    return;
  }
  const s = ed.scale || 1;
  const x = Math.round(ed.crop.x / s);
  const y = Math.round(ed.crop.y / s);
  const w = Math.round(ed.crop.w / s);
  const h = Math.round(ed.crop.h / s);
  snapshot();
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').drawImage(ed.current, x, y, w, h, 0, 0, w, h);
  ed.current = cv;
  ed.ratio = w / h;
  ed.crop = null;
  $('#edCropBox').hidden = true;
  $('#edWidth').value = w;
  $('#edHeight').value = h;
  render();
  $('#edInfo').textContent = w + ' × ' + h + ' px';
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
