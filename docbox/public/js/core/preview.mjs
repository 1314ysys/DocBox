import { esc, fmtBytes, extOf } from './dom.mjs';
import { mountPlayer, mediaKind } from './media.mjs';

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.svg', '.ico']);
const TEXT = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.ini', '.js', '.ts', '.css', '.html', '.htm', '.srt', '.vtt']);
const OFFICE = new Set(['.docx', '.xlsx', '.xls', '.pptx']);
const PDF_LIMIT = 80 * 1024 * 1024;

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('/vendor/pdfjs/pdf.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      return m;
    });
  }
  return pdfjsPromise;
}

function escText(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function head(tag, name, meta) {
  return '<div class="pv-head"><span class="pv-tag">' + esc(tag) + '</span>' +
    '<b title="' + esc(name) + '">' + esc(name) + '</b>' +
    '<span class="pv-meta">' + esc(meta || '') + '</span></div>';
}

export function previewKind(name) {
  const ext = extOf(name);
  if (IMAGE.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (mediaKind(name)) return 'media';
  if (OFFICE.has(ext)) return 'office';
  if (TEXT.has(ext)) return 'text';
  return 'none';
}

/* ---------------- PDF 首页缩略图 ---------------- */
async function pdfThumb(data, host, { maxPages = 1, width = 420 } = {}) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data) }).promise;
  const wrap = document.createElement('div');
  wrap.className = 'pv-pdf';
  const pages = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(width / base.width, 1.6);
    const view = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.round(view.width);
    cv.height = Math.round(view.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: view }).promise;
    const box = document.createElement('div');
    box.className = 'pv-page';
    box.appendChild(cv);
    box.insertAdjacentHTML('beforeend', '<span>第 ' + i + ' 页</span>');
    wrap.appendChild(box);
  }
  host.appendChild(wrap);
  return doc.numPages;
}

/* ---------------- 三种结构预览 ---------------- */
function textPreview(host, data) {
  const body = '<pre class="pv-text">' + escText(data.text) + '</pre>' +
    (data.truncated ? '<div class="pv-more">仅预览前 ' + data.text.length + ' 字，共 ' + data.chars + ' 字 · 下载后可查看全文</div>' : '<div class="pv-more">' + data.chars + ' 字 · ' + data.lines + ' 行</div>');
  host.insertAdjacentHTML('beforeend', body);
}

function tablePreview(host, data) {
  (data.sheets || []).forEach((sheet) => {
    const rows = sheet.rows || [];
    const html = '<div class="pv-sheet"><div class="pv-sheet-name">' + esc(sheet.name) + ' · ' + sheet.totalRows + ' 行</div>' +
      '<table class="pv-table">' + rows.map((r, ri) => '<tr>' + r.map((c) => (ri === 0 ? '<th>' + esc(c) + '</th>' : '<td>' + esc(c) + '</td>')).join('') + '</tr>').join('') + '</table>' +
      (sheet.totalRows > rows.length ? '<div class="pv-more">仅显示前 ' + rows.length + ' 行</div>' : '') + '</div>';
    host.insertAdjacentHTML('beforeend', html);
  });
}

function slidesPreview(host, data) {
  const html = (data.slides || []).map((s) => '<div class="pv-slide"><b>' + esc(s.title) + '</b>' +
    (s.lines.length ? '<ul>' + s.lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '') + '</div>').join('');
  host.insertAdjacentHTML('beforeend', '<div class="pv-slides">' + html + '</div>' +
    '<div class="pv-more">共 ' + data.count + ' 页幻灯片' + (data.count > (data.slides || []).length ? '，仅显示前 ' + (data.slides || []).length + ' 页' : '') + '</div>');
}

function renderOffice(host, data) {
  if (data.kind === 'table') tablePreview(host, data);
  else if (data.kind === 'slides') slidesPreview(host, data);
  else if (data.kind === 'text') textPreview(host, data);
  else host.insertAdjacentHTML('beforeend', '<div class="pv-none">该类型暂无可视化预览，可下载后查看</div>');
}

async function officePreview(container, file, token) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const res = await fetch('/api/preview/document', { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  if (token !== currentToken) return;
  if (!res.ok || !json.ok) throw new Error(json.error || '预览失败');
  renderOffice(container, json.data);
}

/* ---------------- 输入文件预览 ---------------- */
let currentToken = 0;
const revokes = new Set();

export function releaseAll() {
  revokes.forEach((u) => URL.revokeObjectURL(u));
  revokes.clear();
}

function track(url) {
  revokes.add(url);
  return url;
}

export function createPreview(container) {
  let disposePlayer = null;

  function reset() {
    if (disposePlayer) { disposePlayer(); disposePlayer = null; }
    releaseAll();
    container.innerHTML = '';
    container.hidden = true;
  }

  return {
    clear: reset,
    async show(files) {
      const token = ++currentToken;
      reset();
      const list = (files || []).filter(Boolean);
      if (!list.length) return;
      const file = list[0];
      const kind = previewKind(file.name);
      container.hidden = false;
      container.innerHTML = '<div class="pv">' + head(kind === 'media' ? '媒体' : kind === 'image' ? '图片' : kind === 'pdf' ? 'PDF' : kind === 'office' ? '文档' : '文本', file.name, fmtBytes(file.size)) + '<div class="pv-body"></div></div>';
      const body = container.querySelector('.pv-body');

      try {
        if (kind === 'image') {
          const imgs = list.filter((f) => previewKind(f.name) === 'image').slice(0, 8);
          const grid = document.createElement('div');
          grid.className = 'pv-thumbs';
          for (const f of imgs) {
            const url = track(URL.createObjectURL(f));
            const cell = document.createElement('a');
            cell.className = 'pv-thumb';
            cell.href = url;
            cell.target = '_blank';
            cell.rel = 'noopener';
            cell.innerHTML = '<img src="' + url + '" alt=""><span>' + esc(f.name) + '</span>';
            grid.appendChild(cell);
          }
          body.appendChild(grid);
          if (list.length > imgs.length) body.insertAdjacentHTML('beforeend', '<div class="pv-more">另有 ' + (list.length - imgs.length) + ' 个图片未预览</div>');
          return;
        }
        if (kind === 'media') {
          const url = track(URL.createObjectURL(file));
          const holder = document.createElement('div');
          body.appendChild(holder);
          disposePlayer = mountPlayer(holder, url, file.name, { size: file.size, kind: mediaKind(file.name) });
          return;
        }
        if (kind === 'pdf') {
          if (file.size > PDF_LIMIT) {
            body.insertAdjacentHTML('beforeend', '<div class="pv-none">PDF 文件较大（' + fmtBytes(file.size) + '），已跳过缩略图预览</div>');
            return;
          }
          body.insertAdjacentHTML('beforeend', '<div class="pv-loading">正在渲染首页…</div>');
          const buf = await file.arrayBuffer();
          if (token !== currentToken) return;
          body.innerHTML = '';
          const pages = await pdfThumb(buf, body, { maxPages: list.length > 1 ? 2 : 1 });
          const meta = container.querySelector('.pv-meta');
          if (meta) meta.textContent = fmtBytes(file.size) + ' · ' + pages + ' 页';
          return;
        }
        if (kind === 'office') {
          body.insertAdjacentHTML('beforeend', '<div class="pv-loading">正在解析文档…</div>');
          await officePreview(body, file, token);
          if (token === currentToken) body.querySelector('.pv-loading')?.remove();
          return;
        }
        if (kind === 'text') {
          const slice = file.slice(0, 120 * 1024);
          const text = await slice.text();
          if (token !== currentToken) return;
          const clean = text.replace(/\r\n/g, '\n');
          body.insertAdjacentHTML('beforeend', '<pre class="pv-text">' + escText(clean.slice(0, 2400)) + '</pre>' +
            (clean.length > 2400 ? '<div class="pv-more">仅预览前 2400 字，共 ' + clean.length + ' 字</div>' : ''));
          return;
        }
        body.insertAdjacentHTML('beforeend', '<div class="pv-none">该文件类型暂无预览，可直接运行工具查看结果</div>');
      } catch (err) {
        if (token === currentToken) body.insertAdjacentHTML('beforeend', '<div class="pv-none">预览失败：' + esc(err.message) + '</div>');
      }
    },
  };
}

/* ---------------- 结果文件预览（按需展开） ---------------- */
export function resultPreviewKind(name) {
  const ext = extOf(name);
  if (ext === '.pdf') return 'pdf';
  if (OFFICE.has(ext)) return 'office';
  if (TEXT.has(ext)) return 'text';
  return null;
}

export async function fillResultPreviews(root) {
  const slots = [...root.querySelectorAll('[data-pv-url]')];
  for (const slot of slots) {
    const url = slot.dataset.pvUrl;
    const name = slot.dataset.pvName || '';
    const kind = resultPreviewKind(name);
    if (!kind) continue;
    try {
      if (kind === 'pdf') {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        if (buf.byteLength > PDF_LIMIT) { slot.innerHTML = '<div class="pv-none">文件较大，已跳过预览</div>'; continue; }
        slot.innerHTML = '';
        await pdfThumb(buf, slot, { maxPages: 1, width: 300 });
      } else if (kind === 'office') {
        slot.innerHTML = '<div class="pv-loading">解析中…</div>';
        const res = await fetch('/api/preview/output', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, name }) });
        const json = await res.json().catch(() => ({}));
        slot.innerHTML = '';
        if (res.ok && json.ok) renderOffice(slot, json.data);
        else slot.innerHTML = '<div class="pv-none">' + esc(json.error || '预览失败') + '</div>';
      } else {
        const res = await fetch(url);
        const text = (await res.text()).slice(0, 800);
        slot.innerHTML = '<pre class="pv-text small">' + escText(text) + '</pre>';
      }
    } catch (err) {
      slot.innerHTML = '<div class="pv-none">预览失败：' + esc(err.message) + '</div>';
    }
  }
}
