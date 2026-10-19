import { $, $$ } from './core/dom.mjs';
import { getJson } from './core/api.mjs';
import { loadStore } from './core/store.mjs';
import { toast } from './core/ui.mjs';
import { buildCatalog, CATS } from './tools/catalog.mjs';
import { renderHome, renderRecent, wireClearRecent } from './views/home.mjs';
import { renderTool } from './views/tool.mjs';
import { renderWatermark } from './views/watermark.mjs';
import { renderIdPhoto, cleanupIdPhoto } from './views/idphoto.mjs';
import { renderEditor } from './views/editor.mjs';
import { renderExtract } from './views/extract.mjs';
import { renderOcr } from './views/ocr.mjs';

const VIEWS = ['home', 'tool', 'watermark', 'idphoto', 'editor', 'extract', 'ocr'];
let app = null;

function hideViews(name) {
  for (const v of VIEWS) {
    const el = document.getElementById('view-' + v);
    if (el) el.hidden = v !== name;
  }
  $$('#sideNav .nav-item').forEach((a) => a.classList.remove('active'));
}

function syncNav(cat) {
  const item = document.querySelector('#sideNav .nav-item[data-nav="' + cat + '"]');
  if (item) item.classList.add('active');
}

function parseHash() {
  const hash = (location.hash || '#/').replace(/^#/, '');
  const parts = hash.split('/').filter(Boolean);
  return { parts };
}

function route() {
  if (!app) return;
  const { parts } = parseHash();
  const [head, arg] = parts;
  window.scrollTo({ top: 0 });
  if (!head) {
    hideViews('home');
    syncNav('home');
    renderHome(app);
    return;
  }
  if (head === 'cat') {
    hideViews('home');
    syncNav(arg);
    renderHome(app, arg);
    return;
  }
  if (head === 'tool') {
    const tool = app.tools.find((t) => t.id === arg);
    if (!tool) { location.hash = '#/'; return; }
    hideViews('tool');
    syncNav(tool.cat);
    renderTool(app, tool);
    return;
  }
  if (head === 'watermark') {
    hideViews('watermark');
    syncNav('image');
    renderWatermark(app);
    return;
  }
  if (head === 'idphoto') {
    hideViews('idphoto');
    syncNav('image');
    renderIdPhoto(app);
    return;
  }
  if (head === 'editor') {
    hideViews('editor');
    syncNav('image');
    renderEditor(app);
    return;
  }
  if (head === 'extract') {
    hideViews('extract');
    syncNav('pdf');
    renderExtract(app);
    return;
  }
  if (head === 'ocr') {
    hideViews('ocr');
    syncNav('ocr');
    renderOcr(app);
    return;
  }
  location.hash = '#/';
}

function wireSearch() {
  const input = $('#searchInput');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (location.hash && location.hash !== '#/' && !location.hash.startsWith('#/cat/')) {
      if (q) location.hash = '#/';
    }
    const cards = $$('.tool-card');
    let shown = 0;
    for (const card of cards) {
      const text = card.textContent.toLowerCase();
      const match = !q || text.includes(q);
      card.style.display = match ? '' : 'none';
      if (match) shown++;
    }
    $$('.tool-group').forEach((group) => {
      const any = [...group.querySelectorAll('.tool-card')].some((c) => c.style.display !== 'none');
      group.style.display = any ? '' : 'none';
    });
    const count = $('#toolCount');
    if (count) count.textContent = q ? shown + ' 个匹配工具' : app.tools.length + ' 个本地工具';
  });
}

async function boot() {
  loadStore();
  try {
    app = await getJson('/api/app');
    app.tools = buildCatalog(app).tools;
  } catch (err) {
    toast('无法连接本地服务，请确认 server.mjs 已启动', 'error', 8000);
    return;
  }
  const ver = document.querySelector('[data-version]');
  if (ver) ver.textContent = 'v' + (app.version || '0.0.0');
  const pill = $('#stirlingPill');
  const sb = $('#sbStatus');
  const online = app.stirling?.online;
  if (pill) {
    pill.className = 'pill ' + (online ? 'pill-ok' : 'pill-warn');
    pill.innerHTML = '<i></i>Stirling-PDF ' + (online ? 'v' + (app.stirling.version || '?') : '未启动');
  }
  if (sb) {
    sb.className = 'pill ' + (online ? 'pill-ok' : 'pill-warn');
    sb.innerHTML = '<i></i>' + (online ? '在线 · ' + app.stirlingTools.length + ' 项工具' : '离线 · 仅本地引擎');
  }
  wireSearch();
  wireClearRecent();
  window.addEventListener('hashchange', route);
  route();
}

boot();
