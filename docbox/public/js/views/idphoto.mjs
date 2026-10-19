import { $, esc } from '../core/dom.mjs';
import { postForm } from '../core/api.mjs';
import { renderResults } from '../core/results.mjs';
import { toast } from '../core/ui.mjs';
import { downloadUrl } from '../core/api.mjs';

let st = null;

function presetById(id) {
  return st.presets.find((p) => p.id === id) || st.presets[0];
}

export function renderIdPhoto(app) {
  st = {
    presets: (app.idPresets || []).map((p) => ({ id: p.id, label: p.name, w: p.w, h: p.h, px: p.px, ph: p.ph })),
    size: null,
    img: null,
    zoom: 1,
    ox: 0,
    oy: 0,
    dragging: false,
    start: null,
    stream: null,
  };
  const full = st.presets.find((p) => p.id === 'household') || null;
  if (full) st.presets = st.presets.filter((p) => p.id !== 'household');
  st.presets.push({ id: 'household', label: '户口本 A4 整页', w: 210, h: 297, px: 2480, ph: 3508, full: true });
  st.size = st.presets[0];

  const sizesBox = $('#idSizes');
  sizesBox.innerHTML = st.presets.map((p) => `<button type="button" data-size="${p.id}" class="${p.id === st.size.id ? 'active' : ''}"><b>${esc(p.label)}</b><span>${p.w}×${p.h} mm</span></button>`).join('');
  sizesBox.onclick = (e) => {
    const btn = e.target.closest('[data-size]');
    if (btn) setSize(btn.dataset.size);
  };

  setSize(st.size.id);
  bindCanvas();
  bindPicker('#idPick', '#idFile');
  bindPicker('#idPick2', '#idFile');
  bindPicker('#idEmpty', '#idFile');
  $('#idCamera').onclick = openCamera;
  $('#idCamera2').onclick = openCamera;
  $('#idCameraClose').onclick = closeCamera;
  $('#idCapture').onclick = capture;
  $('#idZoom').oninput = (e) => { st.zoom = Number(e.target.value) / 100; draw(); };
  $('#idReset').onclick = () => { st.zoom = 1; st.ox = 0; st.oy = 0; $('#idZoom').value = 100; draw(); };
  $('#idBg').oninput = draw;
  $('#idDownload').onclick = () => downloadSingle();
  $('#idPdf').onclick = () => exportSheet('pdf');
  $('#idPng').onclick = () => exportSheet('png');
}

function bindPicker(sel, inputSel) {
  const btn = $(sel);
  const input = $(inputSel);
  if (!btn || !input) return;
  btn.onclick = (e) => { e.stopPropagation(); input.click(); };
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) loadFile(file);
    input.value = '';
  };
}

function setSize(id) {
  st.size = presetById(id);
  st.zoom = 1;
  st.ox = 0;
  st.oy = 0;
  $('#idSizes').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.size === st.size.id));
  resizeCanvas();
  draw();
  $('#idSizeNote').textContent = st.size.label + '：' + st.size.w + ' × ' + st.size.h + ' mm · ' + st.size.px + ' × ' + st.size.ph + ' px';
  $('#idCopies').disabled = Boolean(st.size.full);
  if (st.size.full) $('#idCopies').value = '1';
  $('#idZoom').value = 100;
  $('#idHint').textContent = st.size.full
    ? '户口本按 A4 整页输出：请把页面四边拍全，拖动/缩放让页面铺满画布。'
    : '拖动照片调整取景；画布比例就是最终证件照比例。';
}

function resizeCanvas() {
  const cv = $('#idCanvas');
  const displayW = 420;
  cv.width = displayW;
  cv.height = Math.round((displayW * st.size.ph) / st.size.px);
}

function draw() {
  const cv = $('#idCanvas');
  const ctx = cv.getContext('2d');
  ctx.fillStyle = $('#idBg')?.value || '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!st.img) return;
  const img = st.img;
  const base = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
  const s = base * st.zoom;
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  let x = (cv.width - w) / 2 + st.ox;
  let y = (cv.height - h) / 2 + st.oy;
  x = Math.min(0, Math.max(cv.width - w, x));
  y = Math.min(0, Math.max(cv.height - h, y));
  st.ox = x - (cv.width - w) / 2;
  st.oy = y - (cv.height - h) / 2;
  ctx.drawImage(img, x, y, w, h);
}

function loadFile(file) {
  if (!file.type.startsWith('image/')) { toast('请选择图片文件', 'error'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    st.img = img;
    st.zoom = 1;
    st.ox = 0;
    st.oy = 0;
    $('#idEmpty').hidden = true;
    $('#idZoom').value = 100;
    resizeCanvas();
    draw();
    toast('照片已载入，拖动 / 缩放调整取景');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('图片读取失败', 'error'); };
  img.src = url;
}

function bindCanvas() {
  const cv = $('#idCanvas');
  cv.addEventListener('pointerdown', (e) => {
    if (!st.img) return;
    st.dragging = true;
    st.start = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!st.dragging || !st.start) return;
    st.ox = st.start.ox + (e.clientX - st.start.x);
    st.oy = st.start.oy + (e.clientY - st.start.y);
    draw();
  });
  const stop = () => { st.dragging = false; st.start = null; };
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);
}

function exportCanvas() {
  const src = $('#idCanvas');
  const out = document.createElement('canvas');
  out.width = st.size.px;
  out.height = st.size.ph;
  const ctx = out.getContext('2d');
  ctx.fillStyle = $('#idBg')?.value || '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, out.width, out.height);
  return out;
}

function canvasBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function downloadSingle() {
  if (!st.img) { toast('请先载入照片', 'error'); return; }
  const blob = await canvasBlob(exportCanvas(), 'image/png');
  const url = URL.createObjectURL(blob);
  downloadUrl(url, '证件照_' + st.size.label + '.png');
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('已下载单张证件照');
}

async function exportSheet(format) {
  if (!st.img) { toast('请先载入照片', 'error'); return; }
  const blob = await canvasBlob(exportCanvas(), 'image/jpeg', 0.95);
  const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  try {
    const data = await postForm('/api/idphoto/sheet', {
      files: [{ field: 'photo', file }],
      fields: {
        size: st.size.id,
        mode: st.size.full ? 'fullpage' : 'grid',
        copies: $('#idCopies').value || 8,
        bg: $('#idBg').value || '#ffffff',
        cut: $('#idCut').checked ? '1' : '0',
        format,
      },
    });
    const box = $('#idResult');
    box.hidden = false;
    renderResults(box, data, '证件照');
    const item = data.files?.[0];
    if (item) downloadUrl(item.url, item.name);
    toast('已生成 A4 排版');
  } catch (err) {
    toast(err.message, 'error', 5000);
  }
}

async function openCamera() {
  const modal = $('#idCameraModal');
  const video = $('#idVideo');
  const msg = $('#idCameraMsg');
  modal.hidden = false;
  try {
    st.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1600 }, height: { ideal: 1200 }, facingMode: 'user' }, audio: false });
    video.srcObject = st.stream;
    await video.play();
    msg.textContent = '';
  } catch (err) {
    msg.textContent = '无法打开相机：' + err.message;
  }
}

function closeCamera() {
  if (st.stream) {
    st.stream.getTracks().forEach((t) => t.stop());
    st.stream = null;
  }
  $('#idVideo').srcObject = null;
  $('#idCameraModal').hidden = true;
}

async function capture() {
  const video = $('#idVideo');
  if (!video.videoWidth) { toast('相机还未就绪', 'error'); return; }
  const cv = document.createElement('canvas');
  const ratio = st.size.w / st.size.h;
  let sw = video.videoWidth;
  let sh = Math.round(sw / ratio);
  if (sh > video.videoHeight) { sh = video.videoHeight; sw = Math.round(sh * ratio); }
  cv.width = sw;
  cv.height = sh;
  const sx = (video.videoWidth - sw) / 2;
  const sy = (video.videoHeight - sh) / 2;
  cv.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvasBlob(cv, 'image/jpeg', 0.95);
  closeCamera();
  loadFile(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
}

export function cleanupIdPhoto() {
  if (st?.stream) {
    st.stream.getTracks().forEach((t) => t.stop());
    st.stream = null;
  }
}