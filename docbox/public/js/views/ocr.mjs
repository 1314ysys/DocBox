import { $, esc, fmtBytes } from '../core/dom.mjs';
import { postForm } from '../core/api.mjs';
import { downloadUrl } from '../core/api.mjs';
import { toast } from '../core/ui.mjs';

let st = null;

export function renderOcr() {
  st = { mode: 'image', files: [], pdfjs: null, busy: false };
  const drop = $('#ocrDrop');
  const input = $('#ocrFile');
  const runBtn = $('#ocrRun');

  document.querySelectorAll('[data-ocr-mode]').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('[data-ocr-mode]').forEach((b) => b.classList.toggle('active', b === btn));
      st.mode = btn.dataset.ocrMode;
      st.files = [];
      input.value = '';
      input.accept = st.mode === 'pdf' ? 'application/pdf' : 'image/*';
      input.multiple = st.mode === 'image';
      $('#ocrMeta').textContent = '';
      runBtn.disabled = true;
      $('#ocrText').value = '';
      $('#ocrConf').textContent = '';
      drop.querySelector('b').textContent = st.mode === 'pdf' ? '选择或拖入 PDF 文件' : '选择或拖入图片（可多张）';
    };
  });

  $('#ocrPick').onclick = (e) => { e.stopPropagation(); input.click(); };
  drop.onclick = () => input.click();
  input.onchange = () => { setFiles([...input.files]); input.value = ''; };
  ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { setFiles([...e.dataTransfer.files]); });

  $('#ocrRun').onclick = run;
  $('#ocrCopy').onclick = async () => {
    const text = $('#ocrText').value;
    if (!text) return;
    await navigator.clipboard.writeText(text).then(
      () => toast('已复制到剪贴板'),
      () => toast('复制失败，请手动选择文本', 'error'),
    );
  };
  $('#ocrSave').onclick = () => {
    const text = $('#ocrText').value;
    if (!text) return;
    const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, 'OCR_' + Date.now() + '.txt');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
}

function setFiles(files) {
  const valid = files.filter((f) => (st.mode === 'pdf' ? f.type === 'application/pdf' || f.name.endsWith('.pdf') : f.type.startsWith('image/')));
  if (!valid.length) { toast('请选择有效文件', 'error'); return; }
  st.files = st.mode === 'pdf' ? valid.slice(0, 1) : valid.slice(0, 40);
  $('#ocrMeta').textContent = st.files.map((f) => f.name + '（' + fmtBytes(f.size) + '）').join('、');
  $('#ocrRun').disabled = false;
  $('#ocrText').value = '';
  $('#ocrConf').textContent = '';
}

async function run() {
  if (!st.files.length || st.busy) return;
  st.busy = true;
  const btn = $('#ocrRun');
  btn.disabled = true;
  const hint = $('#ocrHint');
  const progress = $('#ocrProgress');
  const bar = progress.querySelector('div');
  progress.hidden = false;
  bar.style.width = '8%';
  try {
    let text = '';
    let conf = 0;
    if (st.mode === 'image') {
      hint.textContent = '正在识别 ' + st.files.length + ' 张图片…';
      bar.style.width = '40%';
      const data = await postForm('/api/ocr/batch', { files: st.files.map((f) => ({ field: 'files', file: f, name: f.name })) });
      text = data.pages.map((p, i) => (data.pages.length > 1 ? '===== ' + (i + 1) + '. ' + p.name + ' =====\n' : '') + p.text).join('\n\n');
      conf = Math.round(data.pages.reduce((s, p) => s + p.confidence, 0) / Math.max(1, data.pages.length));
      bar.style.width = '100%';
    } else {
      const pdfjs = await loadPdfjs();
      const file = st.files[0];
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        hint.textContent = '正在渲染第 ' + i + ' / ' + doc.numPages + ' 页…';
        const page = await doc.getPage(i);
        const view = page.getViewport({ scale: 2 });
        const cv = document.createElement('canvas');
        cv.width = view.width;
        cv.height = view.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: view }).promise;
        const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
        pages.push({ blob, name: 'page-' + i + '.jpg' });
        bar.style.width = (10 + (i / doc.numPages) * 60).toFixed(0) + '%';
      }
      const chunks = [];
      for (let i = 0; i < pages.length; i += 8) chunks.push(pages.slice(i, i + 8));
      const parts = [];
      let confSum = 0;
      let confCount = 0;
      for (let c = 0; c < chunks.length; c++) {
        hint.textContent = '正在识别第 ' + (c + 1) + ' / ' + chunks.length + ' 批…';
        const data = await postForm('/api/ocr/batch', {
          files: chunks[c].map((p) => ({ field: 'files', file: p.blob, name: p.name })),
        });
        for (const p of data.pages) parts.push(p.text);
        confSum += data.pages.reduce((s, p) => s + p.confidence, 0);
        confCount += data.pages.length;
        bar.style.width = (70 + ((c + 1) / chunks.length) * 25).toFixed(0) + '%';
      }
      text = parts.map((t, i) => '===== 第 ' + (i + 1) + ' 页 =====\n' + t).join('\n\n');
      conf = Math.round(confSum / Math.max(1, confCount));
      bar.style.width = '100%';
    }
    $('#ocrText').value = text;
    $('#ocrConf').textContent = '置信度 ' + conf + '% · ' + text.length + ' 字';
    $('#ocrCopy').disabled = !text;
    $('#ocrSave').disabled = !text;
    hint.textContent = '识别完成';
    toast('OCR 完成');
  } catch (err) {
    hint.textContent = '';
    toast(err.message, 'error', 6000);
  } finally {
    st.busy = false;
    btn.disabled = false;
    setTimeout(() => { progress.hidden = true; bar.style.width = '0'; }, 900);
  }
}

async function loadPdfjs() {
  if (!st.pdfjs) {
    st.pdfjs = await import('/vendor/pdfjs/pdf.mjs');
    st.pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return st.pdfjs;
}
