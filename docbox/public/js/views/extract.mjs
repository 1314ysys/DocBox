import { $, esc } from '../core/dom.mjs';
import { downloadUrl } from '../core/api.mjs';
import { toast } from '../core/ui.mjs';

let st = null;

async function loadPdfjs() {
  if (!st.pdfjs) {
    st.pdfjs = await import('/vendor/pdfjs/pdf.mjs');
    st.pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return st.pdfjs;
}

export function renderExtract() {
  st = { pdfjs: null, doc: null, name: '', pages: 0, busy: false };
  const drop = $('#exDrop');
  const input = $('#exFile');
  $('#exPick').onclick = (e) => { e.stopPropagation(); input.click(); };
  drop.onclick = () => input.click();
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) openFile(file);
    input.value = '';
  };
  ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) openFile(file);
  });

  $('#exImages').onclick = exportImages;
  $('#exText').onclick = exportText;
}

async function openFile(file) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    toast('请选择 PDF 文件', 'error');
    return;
  }
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    st.doc = doc;
    st.name = file.name.replace(/\.pdf$/i, '');
    st.pages = doc.numPages;
    $('#exMeta').innerHTML = '<b>' + esc(file.name) + '</b> · ' + doc.numPages + ' 页 · ' + (file.size / 1024).toFixed(0) + ' KB';
    $('#exImages').disabled = false;
    $('#exText').disabled = false;
    $('#exHint').textContent = '正在生成页面预览…';
    await renderThumbs();
  } catch (err) {
    toast('PDF 读取失败：' + err.message, 'error', 5000);
  }
}

async function renderThumbs() {
  const host = $('#exPages');
  host.innerHTML = '';
  const total = Math.min(st.pages, 60);
  $('#exCount').textContent = st.pages + ' 页' + (st.pages > total ? '（预览前 ' + total + ' 页）' : '');
  for (let i = 1; i <= total; i++) {
    const page = await st.doc.getPage(i);
    const view = page.getViewport({ scale: 0.5 });
    const cv = document.createElement('canvas');
    cv.width = view.width;
    cv.height = view.height;
    cv.className = 'pdf-thumb';
    await page.render({ canvasContext: cv.getContext('2d'), viewport: view }).promise;
    const cell = document.createElement('div');
    cell.className = 'pdf-page-cell';
    cell.append(cv);
    const label = document.createElement('span');
    label.textContent = '第 ' + i + ' 页';
    cell.append(label);
    host.append(cell);
  }
  $('#exHint').textContent = '预览完成';
}

async function exportImages() {
  if (!st.doc || st.busy) return;
  st.busy = true;
  const scale = Number($('#exScale').value) || 2;
  const format = $('#exFormat').value || 'image/png';
  const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
  const progress = $('#exProgress');
  progress.hidden = false;
  const bar = progress.querySelector('div');
  const zip = new window.JSZip();
  const folder = zip.folder(st.name);
  try {
    for (let i = 1; i <= st.pages; i++) {
      const page = await st.doc.getPage(i);
      const view = page.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = view.width;
      cv.height = view.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: view }).promise;
      const blob = await new Promise((r) => cv.toBlob(r, format, 0.92));
      folder.file(st.name + '_' + String(i).padStart(3, '0') + '.' + ext, blob);
      bar.style.width = Math.round((i / st.pages) * 100) + '%';
    }
    const out = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(out);
    downloadUrl(url, st.name + '_' + st.pages + '页图片.zip');
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    toast('已导出 ' + st.pages + ' 页图片（ZIP）');
  } catch (err) {
    toast('导出失败：' + err.message, 'error', 5000);
  } finally {
    st.busy = false;
    setTimeout(() => { progress.hidden = true; bar.style.width = '0'; }, 800);
  }
}

async function exportText() {
  if (!st.doc || st.busy) return;
  st.busy = true;
  const progress = $('#exProgress');
  progress.hidden = false;
  const bar = progress.querySelector('div');
  try {
    const parts = [];
    for (let i = 1; i <= st.pages; i++) {
      const page = await st.doc.getPage(i);
      const content = await page.getTextContent();
      const lines = [];
      let lastY = null;
      let buffer = [];
      for (const item of content.items) {
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 4) {
          if (buffer.length) lines.push(buffer.join(''));
          buffer = [];
        }
        buffer.push(item.str);
        lastY = y;
      }
      if (buffer.length) lines.push(buffer.join(''));
      parts.push('===== 第 ' + i + ' 页 =====\n' + lines.join('\n'));
      bar.style.width = Math.round((i / st.pages) * 100) + '%';
    }
    const text = parts.join('\n\n');
    const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, st.name + '_文字.txt');
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    toast('已提取约 ' + text.length + ' 字');
  } catch (err) {
    toast('提取失败：' + err.message, 'error', 5000);
  } finally {
    st.busy = false;
    setTimeout(() => { progress.hidden = true; bar.style.width = '0'; }, 800);
  }
}
