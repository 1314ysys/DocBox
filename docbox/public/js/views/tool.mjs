import { $, esc, iconSvg } from '../core/dom.mjs';
import { postForm } from '../core/api.mjs';
import { createFileList } from '../core/files.mjs';
import { renderFields, readFields } from '../core/fields.mjs';
import { renderResults, clearResults } from '../core/results.mjs';
import { toast, setBusy } from '../core/ui.mjs';

export function renderTool(app, tool) {
  const view = $('#view-tool');
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
        <div class="panel-title"><h2>1. 选择文件</h2><span data-hint>${tool.multiple ? '可多选，拖动排序' : '一次一个文件'}</span></div>
        <div data-files></div>
        <div data-extra hidden></div>
        ${tool.fields?.length ? '<div class="panel-title"><h2>2. 设置参数</h2></div><div class="field-grid" data-fields></div>' : ''}
        <div class="run-bar">
          <button class="btn btn-primary" data-run>开始处理</button>
          <span class="run-hint" data-runhint></span>
        </div>
        <div class="results" data-results hidden></div>
      </div>
    </div>
  `;

  const filesBox = $('[data-files]', view);
  const extraBox = $('[data-extra]', view);
  const fieldsBox = $('[data-fields]', view);
  const results = $('[data-results]', view);
  const runBtn = $('[data-run]', view);
  const hint = $('[data-runhint]', view);

  const list = createFileList(filesBox, {
    multiple: Boolean(tool.multiple),
    accept: tool.accept || '*/*',
    onChange: () => { clearResults(results); },
  });
  if (fieldsBox) renderFields(fieldsBox, tool.fields || []);

  let extra = null;
  if (tool.extraFiles?.length) {
    const spec = tool.extraFiles[0];
    extraBox.hidden = false;
    extraBox.innerHTML = '<div class="panel-title"><h2>' + esc(spec.label || '附加文件') + '</h2><span>' + esc(spec.hint || '可选') + '</span></div><div data-extra-files></div>';
    extra = createFileList($('[data-extra-files]', extraBox), { multiple: true, accept: spec.accept || '*/*' });
  }

  runBtn.addEventListener('click', async () => {
    const files = list.files;
    const min = tool.minFiles || 1;
    if (files.length < min) { toast('请至少选择 ' + min + ' 个文件', 'error'); return; }
    const fields = { ...(tool.fixed || {}), ...(fieldsBox ? readFields(fieldsBox, tool.fields) : {}) };
    const payload = files.map((f) => ({ field: tool.field === 'file' ? 'file' : tool.field, file: f, name: f.name }));
    if (extra && extra.files.length) {
      const spec = tool.extraFiles[0];
      payload.push(...extra.files.map((f) => ({ field: spec.field, file: f, name: f.name })));
    }
    setBusy(runBtn, true);
    hint.textContent = tool.stirling ? '正在调用 Stirling-PDF…' : '正在本地处理…';
    try {
      const data = await postForm(tool.endpoint, { files: payload, fields });
      renderResults(results, data, tool.name);
      hint.textContent = data.note || '';
      toast('处理完成');
    } catch (err) {
      toast(err.message, 'error', 5000);
      hint.textContent = '';
    } finally {
      setBusy(runBtn, false, '开始处理');
    }
  });
}
