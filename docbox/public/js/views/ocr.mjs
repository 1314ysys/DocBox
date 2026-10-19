import { $, esc, fmtBytes } from '../core/dom.mjs';
import { postForm, downloadUrl, getJson } from '../core/api.mjs';
import { toast } from '../core/ui.mjs';
import { createPreview } from '../core/preview.mjs';

/**
 * OCR 与转写：图片 OCR / PDF 整本 OCR / 音视频转写（Whisper，离线后台任务或在线同步）/ 实时麦克风转写
 */
let st = null;

const MODE_TEXT = {
  image: { b: '选择或拖入图片（可多张）', s: '识别在本机完成，不联网', run: '开始识别', accept: 'image/*', multiple: true },
  pdf: { b: '选择或拖入 PDF 文件', s: '整本逐页渲染后识别，页数越多越慢', run: '开始识别', accept: 'application/pdf', multiple: false },
  file: { b: '选择或拖入音频 / 视频', s: 'mp3 / wav / m4a / mp4 / mkv… 由 ffmpeg 解码', run: '开始转写', accept: 'audio/*,video/*', multiple: false },
  live: { b: '点击开始后用麦克风实时转写', s: '每 5 秒切片送本机 Whisper，先说一句再等结果', run: '开始录音', accept: 'audio/*', multiple: false },
};

let pv = null;
let pollTimer = null;
let lastSegments = [];

export function renderOcr() {
  st = { mode: 'image', files: [], pdfjs: null, busy: false, jobId: null, segments: [], recorder: null, stream: null, liveQueue: Promise.resolve(), liveBusy: false };
  lastSegments = [];
  const drop = $('#ocrDrop');
  const input = $('#ocrFile');
  pv = $('#ocrPreview') ? createPreview($('#ocrPreview')) : null;

  document.querySelectorAll('[data-ocr-tab]').forEach((btn) => {
    btn.onclick = () => setMode(btn.dataset.ocrTab);
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
    await navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板'), () => toast('复制失败，请手动选择文本', 'error'));
  };
  $('#ocrSave').onclick = () => {
    const text = $('#ocrText').value;
    if (!text) return;
    const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, (st.mode === 'file' || st.mode === 'live' ? '转写_' : 'OCR_') + Date.now() + '.txt');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  $('#ocrSrt').onclick = () => {
    if (!lastSegments.length) return;
    const blob = new Blob([toSrt(lastSegments)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, '字幕_' + Date.now() + '.srt');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/ocr')) stopLive(true); });

  setMode('image');
}

function setMode(mode) {
  if (st.mode === 'live') stopLive(true);
  st.mode = mode;
  st.files = [];
  st.jobId = null;
  st.segments = [];
  lastSegments = [];
  $('#ocrText').value = '';
  $('#ocrConf').textContent = '';
  $('#ocrMeta').textContent = '';
  $('#ocrHint').textContent = '';
  $('#ocrJob').hidden = true;
  $('#ocrSrt').hidden = true;
  $('#ocrSrt').disabled = true;
  $('#ocrCopy').disabled = true;
  $('#ocrSave').disabled = true;
  $('#ocrResultTitle').textContent = mode === 'file' || mode === 'live' ? '转写结果' : '识别结果';
  $('#ocrFile').value = '';
  if (pv) pv.clear();
  document.querySelectorAll('[data-ocr-tab]').forEach((b) => b.classList.toggle('active', b.dataset.ocrTab === mode));
  const cfg = MODE_TEXT[mode];
  $('#ocrDrop').querySelector('b').textContent = cfg.b;
  $('#ocrDrop').querySelector('span').textContent = cfg.s;
  $('#ocrFile').accept = cfg.accept;
  $('#ocrFile').multiple = cfg.multiple;
  $('#ocrRun').textContent = cfg.run;
  $('#ocrOpts').hidden = mode !== 'file' && mode !== 'live';
  $('#ocrModeWrap').hidden = mode === 'live';
  $('#ocrRun').disabled = mode === 'live' ? false : true;
  if (mode === 'live') $('#ocrRun').disabled = false;
}

function setFiles(files) {
  const mode = st.mode;
  const ok = (f) => {
    const n = f.name.toLowerCase();
    if (mode === 'image') return f.type.startsWith('image/');
    if (mode === 'pdf') return f.type === 'application/pdf' || n.endsWith('.pdf');
    return f.type.startsWith('audio/') || f.type.startsWith('video/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|mov|mkv|webm|avi|flv|wmv)$/.test(n);
  };
  const valid = files.filter(ok);
  if (!valid.length) { toast('请选择有效文件', 'error'); return; }
  st.files = mode === 'image' ? valid.slice(0, 40) : valid.slice(0, 1);
  $('#ocrMeta').textContent = st.files.map((f) => f.name + '（' + fmtBytes(f.size) + '）').join('、');
  $('#ocrRun').disabled = false;
  $('#ocrText').value = '';
  $('#ocrConf').textContent = '';
  if (pv) pv.show(st.files);
}

async function run() {
  if (st.mode === 'live') { await toggleLive(); return; }
  if (!st.files.length || st.busy) return;
  if (st.mode === 'file') return runTranscribe();
  return runOcr();
}

/* ---------------- OCR（图片 / PDF） ---------------- */
async function runOcr() {
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
        const data = await postForm('/api/ocr/batch', { files: chunks[c].map((p) => ({ field: 'files', file: p.blob, name: p.name })) });
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

/* ---------------- 音视频转写 ---------------- */
async function runTranscribe() {
  const language = $('#ocrLang').value;
  const mode = $('#ocrSttMode').value;
  const hint = $('#ocrHint');
  const progress = $('#ocrProgress');
  const bar = progress.querySelector('div');
  const btn = $('#ocrRun');
  const jobBox = $('#ocrJob');
  st.busy = true;
  btn.disabled = true;
  progress.hidden = false;
  bar.style.width = '5%';

  try {
    if (mode === 'online') {
      hint.textContent = '正在在线转写（同步），请稍候…';
      bar.style.width = '45%';
      const data = await postForm('/api/stt/quick', { files: [{ field: 'file', file: st.files[0], name: st.files[0].name }], fields: { language } });
      bar.style.width = '100%';
      applyResult(data.text, data.segments || [], data.note || '在线转写完成');
      return;
    }

    hint.textContent = '正在上传并加入后台队列…';
    const created = await postForm('/api/stt/job', { files: [{ field: 'file', file: st.files[0], name: st.files[0].name }], fields: { language } });
    st.jobId = created.id;
    jobBox.hidden = false;
    jobBox.innerHTML = '任务 <b>' + esc(created.id) + '</b> · 已入队（可离开本页，稍后在「处理历史」或此处查看）';
    hint.textContent = '转写中（后台任务）…';
    bar.style.width = '8%';
    const job = await waitJob(created.id, (j) => {
      bar.style.width = Math.max(8, j.progress || 0) + '%';
      jobBox.innerHTML = '任务 <b>' + esc(j.id) + '</b> · ' + esc(j.status) + ' · ' + (j.progress || 0) + '%' + (j.error ? ' · ' + esc(j.error) : '');
      if (j.status === 'running') hint.textContent = '转写中（后台任务）… ' + (j.progress || 0) + '%';
    });
    bar.style.width = '100%';
    applyResult(job.text, job.segments || [], '离线转写完成（' + (job.durationMs ? (job.durationMs / 1000).toFixed(1) + ' 秒音频' : '') + '）');
    jobBox.innerHTML = '任务 <b>' + esc(job.id) + '</b> · 完成';
  } catch (err) {
    toast(err.message, 'error', 6000);
    hint.textContent = '';
  } finally {
    st.busy = false;
    btn.disabled = false;
    setTimeout(() => { progress.hidden = true; bar.style.width = '0'; }, 900);
  }
}

function waitJob(id, onTick) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const { job } = await getJson('/api/stt/job/' + id);
        onTick(job);
        if (job.status === 'done') return resolve(job);
        if (job.status === 'error') return reject(new Error(job.error || '转写失败'));
        if (Date.now() - started > 30 * 60 * 1000) return reject(new Error('转写超时（超过 30 分钟）'));
        pollTimer = setTimeout(tick, 1500);
      } catch (err) {
        reject(err);
      }
    };
    tick();
  });
}

function applyResult(text, segments, note) {
  $('#ocrText').value = text || '';
  st.segments = segments || [];
  lastSegments = st.segments;
  const chars = (text || '').length;
  $('#ocrConf').textContent = (note ? note + ' · ' : '') + chars + ' 字';
  $('#ocrHint').textContent = note || '完成';
  $('#ocrCopy').disabled = !text;
  $('#ocrSave').disabled = !text;
  $('#ocrSrt').hidden = !st.segments.length;
  $('#ocrSrt').disabled = !st.segments.length;
  toast(note || '转写完成');
}

/* ---------------- 实时转写（麦克风） ---------------- */
async function toggleLive() {
  if (st.recorder && st.recorder.state === 'recording') { stopLive(false); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast('当前浏览器不支持麦克风录音', 'error'); return; }
  const lang = $('#ocrLang').value;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    st.stream = stream;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    st.recorder = recorder;
    st.liveStart = Date.now();
    $('#ocrRun').textContent = '停止录音';
    $('#ocrHint').textContent = '录音中（每 5 秒转写一次）…';
    $('#ocrProgress').hidden = false;
    $('#ocrText').value = '';
    $('#ocrConf').textContent = '';

    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size < 1200) return;
      st.liveQueue = st.liveQueue.then(() => sendChunk(e.data, lang)).catch(() => {});
    };
    recorder.start(5000);
  } catch (err) {
    toast('无法打开麦克风：' + err.message, 'error', 6000);
  }
}

async function sendChunk(blob, lang) {
  if (st.mode !== 'live') return;
  st.liveBusy = true;
  $('#ocrHint').textContent = '识别中…';
  try {
    const fd = new FormData();
    fd.append('file', blob, 'chunk.webm');
    fd.append('language', lang);
    const res = await fetch('/api/stt/chunk', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (data.text) {
      const ta = $('#ocrText');
      ta.value = (ta.value ? ta.value.trim() + ' ' : '') + data.text.trim();
      const secs = Math.round((Date.now() - st.liveStart) / 1000);
      st.segments.push({ start: secs - 5, end: secs, text: data.text.trim() });
      lastSegments = st.segments;
      $('#ocrConf').textContent = '已录 ' + secs + ' 秒 · ' + ta.value.length + ' 字';
      $('#ocrCopy').disabled = false;
      $('#ocrSave').disabled = false;
      $('#ocrSrt').hidden = false;
      $('#ocrSrt').disabled = false;
    } else if (data.error) {
      $('#ocrHint').textContent = '片段识别失败：' + data.error;
    }
  } catch {
    /* 片段失败不打断录音 */
  } finally {
    st.liveBusy = false;
    if (st.recorder && st.recorder.state === 'recording') $('#ocrHint').textContent = '录音中（每 5 秒转写一次）…';
  }
}

function stopLive(silent) {
  if (!st) return;
  try { st.recorder?.state === 'recording' && st.recorder.stop(); } catch { /* 忽略 */ }
  try { st.stream?.getTracks().forEach((t) => t.stop()); } catch { /* 忽略 */ }
  st.recorder = null;
  st.stream = null;
  $('#ocrRun').textContent = MODE_TEXT.live.run;
  $('#ocrProgress').hidden = true;
  if (!silent) {
    $('#ocrHint').textContent = '录音已停止';
    if ($('#ocrText').value.trim()) toast('实时转写已结束，可复制或下载');
  }
}

function toSrt(segments) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmt = (sec) => {
    const s = Math.max(0, Number(sec) || 0);
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(Math.floor(s % 60)) + ',' + pad(Math.round((s % 1) * 1000), 3);
  };
  return segments.map((seg, i) => (i + 1) + '\n' + fmt(seg.start) + ' --> ' + fmt(seg.end) + '\n' + seg.text + '\n').join('\n');
}

async function loadPdfjs() {
  if (!st.pdfjs) {
    st.pdfjs = await import('/vendor/pdfjs/pdf.mjs');
    st.pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return st.pdfjs;
}
