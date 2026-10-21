import { $, esc, fmtBytes } from '../core/dom.mjs';
import { postJson, getJson, downloadUrl } from '../core/api.mjs';
import { toast, setBusy } from '../core/ui.mjs';

/**
 * 视频网站解析 + 批量下载
 * - 单条：贴链接 -> 解析（网页里的 m3u8 会被自动找出来）-> 选清晰度 -> 下载
 * - 多条：一行一条 -> 建后台任务 -> 自动解析 + 下载，任务列表实时看进度
 */
let st = null;
let pollTimer = null;

export function cleanupVideo() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

export function renderVideo() {
  cleanupVideo();
  const view = $('#view-video');
  st = { busy: false, info: null };

  view.innerHTML =
    '<div class="tool-head">' +
      '<a class="back" href="#/cat/media">← 返回音视频</a>' +
      '<div class="tool-title">' +
        '<span class="tool-ico cat-media"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg></span>' +
        '<div><h1>视频网站解析</h1><p>贴视频页链接 → 自动抓出页面里的 m3u8 → 选清晰度下载；也可以一次贴多条批量下载（后台任务，可离开页面）。支持 B 站 / YouTube / 爱奇艺 / 腾讯视频 / 优酷 / 抖音，以及任意 m3u8 直链。</p></div>' +
      '</div>' +
    '</div>' +
    '<div class="workspace-video">' +
      '<div class="panel">' +
        '<div class="panel-title"><h2>1. 单条解析</h2><span data-engine></span></div>' +
        '<div class="video-url-row">' +
          '<input class="input" id="videoUrl" placeholder="https://www.bilibili.com/video/BV... 或 https://..../index.m3u8" autocomplete="off">' +
          '<button class="btn btn-primary" id="videoParse">解析</button>' +
        '</div>' +
        '<label class="video-deep"><input type="checkbox" id="videoDeep" checked> 抓不到时用内置浏览器深度嗅探（后台无头 Edge/Chrome，最多 20 秒）</label>' +
        '<p class="muted" id="videoHint">解析顺序：站内 m3u8（yt-dlp 或页面抓取）→ 码率列表 → 内置 HLS 下载器。</p>' +
        '<div class="video-result" id="videoResult" hidden></div>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-title"><h2>2. 批量下载（任务列表）</h2><span data-stat>队列空闲</span></div>' +
        '<textarea class="input video-batch" id="videoUrls" rows="4" placeholder="一行一条链接，例如：&#10;https://www.bilibili.com/video/BV1xx411c7mD&#10;https://www.youtube.com/watch?v=xxxx&#10;https://example.com/hls/index.m3u8"></textarea>' +
        '<div class="run-bar">' +
          '<button class="btn btn-primary" id="videoBatch">加入下载队列</button>' +
          '<button class="btn btn-ghost" id="videoRefresh">刷新列表</button>' +
          '<button class="btn btn-ghost" id="videoClearAll">清空已完成</button>' +
          '<span class="run-hint" id="videoBatchHint">后台并发 2 个任务，关掉页面也会继续跑</span>' +
        '</div>' +
        '<div class="video-tasks" id="videoTasks"><p class="muted">暂无任务</p></div>' +
      '</div>' +
    '</div>';

  refreshEngine(view);

  $('#videoParse', view).addEventListener('click', () => parseOne(view));
  $('#videoUrl', view).addEventListener('keydown', (e) => { if (e.key === 'Enter') parseOne(view); });
  $('#videoBatch', view).addEventListener('click', () => addBatch(view));
  $('#videoRefresh', view).addEventListener('click', () => refreshTasks(view));
  $('#videoClearAll', view).addEventListener('click', () => clearDone(view));

  refreshTasks(view);
  pollTimer = setInterval(() => {
    if (!document.getElementById('view-video') || document.getElementById('view-video').hidden) { cleanupVideo(); return; }
    refreshTasks(view, true);
  }, 3000);
}

function refreshEngine(view) {
  getJson('/api/video/status').then((data) => {
    const el = $('[data-engine]', view);
    if (!el) return;
    const b = data.browser || {};
    const bTag = b.available ? '<span class="tag ok">内置浏览器 ' + esc(b.name || '') + '</span>' : '<span class="tag warn">无内置浏览器</span>';
    if (data.ytdlp?.available) {
      el.innerHTML = '<span class="tag ok">yt-dlp ' + esc(data.ytdlp.version) + '</span> <span class="tag">HLS 引擎</span> ' + bTag;
      return;
    }
    el.innerHTML = '<span class="tag warn">未检测到 yt-dlp</span> ' + bTag + ' ' +
      '<button class="btn btn-sm btn-primary" id="videoInstallYtdlp">一键安装 yt-dlp</button>';
    const btn = $('#videoInstallYtdlp', view);
    if (btn) btn.addEventListener('click', async () => {
      setBusy(btn, true, '安装中…');
      try {
        const r = await postJson('/api/video/ytdlp/install', {});
        toast(r.note || '安装完成', r.ok ? 'ok' : 'error', 8000);
        refreshEngine(view);
      } catch (e) {
        toast(e.message, 'error', 10000);
        setBusy(btn, false, '一键安装 yt-dlp');
      }
    });
  }).catch(() => {});
}

/* ---------------- 单条解析 ---------------- */
async function parseOne(view) {
  const url = $('#videoUrl', view).value.trim();
  const hint = $('#videoHint', view);
  const box = $('#videoResult', view);
  if (!url) { toast('请先粘贴视频链接', 'error'); return; }
  const btn = $('#videoParse', view);
  setBusy(btn, true, '解析中…');
  hint.textContent = '正在解析（网页 → m3u8）…';
  box.hidden = true;
  try {
    const deep = $('#videoDeep', view) ? $('#videoDeep', view).checked : true;
  const res = await postJson('/api/video/probe', { url, deep });
    st.info = res.data;
    renderInfo(box, res.data, url);
    box.hidden = false;
    hint.textContent = res.note || '解析完成';
  } catch (e) {
    hint.textContent = '';
    toast(e.message, 'error', 6000);
  } finally {
    setBusy(btn, false, '解析');
  }
}

function renderInfo(box, info, sourceUrl) {
  const formats = info.formats || [];
  const thumb = info.thumbnail ? '<img class="video-thumb" src="' + esc(info.thumbnail) + '" referrerpolicy="no-referrer" alt="">' : '';
  const engine = info.engine ? '<span class="tag">' + esc(info.engine) + '</span>' : '';
  const rows = formats.map((f, i) =>
    '<label class="video-fmt">' +
      '<input type="radio" name="videoFmt" value="' + esc(String(f.id)) + '" ' + (i === 0 ? 'checked' : '') + '>' +
      '<span class="fmt-name">' + esc(f.height ? f.height + 'P' : (f.note || f.ext || '默认')) + '</span>' +
      '<span class="fmt-meta">' + esc(f.type === 'hls' ? 'HLS' : (f.ext || '')) + ' · ' + esc(f.note || '') + (f.filesize ? ' · ' + fmtBytes(f.filesize) : '') + '</span>' +
    '</label>').join('');

  box.innerHTML =
    '<div class="video-head">' + thumb + '<div><b>' + esc(info.title || '未命名视频') + '</b> ' + engine +
      '<p class="muted">站点：' + esc(info.site || '未知') + (info.duration ? ' · 时长 ' + Math.round(info.duration) + 's' : '') + (info.uploader ? ' · ' + esc(info.uploader) : '') + '</p>' +
      (info.manifest ? '<p class="muted">m3u8：' + esc(String(info.manifest).slice(0, 96)) + '</p>' : '') +
      (info.reason ? '<p class="warn-note">' + esc(info.reason) + '</p>' : '') +
      renderDiag(info) +
    '</div></div>' +
    (rows ? '<div class="video-fmts">' + rows + '</div>' : '') +
    '<div class="run-bar">' +
      '<button class="btn btn-primary" id="videoDownload" ' + (formats.length ? '' : 'disabled') + '>下载选中清晰度</button>' +
      '<button class="btn btn-ghost" id="videoToQueue">加入后台队列</button>' +
      '<span class="run-hint" id="videoDlHint"></span>' +
    '</div>';

  const pick = () => {
    const checked = box.querySelector('input[name="videoFmt"]:checked');
    return formats.find((f) => String(f.id) === (checked ? checked.value : '')) || formats[0];
  };

  const dlBtn = $('#videoDownload', box);
  if (dlBtn) {
    dlBtn.addEventListener('click', async () => {
      const f = pick();
      const dlHint = $('#videoDlHint', box);
      setBusy(dlBtn, true, '下载中…');
      dlHint.textContent = '正在下载，长视频请耐心等待…';
      try {
        const res = await postJson('/api/video/download', {
          url: sourceUrl,
          manifest: info.manifest || '',
          format: f || {},
        });
        const file = res.files && res.files[0];
        if (!file) throw new Error('没有生成文件');
        downloadUrl(file.url, file.name);
        dlHint.textContent = '下载完成：' + file.name + '（' + fmtBytes(file.size) + '）';
        toast('下载完成');
      } catch (e) {
        dlHint.textContent = '';
        toast(e.message, 'error', 8000);
      } finally {
        setBusy(dlBtn, false, '下载选中清晰度');
      }
    });
  }

  const qBtn = $('#videoToQueue', box);
  if (qBtn) {
    qBtn.addEventListener('click', async () => {
      try {
        const deep = $('#videoDeep', $('#view-video')) ? $('#videoDeep', $('#view-video')).checked : true;
        await postJson('/api/video/batch', { urls: [sourceUrl], deep });
        toast('已加入后台队列');
        refreshTasks($('#view-video'));
      } catch (e) { toast(e.message, 'error', 6000); }
    });
  }
}

function renderDiag(info) {
  const steps = (info.diagnose && info.diagnose.steps) || [];
  if (!steps.length) return '';
  const rows = steps.map((s) =>
    '<li class="' + (s.ok ? 'ok' : 'bad') + '"><b>' + esc(s.step) + '</b>' + (s.ok ? ' ✓' : ' ✗') + ' · ' + esc(s.detail || '') + '</li>').join('');
  return '<details class="video-diag"><summary>解析过程（点开看每一步）</summary><ul>' + rows + '</ul></details>';
}

/* ---------------- 批量 ---------------- */
async function addBatch(view) {
  const raw = $('#videoUrls', view).value.trim();
  if (!raw) { toast('请先粘贴链接（一行一条）', 'error'); return; }
  const urls = raw.split(/[\r\n\s]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
  if (!urls.length) { toast('没有识别到有效链接', 'error'); return; }
  const btn = $('#videoBatch', view);
  setBusy(btn, true, '提交中…');
  try {
    const deep = $('#videoDeep', view) ? $('#videoDeep', view).checked : true;
    const res = await postJson('/api/video/batch', { urls, deep });
    toast('已加入 ' + res.count + ' 个下载任务');
    $('#videoUrls', view).value = '';
    refreshTasks(view);
  } catch (e) {
    toast(e.message, 'error', 6000);
  } finally {
    setBusy(btn, false, '加入下载队列');
  }
}

const STATUS_TEXT = { queued: '排队中', resolving: '解析中', downloading: '下载中', done: '已完成', failed: '失败', canceled: '已取消' };

async function refreshTasks(view, silent) {
  try {
    const data = await getJson('/api/video/tasks');
    const box = $('#videoTasks', view || $('#view-video'));
    if (!box) return;
    const stat = data.stat || {};
    const statEl = $('[data-stat]', view || $('#view-video'));
    if (statEl) statEl.textContent = stat.total ? ('共 ' + stat.total + ' · 运行 ' + stat.running + ' · 完成 ' + stat.done + ' · 失败 ' + stat.failed) : '队列空闲';
    if (!data.tasks.length) { box.innerHTML = '<p class="muted">暂无任务</p>'; return; }
    box.innerHTML = data.tasks.map((t) => {
      const pct = Math.max(0, Math.min(100, t.progress || 0));
      const size = t.file && t.file.size ? fmtBytes(t.file.size) : (t.total ? fmtBytes(t.bytes) + ' / ' + fmtBytes(t.total) : (t.bytes ? fmtBytes(t.bytes) : ''));
      const actions = [];
      if (t.status === 'done' && t.file) actions.push('<button class="btn btn-sm btn-ghost" data-act="save" data-id="' + t.id + '">下载</button>');
      if (t.status === 'failed' || t.status === 'canceled') actions.push('<button class="btn btn-sm btn-ghost" data-act="retry" data-id="' + t.id + '">重试</button>');
      if (t.status === 'queued' || t.status === 'resolving' || t.status === 'downloading') actions.push('<button class="btn btn-sm btn-ghost" data-act="cancel" data-id="' + t.id + '">取消</button>');
      actions.push('<button class="btn btn-sm btn-ghost" data-act="remove" data-id="' + t.id + '">删除</button>');
      return '<div class="vt-row">' +
        '<div class="vt-main">' +
          '<div class="vt-title" title="' + esc(t.url) + '">' + esc(t.title || t.url) + '</div>' +
          '<div class="vt-sub">' + esc(t.site || '') + (t.engine ? ' · ' + esc(t.engine) : '') + (size ? ' · ' + size : '') + (t.error ? ' · <span class="warn-note">' + esc(t.error) + '</span>' : '') + '</div>' +
          '<div class="vt-bar"><div class="vt-bar-in ' + esc(t.status) + '" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<div class="vt-status ' + esc(t.status) + '">' + esc(STATUS_TEXT[t.status] || t.status) + (t.status === 'downloading' ? ' ' + pct + '%' : '') + '</div>' +
        '<div class="vt-actions">' + actions.join('') + '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', () => taskAction(view, b.dataset.act, b.dataset.id, data.tasks));
    });
  } catch (e) {
    if (!silent) toast(e.message, 'error', 6000);
  }
}

async function taskAction(view, act, id, tasks) {
  try {
    if (act === 'save') {
      const t = tasks.find((x) => x.id === id);
      if (t && t.file) downloadUrl(t.file.url, t.file.name);
      return;
    }
    if (act === 'retry') await postJson('/api/video/tasks/' + id + '/retry', {});
    if (act === 'cancel') await postJson('/api/video/tasks/' + id + '/cancel', {});
    if (act === 'remove') {
      const res = await fetch('/api/video/tasks/' + id, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new Error('删除失败');
    }
    refreshTasks(view);
  } catch (e) {
    toast(e.message, 'error', 6000);
  }
}

async function clearDone(view) {
  const data = await getJson('/api/video/tasks').catch(() => ({ tasks: [] }));
  const done = (data.tasks || []).filter((t) => t.status === 'done' || t.status === 'failed' || t.status === 'canceled');
  if (!done.length) { toast('没有可清理的任务'); return; }
  for (const t of done) {
    await fetch('/api/video/tasks/' + t.id, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
  }
  toast('已清理 ' + done.length + ' 条');
  refreshTasks(view);
}
