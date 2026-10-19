import { $, esc } from '../core/dom.mjs';
import { toast, setBusy } from '../core/ui.mjs';

const KEY = 'docbox.md.draft';
const SAMPLE = [
  '# 项目周报',
  '',
  '本周完成了 **文档模块** 的 15 项能力补充，覆盖 Word / PPT / Markdown / TXT 与 PDF 互转。',
  '',
  '## 本周进展',
  '',
  '- Word、Excel、PowerPoint 转 PDF',
  '- 公文一键排版（A4 / 仿宋三号 / 页码）',
  '- Markdown 编辑器与表格生成器',
  '',
  '## 下周计划',
  '',
  '1. 补齐图片与音视频的预览体验',
  '2. 压测 50 页以上的 PPTX 转换',
  '',
  '> 提示：右侧为实时预览，可直接导出 HTML 或 PDF。',
  '',
  '| 模块 | 数量 | 状态 |',
  '| :--- | :---: | ---: |',
  '| 文档 | 15 | 完成 |',
].join('\n');

let timer = null;
let lastHtml = '';

function download(name, textOrBlob, mime) {
  const blob = textOrBlob instanceof Blob ? textOrBlob : new Blob([textOrBlob], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function renderMdEditor(app) {
  const view = $('#view-md-editor');
  view.innerHTML = `
    <div class="tool-head">
      <a class="back" href="#/cat/doc">← 返回文档</a>
      <div class="tool-title">
        <span class="tool-ico cat-doc">MD</span>
        <div><h1>Markdown 编辑器</h1><p>左边编辑、右边实时预览，支持导出 HTML / PDF / .md，草稿自动保存在本机浏览器。</p></div>
      </div>
    </div>
    <div class="workspace">
      <div class="panel md-panel">
        <div class="md-toolbar">
          <button class="btn btn-ghost btn-sm" data-act="sample">插入示例</button>
          <button class="btn btn-ghost btn-sm" data-act="table">插入表格</button>
          <button class="btn btn-ghost btn-sm" data-act="clear">清空</button>
          <span class="md-stats" data-stats></span>
          <span class="md-spacer"></span>
          <button class="btn btn-ghost btn-sm" data-act="copy">复制 Markdown</button>
          <button class="btn btn-ghost btn-sm" data-act="md">下载 .md</button>
          <button class="btn btn-soft btn-sm" data-act="html">导出 HTML</button>
          <button class="btn btn-primary btn-sm" data-act="pdf">导出 PDF</button>
        </div>
        <div class="md-split">
          <textarea class="md-input" data-md spellcheck="false" placeholder="# 在这里写 Markdown…"></textarea>
          <div class="md-preview" data-preview></div>
        </div>
      </div>
    </div>`;

  const ta = $('[data-md]', view);
  const preview = $('[data-preview]', view);
  const stats = $('[data-stats]', view);
  let saved = '';
  try { saved = localStorage.getItem(KEY) || ''; } catch { /* ignore */ }
  ta.value = saved || SAMPLE;

  function updateStats() {
    const text = ta.value;
    const words = text.replace(/\s/g, '').length;
    stats.textContent = words + ' 字 · ' + text.split('\n').length + ' 行';
  }

  async function renderPreview() {
    const md = ta.value;
    try {
      const res = await fetch('/api/doc/md-render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ md, title: 'Markdown 预览' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '渲染失败');
      lastHtml = data.data.standalone;
      preview.innerHTML = data.data.html;
    } catch (err) {
      preview.innerHTML = '<div class="md-error">' + esc(err.message) + '</div>';
    }
  }

  function schedulePreview() {
    updateStats();
    try { localStorage.setItem(KEY, ta.value); } catch { /* ignore */ }
    clearTimeout(timer);
    timer = setTimeout(renderPreview, 260);
  }

  ta.addEventListener('input', schedulePreview);
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') {
      ev.preventDefault();
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 2;
      schedulePreview();
    }
  });

  view.querySelector('.md-toolbar').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'sample') { ta.value = SAMPLE; schedulePreview(); return; }
    if (act === 'clear') { ta.value = ''; schedulePreview(); return; }
    if (act === 'table') {
      ta.value += '\n\n| 列1 | 列2 | 列3 |\n| :--- | :---: | ---: |\n| 内容 | 内容 | 内容 |\n';
      schedulePreview();
      return;
    }
    if (act === 'copy') {
      try { await navigator.clipboard.writeText(ta.value); toast('已复制 Markdown'); }
      catch { toast('复制失败', 'error'); }
      return;
    }
    if (act === 'md') { download('markdown-' + Date.now() + '.md', ta.value); toast('已下载 .md'); return; }
    if (act === 'html') {
      if (!lastHtml) { await renderPreview(); }
      download('markdown-' + Date.now() + '.html', lastHtml || '', 'text/html;charset=utf-8');
      toast('已导出 HTML');
      return;
    }
    if (act === 'pdf') {
      if (!ta.value.trim()) { toast('请先写点内容', 'error'); return; }
      setBusy(btn, true);
      try {
        const fd = new FormData();
        fd.append('file', new Blob([ta.value], { type: 'text/markdown' }), 'markdown.md');
        const res = await fetch('/api/doc/md-to-pdf', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || '导出失败');
        const f = data.files[0];
        const a = document.createElement('a');
        a.href = f.url;
        a.download = f.name;
        a.click();
        toast('已导出 PDF');
      } catch (err) {
        toast(err.message, 'error', 6000);
      } finally {
        setBusy(btn, false, '导出 PDF');
      }
    }
  });

  updateStats();
  renderPreview();
  ta.focus();
}
