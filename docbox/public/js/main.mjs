import { $, $$, esc } from './core/dom.mjs';
import { getJson } from './core/api.mjs';
import { loadStore } from './core/store.mjs';
import { toast } from './core/ui.mjs';
import { auth, fetchMe, can, isAdmin, logout } from './core/auth.mjs';
import { buildCatalog, CATS, MODULE_NAV } from './tools/catalog.mjs';
import { renderHome, renderRecent, wireClearRecent } from './views/home.mjs';
import { renderTool } from './views/tool.mjs';
import { renderWatermark } from './views/watermark.mjs';
import { renderIdPhoto, cleanupIdPhoto } from './views/idphoto.mjs';
import { renderEditor } from './views/editor.mjs';
import { renderExtract } from './views/extract.mjs';
import { renderOcr } from './views/ocr.mjs';
import { renderHistory } from './views/history.mjs';
import { renderAccounts } from './views/accounts.mjs';
import { renderMdEditor } from './views/md-editor.mjs';
import { renderMdTable } from './views/md-table.mjs';
import { renderTerminal } from './views/terminal.mjs';
import { renderVideo, cleanupVideo } from './views/video.mjs';
import { renderLogin, hideLogin } from './views/login.mjs';

history.scrollRestoration = 'manual';
const SCROLL_KEY = 'docbox.scroll';
const scrollMemory = new Map();
let lastHash = null;

try {
  const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}');
  Object.keys(saved).forEach((k) => scrollMemory.set(k, Number(saved[k]) || 0));
} catch { /* 忽略损坏的存储 */ }

function persistScroll() {
  try {
    const obj = {};
    scrollMemory.forEach((v, k) => { obj[k] = v; });
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(obj));
  } catch { /* 隐私模式忽略 */ }
}

const VIEWS = ['home', 'tool', 'watermark', 'idphoto', 'editor', 'extract', 'ocr', 'history', 'accounts', 'md-editor', 'md-table', 'terminal', 'video'];
let app = null;
let wired = false;

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
  return { parts: hash.split('/').filter(Boolean) };
}

/* ---------------- 权限与外壳 ---------------- */
function applyShell() {
  // 左侧导航：隐藏无权限模块
  $$('#sideNav .nav-item[data-module]').forEach((el) => {
    const mod = el.dataset.module;
    el.hidden = !can(mod);
  });
  const accNav = document.getElementById('navAccounts');
  if (accNav) accNav.hidden = !isAdmin();

  // 右上角用户信息
  const chip = document.getElementById('userChip');
  if (chip) {
    if (!auth.enabled) {
      chip.innerHTML = '<span class="u-avatar">L</span><span class="u-name">本地模式</span><span class="u-role">免登录</span>';
    } else {
      const u = auth.user;
      const roleName = u.role === 'admin' ? '管理员' : '普通用户';
      chip.innerHTML = '<span class="u-avatar">' + esc((u.username || '?').slice(0, 1).toUpperCase()) + '</span>' +
        '<span class="u-name">' + esc(u.username) + '</span><span class="u-role">' + roleName + '</span>';
      const pop = document.getElementById('userPop');
      if (pop) {
        pop.innerHTML = '<div class="up-head"><b>' + esc(u.username) + '</b><span>' + roleName + ' · ' +
          (u.role === 'admin' ? '全部模块' : auth.modules.length + ' 个模块') + '</span></div>' +
          (isAdmin() ? '<a href="#/accounts" class="up-item">账户管理</a>' : '') +
          '<button class="up-item" id="logoutBtn">退出登录</button>';
      }
    }
  }
}

function wireShell() {
  if (wired) return;
  wired = true;
  wireClearRecent();
  wireSearch();

  const chip = document.getElementById('userChip');
  const pop = document.getElementById('userPop');
  if (chip && pop) {
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      pop.hidden = !pop.hidden;
    });
    document.addEventListener('click', () => { pop.hidden = true; });
    pop.addEventListener('click', async (ev) => {
      if (ev.target.id === 'logoutBtn') {
        await logout();
        location.hash = '#/';
        location.reload();
      }
    });
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('docbox:unauthorized', () => {
    if (auth.enabled) renderLogin(boot);
  });
}

/* ---------------- 路由 ---------------- */
function route() {
  if (!app) return;
  // 记住上一个列表页的滚动位置：从分类页进入工具后返回，仍停在原来的板块位置
  const hash = location.hash || '#/';
  if (lastHash && lastHash !== hash) { scrollMemory.set(lastHash, window.scrollY); persistScroll(); }
  lastHash = hash;
  const { parts } = parseHash();
  const [head, arg] = parts;
  const restore = scrollMemory.has(hash) ? scrollMemory.get(hash) : 0;
  paint(head, arg);
  restoreScroll(restore);
}

function restoreScroll(y) {
  if (!y) { window.scrollTo(0, 0); return; }
  const apply = () => window.scrollTo(0, y);
  requestAnimationFrame(apply);
  // 异步渲染的页面（历史记录等）高度可能在首帧后仍不足，补一次
  setTimeout(() => {
    if (Math.abs(window.scrollY - y) > 4) window.scrollTo(0, y);
  }, 160);
}

function paint(head, arg) {
  if (head !== 'video' && typeof cleanupVideo === 'function') cleanupVideo();

  const guard = (mod) => {
    if (can(mod)) return true;
    toast('当前账户没有该模块的访问权限', 'error');
    location.hash = '#/';
    return false;
  };

  if (!head) { hideViews('home'); syncNav('home'); renderHome(app); return; }
  if (head === 'cat') {
    if (!guard(arg)) return;
    hideViews('home');
    syncNav(arg);
    renderHome(app, arg);
    return;
  }
  if (head === 'tool') {
    const tool = app.tools.find((t) => t.id === arg);
    if (!tool) { location.hash = '#/'; return; }
    if (!guard(tool.cat)) return;
    hideViews('tool');
    syncNav(tool.cat);
    renderTool(app, tool);
    return;
  }
  if (head === 'watermark') { if (!guard('image')) return; hideViews('watermark'); syncNav('image'); renderWatermark(app); return; }
  if (head === 'idphoto') { if (!guard('image')) return; hideViews('idphoto'); syncNav('image'); renderIdPhoto(app); return; }
  if (head === 'editor') { if (!guard('image')) return; hideViews('editor'); syncNav('image'); renderEditor(app); return; }
  if (head === 'extract') { if (!guard('pdf')) return; hideViews('extract'); syncNav('pdf'); renderExtract(app); return; }
  if (head === 'ocr') { if (!guard('ocr')) return; hideViews('ocr'); syncNav('ocr'); renderOcr(app); return; }
  if (head === 'history') { if (!guard('history')) return; hideViews('history'); syncNav('history'); renderHistory(app); return; }
  if (head === 'video') { if (!guard('media')) return; hideViews('video'); syncNav('media'); renderVideo(app); return; }
  if (head === 'terminal') { if (!guard('net')) return; hideViews('terminal'); syncNav('net'); renderTerminal(app); return; }
  if (head === 'md-editor') { if (!guard('doc')) return; hideViews('md-editor'); syncNav('doc'); renderMdEditor(app); return; }
  if (head === 'md-table') { if (!guard('doc')) return; hideViews('md-table'); syncNav('doc'); renderMdTable(app); return; }
  if (head === 'accounts') {
    if (!isAdmin()) { toast('仅管理员可访问账户管理', 'error'); location.hash = '#/'; return; }
    hideViews('accounts');
    syncNav('accounts');
    renderAccounts(app);
    return;
  }
  location.hash = '#/';
}

function wireSearch() {
  const input = $('#searchInput');
  if (!input) return;
  input.addEventListener('input', () => {
    if (!app) return;
    const q = input.value.trim().toLowerCase();
    if (location.hash && location.hash !== '#/' && !location.hash.startsWith('#/cat/')) {
      if (q) location.hash = '#/';
    }
    const cards = $$('.tool-card');
    let shown = 0;
    for (const card of cards) {
      const match = !q || card.textContent.toLowerCase().includes(q);
      card.style.display = match ? '' : 'none';
      if (match) shown++;
    }
    $$('.tool-group').forEach((group) => {
      const any = [...group.querySelectorAll('.tool-card')].some((c) => c.style.display !== 'none');
      group.style.display = any ? '' : 'none';
    });
    const count = $('#toolCount');
    if (count) count.textContent = q ? shown + ' 个匹配工具' : app.tools.length + ' 个可用工具';
  });
}

/* ---------------- 启动 ---------------- */
async function boot() {
  await fetchMe();
  if (auth.enabled && !auth.user) {
    renderLogin(boot);
    return;
  }
  hideLogin();
  loadStore();
  try {
    app = await getJson('/api/app');
    const built = buildCatalog(app);
    app.allTools = built.tools;
    app.tools = built.tools.filter((t) => can(t.cat));
  } catch (err) {
    toast('无法连接本地服务，请确认 server.mjs 已启动', 'error', 8000);
    return;
  }
  const ver = document.querySelector('[data-version]');
  if (ver) ver.textContent = 'v' + (app.version || '0.1.1');
  const sb = document.getElementById('sbStatus');
  if (sb) {
    const dbOk = Boolean(app.db?.available);
    sb.className = 'pill ' + (dbOk ? 'pill-ok' : 'pill-warn');
    sb.innerHTML = '<i></i>' + (dbOk ? 'MySQL v' + esc(app.db.version || '') : '本地数据库未连接') + ' · ' + app.tools.length + ' 项可用工具';
  }
  applyShell();
  wireShell();
  route();
}

boot();
