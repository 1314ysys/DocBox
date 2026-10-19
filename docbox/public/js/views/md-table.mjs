import { $, esc } from '../core/dom.mjs';
import { toast } from '../core/ui.mjs';

const ALIGN = [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']];

function buildMarkdown({ rows, cols, headers, aligns }) {
  const header = Array.from({ length: cols }, (_, i) => headers[i] || '列' + (i + 1));
  const sep = header.map((_, i) => (aligns[i] === 'center' ? ':---:' : aligns[i] === 'right' ? '---:' : ':---'));
  const lines = ['| ' + header.join(' | ') + ' |', '| ' + sep.join(' | ') + ' |'];
  for (let r = 1; r <= rows; r++) {
    const cells = [];
    for (let c = 1; c <= cols; c++) cells.push('单元格' + r + '-' + c);
    lines.push('| ' + cells.join(' | ') + ' |');
  }
  return lines.join('\n');
}

export function renderMdTable(app) {
  const view = $('#view-md-table');
  view.innerHTML = `
    <div class="tool-head">
      <a class="back" href="#/">← 返回全部工具</a>
      <div class="tool-title">
        <span class="tool-ico cat-doc">TAB</span>
        <div><h1>Markdown 表格生成器</h1><p>选好行数与列数，实时生成标准 Markdown 表格模板，可复制或下载 .md。</p></div>
      </div>
    </div>
    <div class="workspace">
      <div class="panel">
        <div class="panel-title"><h2>表格尺寸</h2><span class="muted">最多 50 行 × 20 列</span></div>
        <div class="field-grid">
          <label class="fld"><span>数据行数</span><input type="number" min="1" max="50" value="3" data-rows></label>
          <label class="fld"><span>列数</span><input type="number" min="1" max="20" value="3" data-cols></label>
          <label class="fld"><span>表头（逗号分隔，可留空）</span><input type="text" placeholder="姓名,部门,备注" data-headers></label>
          <label class="fld"><span>对齐方式</span>
            <select data-align>${ALIGN.map((a) => '<option value="' + a[0] + '">' + a[1] + '</option>').join('')}</select>
          </label>
        </div>
        <div class="panel-title"><h2>预览</h2></div>
        <div class="md-table-preview" data-preview></div>
        <div class="panel-title"><h2>Markdown</h2>
          <div class="data-actions">
            <button class="btn btn-ghost btn-sm" data-copy>复制</button>
            <button class="btn btn-ghost btn-sm" data-download>下载 .md</button>
            <button class="btn btn-soft btn-sm" data-open>在编辑器中打开</button>
          </div>
        </div>
        <pre class="md-code" data-code></pre>
      </div>
    </div>`;

  const rowsInp = $('[data-rows]', view);
  const colsInp = $('[data-cols]', view);
  const headersInp = $('[data-headers]', view);
  const alignSel = $('[data-align]', view);
  const preview = $('[data-preview]', view);
  const code = $('[data-code]', view);
  let current = '';

  function refresh() {
    const rows = Math.min(Math.max(Number(rowsInp.value) || 1, 1), 50);
    const cols = Math.min(Math.max(Number(colsInp.value) || 1, 1), 20);
    const headers = headersInp.value.split(',').map((s) => s.trim()).filter(Boolean);
    const aligns = Array.from({ length: cols }, () => alignSel.value);
    current = buildMarkdown({ rows, cols, headers, aligns });
    code.textContent = current;
    const head = Array.from({ length: cols }, (_, i) => headers[i] || '列' + (i + 1));
    const body = [];
    for (let r = 1; r <= rows; r++) {
      body.push('<tr>' + head.map((_, i) => '<td>单元格' + r + '-' + (i + 1) + '</td>').join('') + '</tr>');
    }
    preview.innerHTML = '<table class="md-table"><thead><tr>' +
      head.map((h) => '<th style="text-align:' + alignSel.value + '">' + esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' + body.join('') + '</tbody></table>';
  }

  [rowsInp, colsInp, headersInp, alignSel].forEach((el) => el.addEventListener('input', refresh));
  alignSel.addEventListener('change', refresh);

  $('[data-copy]', view).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(current); toast('已复制 Markdown 表格'); }
    catch { toast('复制失败', 'error'); }
  });
  $('[data-download]', view).addEventListener('click', () => {
    const blob = new Blob([current], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'table-' + Date.now() + '.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('[data-open]', view).addEventListener('click', () => {
    try { localStorage.setItem('docbox.md.draft', current + '\n\n'); } catch { /* ignore */ }
    location.hash = '#/md-editor';
  });

  refresh();
}
