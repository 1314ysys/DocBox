import { $, $$, esc, iconSvg } from '../core/dom.mjs';
import { postForm } from '../core/api.mjs';
import { createFileList } from '../core/files.mjs';
import { renderFields, readFields } from '../core/fields.mjs';
import { renderResults } from '../core/results.mjs';
import { toast, setBusy } from '../core/ui.mjs';
import { saveTemplate, getTemplate, removeTemplate } from '../core/store.mjs';

let state = null;

// 同时写入本地 MySQL（不可用时静默忽略，仅本地 localStorage 生效）
function syncTemplate(id, values) {
  fetch('/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ templateId: id, name: id, spec: values }),
  }).catch(() => {});
}
function syncDelete(id) {
  fetch('/api/templates/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
}
function saveTpl(id, values) { saveTemplate(id, values); syncTemplate(id, values); }
function delTpl(id) { removeTemplate(id); syncDelete(id); }

function defaultsOf(tpl) {
  const values = {};
  for (const f of tpl.fields) values[f.name] = f.value;
  return values;
}

function specOf(tpl, values, extra) {
  const spec = { template: tpl.id, ...values, ...extra };
  if (tpl.mode === 'tile') {
    spec.lines = String(values.lines || '').split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return spec;
}

const DOC_PRESETS = [
  { name: '居住证', lines: '仅供办理居住证使用\n他用无效' },
  { name: '入职', lines: '仅供入职资料使用\n他用无效' },
  { name: '贷款', lines: '仅供贷款审核使用\n他用无效' },
  { name: '身份证', lines: '仅供实名认证使用\n复印件无效' },
];

export function renderWatermark(app) {
  const view = $('#view-watermark');
  const templates = (app.watermarkTemplates || []).map((t) => ({
    ...t,
    fields: (t.fields || []).map((f) => ({ ...f, name: f.key || f.name })),
  }));
  state = {
    templates,
    templateId: templates[0]?.id,
    values: {},
    extra: { position: 'bottom-left', scale: 100, opacity: 92, accent: '', opacityTile: 22, logo: null },
    photo: null,
    previewUrl: null,
    previewTimer: null,
    results: null,
    busy: false,
  };
  state.values = { ...defaultsOf(templates[0]), ...(getTemplate(templates[0]?.id) || {}) };

  view.innerHTML = `
    <div class="tool-head">
      <a class="back" href="#/cat/image">← 返回图片</a>
      <div class="tool-title">
        <span class="tool-ico cat-image">${iconSvg('watermark')}</span>
        <div><h1>工作水印 / 全图水印</h1><p>6 套现场打卡水印，加 1 套证件防滥用透明水印；参数可保存复用</p></div>
      </div>
    </div>
    <div class="wm-layout">
      <div class="panel">
        <div class="panel-title"><h2>1. 选择模板</h2><span>共 ${templates.length} 套</span></div>
        <div class="wm-templates" data-templates></div>
        <div class="panel-title"><h2>2. 上传照片</h2><span>支持批量，第一张用于预览</span></div>
        <div data-files></div>
        <div class="panel-title"><h2>3. 填写信息</h2><span data-tpl-note></span></div>
        <div class="field-grid" data-fields></div>
        <div data-docpresets hidden class="chip-row"></div>
        <details class="adv">
          <summary>进阶：位置 / 缩放 / 透明度 / 主色 / Logo</summary>
          <div class="field-grid" data-adv></div>
          <div class="adv-row"><label class="btn btn-ghost btn-sm">上传 Logo<input type="file" accept="image/*" data-logo hidden></label><span data-logo-name class="muted">未选择</span></div>
        </details>
        <div class="run-bar">
          <button class="btn btn-primary" data-run>生成水印图</button>
          <button class="btn btn-ghost" data-save>保存为我的模板</button>
          <button class="btn btn-ghost" data-reset>恢复默认</button>
          <span class="run-hint" data-hint></span>
        </div>
        <div class="results" data-results hidden></div>
      </div>
      <div class="panel wm-preview-panel">
        <div class="panel-title"><h2>实时预览</h2><span data-preview-note>选择照片后自动生成</span></div>
        <div class="wm-preview" data-preview>
          <div class="wm-preview-empty">${iconSvg('image')}<span>还没有照片</span></div>
        </div>
        <div class="wm-preview-actions">
          <a class="btn btn-ghost btn-sm" data-preview-download hidden download>下载预览图</a>
          <button class="btn btn-ghost btn-sm" data-preview-refresh>重新生成</button>
        </div>
      </div>
    </div>
  `;

  const tplBox = $('[data-templates]', view);
  const fieldsBox = $('[data-fields]', view);
  const advBox = $('[data-adv]', view);
  const presetBox = $('[data-docpresets]', view);
  const previewBox = $('[data-preview]', view);
  const hint = $('[data-hint]', view);
  const runBtn = $('[data-run]', view);
  const results = $('[data-results]', view);
  const list = createFileList($('[data-files]', view), {
    multiple: true,
    accept: 'image/*',
    onChange: (files) => {
      state.photo = files[0] || null;
      state.results = files;
      $('[data-preview-download]', view).hidden = true;
      if (state.photo) schedulePreview();
    },
  });

  function currentTemplate() {
    return state.templates.find((t) => t.id === state.templateId) || state.templates[0];
  }

  function renderTemplates() {
    tplBox.innerHTML = state.templates.map((t) => `
      <button type="button" class="wm-tpl ${t.id === state.templateId ? 'active' : ''}" data-tpl="${t.id}" style="--accent:${esc(t.accent)}">
        <span class="wm-tpl-bar"></span>
        <b>${esc(t.name)}</b>
        <small>${esc(t.desc)}</small>
      </button>`).join('');
  }

  function renderAdv() {
    const tpl = currentTemplate();
    const fields = tpl.mode === 'tile'
      ? [{ name: 'opacity', label: '整体不透明度', type: 'range', value: state.values.opacity ?? 22, min: 4, max: 70, suffix: '%' }]
      : [
        { name: 'position', label: '水印位置', type: 'select', value: state.extra.position, options: [['bottom-left', '左下'], ['bottom-right', '右下'], ['top-left', '左上'], ['top-right', '右上'], ['center', '居中']] },
        { name: 'scale', label: '卡片大小', type: 'range', value: state.extra.scale, min: 60, max: 150, suffix: '%' },
        { name: 'opacity', label: '卡片不透明度', type: 'range', value: state.extra.opacity, min: 35, max: 100, suffix: '%' },
        { name: 'accent', label: '主色', type: 'color', value: state.extra.accent || tpl.accent },
      ];
    renderFields(advBox, fields);
  }

  function renderDocPresets() {
    const tpl = currentTemplate();
    presetBox.hidden = tpl.mode !== 'tile';
    if (tpl.mode !== 'tile') return;
    presetBox.innerHTML = DOC_PRESETS.map((p) => '<button type="button" class="chip" data-preset="' + esc(p.name) + '">' + esc(p.name) + '</button>').join('');
    presetBox.onclick = (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      const preset = DOC_PRESETS.find((p) => p.name === btn.dataset.preset);
      if (!preset) return;
      state.values.lines = preset.lines;
      renderFields(fieldsBox, currentTemplate().fields, state.values);
      toggleLineWrap();
      schedulePreview();
    };
  }

  function renderTplFields() {
    const tpl = currentTemplate();
    renderFields(fieldsBox, tpl.fields, state.values);
    $('[data-tpl-note]', view).textContent = tpl.name;
    renderAdv();
    renderDocPresets();
    toggleLineWrap();
    const dl = $('[data-preview-download]', view);
    if (dl) dl.hidden = true;
  }

  function toggleLineWrap() {
    const tpl = currentTemplate();
    const lineField = tpl.mode === 'tile' ? fieldsBox.querySelector('[data-field="lines"]') : null;
    if (!lineField) return;
    lineField.rows = 4;
  }

  function readValues() {
    const tpl = currentTemplate();
    const values = readFields(fieldsBox, tpl.fields);
    const adv = readFields(advBox, advRawFields());
    if (tpl.mode === 'tile') {
      values.opacity = Number(adv.opacity);
      state.values = { ...values };
      state.extra.opacity = state.extra.opacity;
    } else {
      state.extra.position = adv.position;
      state.extra.scale = Number(adv.scale);
      state.extra.opacity = Number(adv.opacity);
      state.extra.accent = adv.accent;
      state.values = { ...values };
    }
    return values;
  }

  function advRawFields() {
    const tpl = currentTemplate();
    return tpl.mode === 'tile'
      ? [{ name: 'opacity' }]
      : [{ name: 'position' }, { name: 'scale' }, { name: 'opacity' }, { name: 'accent' }];
  }

  function buildSpec() {
    const tpl = currentTemplate();
    const values = readValues();
    if (tpl.mode === 'tile') {
      return { template: tpl.id, ...values, opacity: Number(values.opacity), lines: String(values.lines || '').split('\n') };
    }
    return {
      template: tpl.id,
      ...values,
      position: state.extra.position,
      scale: Number(state.extra.scale),
      opacity: Number(state.extra.opacity),
      accent: state.extra.accent || tpl.accent,
    };
  }

  function schedulePreview() {
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(makePreview, 650);
  }

  async function makePreview() {
    if (!state.photo || state.busy) return;
    const spec = buildSpec();
    hint.textContent = '正在生成预览…';
    const payload = [{ field: 'files', file: state.photo, name: state.photo.name }];
    if (state.extra.logo) payload.push({ field: 'logo', file: state.extra.logo, name: state.extra.logo.name });
    try {
      const data = await postForm('/api/image/watermark-template?preview=1', { files: payload, fields: { spec: JSON.stringify(spec) } });
      const file = data.files?.[0];
      if (!file) return;
      state.previewUrl = file.url;
      previewBox.innerHTML = '<img src="' + esc(file.url) + '" alt="水印预览">';
      const dl = $('[data-preview-download]', view);
      dl.href = file.url;
      dl.download = file.name;
      dl.hidden = false;
      hint.textContent = '';
      $('[data-preview-note]', view).textContent = file.name;
    } catch (err) {
      hint.textContent = '';
      toast(err.message, 'error', 5000);
    }
  }

  renderTemplates();
  renderTplFields();

  tplBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tpl]');
    if (!btn) return;
    readValues();
    saveTpl(state.templateId, state.values);
    state.templateId = btn.dataset.tpl;
    const tpl = currentTemplate();
    state.values = { ...defaultsOf(tpl), ...(getTemplate(tpl.id) || {}) };
    renderTemplates();
    renderTplFields();
    makePreview();
  });

  fieldsBox.addEventListener('input', schedulePreview);
  fieldsBox.addEventListener('change', schedulePreview);
  advBox.addEventListener('input', schedulePreview);
  advBox.addEventListener('change', schedulePreview);

  $('[data-logo]', view).addEventListener('change', (e) => {
    const file = e.target.files?.[0] || null;
    state.extra.logo = file;
    $('[data-logo-name]', view).textContent = file ? file.name : '未选择';
    makePreview();
  });

  $('[data-preview-refresh]', view).addEventListener('click', makePreview);

  $('[data-save]', view).addEventListener('click', () => {
    readValues();
    saveTpl(state.templateId, state.values);
    toast('已保存到“我的模板”（浏览器本地）');
  });

  $('[data-reset]', view).addEventListener('click', () => {
    const tpl = currentTemplate();
    delTpl(tpl.id);
    state.values = defaultsOf(tpl);
    renderTplFields();
    toast('已恢复模板默认值');
    makePreview();
  });

  runBtn.addEventListener('click', async () => {
    if (!list.files.length) { toast('请先选择照片', 'error'); return; }
    const spec = buildSpec();
    saveTpl(state.templateId, state.values);
    setBusy(runBtn, true, '正在生成…');
    state.busy = true;
    hint.textContent = '正在为 ' + list.files.length + ' 张图片添加水印…';
    try {
      const payload = list.files.map((f) => ({ field: 'files', file: f, name: f.name }));
      if (state.extra.logo) payload.push({ field: 'logo', file: state.extra.logo, name: state.extra.logo.name });
      const data = await postForm('/api/image/watermark-template', { files: payload, fields: { spec: JSON.stringify(spec) } });
      renderResults(results, data, '水印');
      toast('已生成 ' + data.files.length + ' 张水印图');
      hint.textContent = data.note || '';
    } catch (err) {
      toast(err.message, 'error', 5000);
      hint.textContent = '';
    } finally {
      state.busy = false;
      setBusy(runBtn, false, '生成水印图');
    }
  });
}
