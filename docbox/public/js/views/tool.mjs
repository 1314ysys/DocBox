import { $, esc, iconSvg } from '../core/dom.mjs';
import { postForm } from '../core/api.mjs';
import { createFileList } from '../core/files.mjs';
import { renderFields, readFields } from '../core/fields.mjs';
import { renderResults, clearResults } from '../core/results.mjs';
import { createFilePreview } from '../core/media.mjs';
import { toast, setBusy } from '../core/ui.mjs';

export function renderTool(app, tool) {
  const view = $('#view-tool');
  const needsFile = Boolean(tool.accept);
  const isData = tool.mode === 'data' || tool.mode === 'upload-data';
  const isMediaTool = tool.cat === 'media' || /video\/|audio\//.test(tool.accept || '');
  const showFile = needsFile || tool.mode === 'upload-data';
  let step = 1;
  const fileStep = showFile ? step++ : null;
  const fieldStep = tool.fields?.length ? step++ : null;
  const fieldGrid = tool.fields?.length
    ? '<div class="panel-title"><h2>' + fieldStep + '. 设置参数</h2></div><div class="field-grid" data-fields></div>'
    : '';
  view.innerHTML = `
    <div class="tool-head">
      <a class="back" href="#/">← 返回全部工具</a>
      <div class="tool-title">
        <span class="tool-ico cat-${tool.cat}">${iconSvg(tool.icon)}</span>
        <div><h1>${esc(tool.name)}</h1><p>${esc(tool.desc || '')}</p></div>
      </div>
    </div>
    <div class="workspace">
      <div class="panel">
        ${showFile ? '<div class="panel-title"><h2>' + fileStep + '. 选择文件</h2><span data-hint>' + esc(tool.filesHint || (tool.multiple ? '可多选，拖动排序' : '一次一个文件')) + '</span></div><div data-files></div><div class="media-preview" data-media hidden></div><div data-extra hidden></div>' : ''}
        ${fieldGrid}
        ${!showFile && !tool.fields?.length ? '<div class="net-note">该工具无需文件与参数，直接点击开始即可。</div>' : ''}
        <div class="run-bar">
          <button class="btn btn-primary" data-run>${isData ? '开始检测' : '开始处理'}</button>
          <span class="run-hint" data-runhint></span>
        </div>
        <div class="results" data-results hidden></div>
        <div class="data-panel" data-data hidden>
          <div class="data-head">
            <b data-data-title>检测结果</b>
            <div class="data-actions">
              <button class="btn btn-ghost btn-sm" data-copy>复制 JSON</button>
              <button class="btn btn-ghost btn-sm" data-save>下载 JSON</button>
            </div>
          </div>
          <pre class="data-json" data-json></pre>
        </div>
      </div>
    </div>
  `;

  const filesBox = $('[data-files]', view);
  const fieldsBox = $('[data-fields]', view);
  const results = $('[data-results]', view);
  const dataPanel = $('[data-data]', view);
  const dataJson = $('[data-json]', view);
  const runBtn = $('[data-run]', view);
  const hint = $('[data-runhint]', view);
  let currentData = null;

  const mediaBox = $('[data-media]', view);
  const preview = isMediaTool && mediaBox ? createFilePreview(mediaBox) : null;
  const list = filesBox
    ? createFileList(filesBox, {
      multiple: Boolean(tool.multiple),
      accept: tool.accept || '*/*',
      onChange: (files) => {
        clearResults(results);
        dataPanel.hidden = true;
        if (preview) preview.show(files);
      },
    })
    : null;
  if (fieldsBox) renderFields(fieldsBox, tool.fields || []);

  $('[data-copy]', view).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(currentData, null, 2)); toast('已复制 JSON'); }
    catch { toast('复制失败，请手动选择文本', 'error'); }
  });
  $('[data-save]', view).addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(currentData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = tool.id + '-' + Date.now() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  runBtn.addEventListener('click', async () => {
    const files = list ? list.files : [];
    if (showFile && !files.length) { toast('请先选择文件', 'error'); return; }
    const min = tool.minFiles || 0;
    if (showFile && files.length < Math.max(1, min)) { toast('请至少选择 ' + Math.max(1, min) + ' 个文件', 'error'); return; }
    const fields = { ...(tool.fixed || {}), ...(fieldsBox ? readFields(fieldsBox, tool.fields) : {}) };
    const payload = files.map((f) => ({ field: tool.field || 'files', file: f, name: f.name }));
    setBusy(runBtn, true);
    hint.textContent = '正在处理…';
    clearResults(results);
    dataPanel.hidden = true;
    try {
      const data = await postForm(tool.endpoint, { files: payload, fields });
      if (data.data) {
        currentData = { tool: tool.name, note: data.note, ...data.data };
        dataJson.textContent = JSON.stringify(currentData, null, 2);
        $('[data-data-title]', view).textContent = (tool.name || '结果') + ' · ' + new Date().toLocaleString();
        dataPanel.hidden = false;
        hint.textContent = data.note || '';
        toast('完成');
      } else {
        renderResults(results, data, tool.name);
        hint.textContent = data.note || '';
        toast('处理完成');
      }
    } catch (err) {
      toast(err.message, 'error', 6000);
      hint.textContent = '';
    } finally {
      setBusy(runBtn, false, isData ? '开始检测' : '开始处理');
    }
  });
}
