import { $, esc } from '../core/dom.mjs';
import { getJson } from '../core/api.mjs';
import { toast } from '../core/ui.mjs';

const SUITE_NAME = { pdf: 'PDF', media: '音视频', net: '网络安全', image: '图片', doc: '文档', sheet: '表格', ocr: 'OCR', misc: '其它' };

export async function renderHistory(app) {
  const view = $('#view-history');
  view.innerHTML = `
    <div class="tool-head">
      <a class="back" href="#/">← 返回全部工具</a>
      <div class="tool-title">
        <span class="tool-ico cat-pdf">${'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path></svg>'}</span>
        <div><h1>处理历史</h1><p>所有处理任务都记录在本地 MySQL（${esc(app?.db?.database || 'docbox')} 库 · jobs 表），不上传任何服务器。</p></div>
      </div>
    </div>
    <div class="workspace">
      <div class="panel">
        <div class="panel-title">
          <h2>最近任务</h2>
          <span data-dbstate>${app?.db?.available ? 'MySQL v' + esc(app.db.version || '') + ' · 已连接' : '数据库未连接，历史记录不可用'}</span>
        </div>
        <div class="chip-row" data-filters>
          <button class="chip active" data-suite="">全部</button>
          <button class="chip" data-suite="pdf">PDF</button>
          <button class="chip" data-suite="media">音视频</button>
          <button class="chip" data-suite="net">网络安全</button>
        </div>
        <div class="run-bar">
          <button class="btn btn-ghost" data-refresh>刷新</button>
          <button class="btn btn-ghost" data-clear>清空历史</button>
          <span class="run-hint" data-histhint></span>
        </div>
        <div class="hist-wrap" data-table><div class="recent-empty">加载中…</div></div>
      </div>
    </div>`;

  const table = $('[data-table]', view);
  const hint = $('[data-histhint]', view);
  let suite = '';

  async function load() {
    table.innerHTML = '<div class="recent-empty">加载中…</div>';
    try {
      const q = '/api/history?limit=100' + (suite ? '&suite=' + encodeURIComponent(suite) : '');
      const data = await getJson(q);
      const jobs = data.jobs || [];
      if (!jobs.length) {
        table.innerHTML = '<div class="recent-empty">还没有处理记录。任意工具跑一次就会出现在这里。</div>';
        hint.textContent = '';
        return;
      }
      table.innerHTML = `<table class="hist-table"><thead><tr>
          <th>时间</th><th>分类</th><th>工具</th><th>耗时</th><th>结果</th><th>状态</th>
        </tr></thead><tbody>` + jobs.map((j) => `
          <tr>
            <td class="mono">${esc(String(j.createdAt || '').replace('T', ' ').slice(5, 16))}</td>
            <td><span class="hist-tag">${esc(SUITE_NAME[j.suite] || j.suite)}</span></td>
            <td>${esc(j.tool)}</td>
            <td class="mono">${j.durationMs ? Math.round(j.durationMs) + ' ms' : '-'}</td>
            <td title="${esc(j.note || j.error || '')}">${esc((j.note || j.error || '').slice(0, 46))}</td>
            <td>${j.status === 'ok' ? '<span class="ok-dot"></span>成功' : '<span class="fail-dot"></span>失败'}</td>
          </tr>`).join('') + '</tbody></table>';
      const st = data.stats;
      hint.textContent = st ? '累计 ' + st.total + ' 条记录' : '';
    } catch (err) {
      table.innerHTML = '<div class="recent-empty">加载失败：' + esc(err.message) + '</div>';
    }
  }

  view.querySelectorAll('[data-filters] .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      view.querySelectorAll('[data-filters] .chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      suite = btn.dataset.suite || '';
      load();
    });
  });
  $('[data-refresh]', view).addEventListener('click', load);
  $('[data-clear]', view).addEventListener('click', async () => {
    try {
      await fetch('/api/history', { method: 'DELETE' });
      toast('已清空历史');
      load();
    } catch { toast('清空失败', 'error'); }
  });
  await load();
}
