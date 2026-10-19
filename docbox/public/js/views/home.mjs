import { $, esc, iconSvg, fmtBytes } from '../core/dom.mjs';
import { store, clearRecent } from '../core/store.mjs';
import { CATS } from '../tools/catalog.mjs';

export function renderHome(app, filter) {
  const cats = Object.keys(CATS).filter((c) => !filter || c === filter);
  const sections = cats.map((cat) => {
    const items = app.tools.filter((t) => t.cat === cat);
    if (!items.length) return '';
    return `<section class="tool-group" data-cat="${cat}">
      <h3>${esc(CATS[cat].name)} <span>${esc(CATS[cat].desc)}</span></h3>
      <div class="tool-grid">${items.map(card).join('')}</div>
    </section>`;
  }).join('');
  $('#toolSections').innerHTML = sections || '<div class="recent-empty">这个分类还没有工具。</div>';

  const stats = {
    tools: app.tools.length,
    native: app.tools.filter((t) => !t.stirling).length,
    stirling: app.stirling?.online ? 'v' + (app.stirling.version || '?') : '离线',
  };
  $('#statTools').textContent = String(stats.tools);
  $('#statNative').textContent = String(stats.native);
  $('#statStirling').textContent = stats.stirling;
  $('#toolCount').textContent = filter ? app.tools.filter((t) => t.cat === filter).length + ' 个工具' : app.tools.length + ' 个本地工具';

  const head = document.querySelector('#view-home .section-head');
  const old = document.getElementById('showAllTools');
  if (filter && head && !old) {
    const btn = document.createElement('a');
    btn.id = 'showAllTools';
    btn.className = 'btn btn-ghost btn-sm';
    btn.href = '#/';
    btn.textContent = '显示全部工具';
    head.append(btn);
  } else if (!filter) {
    old?.remove();
  }
  renderRecent();
}

function card(t) {
  const href = t.route || '#/tool/' + t.id;
  return `<a class="tool-card cat-${t.cat}" href="${href}" data-tool="${t.id}">
    ${t.badge ? '<span class="t-badge">' + esc(t.badge) + '</span>' : ''}
    <span class="t-ico cat-${t.cat}">${iconSvg(t.icon)}</span>
    <div class="t-body"><b>${esc(t.name)}</b><p>${esc(t.desc)}</p></div>
    <span class="t-arrow">→</span>
  </a>`;
}

export function renderRecent() {
  const list = $('#recentList');
  if (!list) return;
  if (!store.recent.length) {
    list.innerHTML = '<div class="recent-empty">还没有处理记录。选择一个工具开始，结果会自动出现在这里。</div>';
    return;
  }
  list.innerHTML = store.recent.map((r) => `
    <div class="recent-item">
      <span class="r-ico">${esc((r.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase())}</span>
      <span class="r-body"><b title="${esc(r.name)}">${esc(r.name)}</b><span>${esc(r.tool)} · ${fmtBytes(r.size)}</span></span>
      <a href="${esc(r.url)}" download="${esc(r.name)}">下载</a>
    </div>`).join('');
}

export function wireClearRecent() {
  const btn = $('#recentClear');
  if (!btn) return;
  btn.onclick = () => { clearRecent(); renderRecent(); };
}
