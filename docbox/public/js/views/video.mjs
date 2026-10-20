import { $, esc, fmtBytes } from '../core/dom.mjs';
import { postJson, getJson, downloadUrl } from '../core/api.mjs';
import { toast, setBusy } from '../core/ui.mjs';

/**
 * 视频网站解析：贴一个视频页链接 → 解析出各清晰度 → 下载（HLS 用自带下载器，其余交给 yt-dlp）
 */
let st = null;

export function renderVideo() {
  const view = $('#view-video');
  st = { info: null, busy: false };
  view.innerHTML = `
    <div class="tool-head">
      <a class="back" href="#/cat/media">← 返回音视频</a>
      <div class="tool-title">
        <span class="tool-ico cat-media"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg></span>
        <div><h1>视频网站解析</h1><p>粘贴 B 站 / YouTube / 爱奇艺 / 腾讯视频 / 优酷 / 抖音 等页面链接，自动找出 m3u8 与各清晰度直链并下载。只解析公开可访问的地址，不托管任何站点。</p></div>
      </div>
    </div>
    <div class="workspace-video">
      <div class="panel">
        <div class="panel-title"><h2>1. 视频链接</h2><span data-engine></span></div>
        <div class="video-url-row">
          <input class="input" id="videoUrl" placeholder="https://www.bilibili.com/video/BV... 或 https://..../index.m3u8" autocomplete="off">
          <button class="btn btn-primary" id="videoParse">解析</button>
        </div>
        <p class="muted" id="videoHint">支持直链、m3u8 播放列表，以及 yt-dlp 支持的各大视频网站。</p>
        <div class="results" data-results hidden></div>
        <div class="video-result" id="videoResult" hidden></div>
      </div>
    </div>
  `;

  const hint = $('#videoHint', view);
  const resultBox = $('#videoResult', view);

  getJson('/api/video/status').then((data) => {
    const el = $('[data-engine]', view);
    if (el) el.textContent = data.ytdlp?.available ? '引擎：yt-dlp ' + data.ytdlp.version : '引擎：内置 HLS 下载器（未检测到 yt-dlp）';
  }).catch(() => {});

  const parse = async () => {
    const url = $('#videoUrl', view).value.trim();
    if (!url) { toast('请先粘贴视频链接', 'error'); return; }
    const btn = $('#videoParse', view);
    setBusy(btn, true, '解析中…');
    hint.textContent = '正在解析…';
    resultBox.hidden = true;
    try {
      const res = await postJson('/api/video/probe', { url });
      st.info = res.data;
      renderInfo(resultBox, res.data, url, hint);
      resultBox.hidden = false;
      hint.textContent = res.note || '解析完成';
    } catch (e) {
      hint.textContent = '';
      toast(e.message, 'error', 6000);
    } finally {
      setBusy(btn, false, '解析');
    }
  };

  $('#videoParse', view).addEventListener('click', parse);
  $('#videoUrl', view).addEventListener('keydown', (e) => { if (e.key === 'Enter') parse(); });
}

function renderInfo(box, info, sourceUrl, hint) {
  const formats = info.formats || [];
  const thumb = info.thumbnail ? '<img class="video-thumb" src="' + esc(info.thumbnail) + '" referrerpolicy="no-referrer" alt="">' : '';
  const rows = formats.map((f, i) => `
    <label class="video-fmt">
      <input type="radio" name="videoFmt" value="${esc(String(f.id))}" ${i === 0 ? 'checked' : ''}>
      <span class="fmt-name">${esc(f.height ? f.height + 'P' : (f.note || f.ext || '默认'))}</span>
      <span class="fmt-meta">${esc(f.ext || '')} · ${esc(f.note || '')} ${f.filesize ? '· ' + fmtBytes(f.filesize) : ''}</span>
    </label>`).join('');

  box.innerHTML = `
    <div class="video-head">
      ${thumb}
      <div>
        <b>${esc(info.title || '未命名视频')}</b>
        <p class="muted">站点：${esc(info.site || '未知')}${info.duration ? ' · 时长 ' + Math.round(info.duration) + 's' : ''}${info.uploader ? ' · ' + esc(info.uploader) : ''}</p>
        ${info.reason ? '<p class="warn-note">' + esc(info.reason) + '</p>' : ''}
      </div>
    </div>
    ${rows ? '<div class="video-fmts">' + rows + '</div>' : ''}
    <div class="run-bar">
      <button class="btn btn-primary" id="videoDownload" ${formats.length ? '' : 'disabled'}>下载选中清晰度</button>
      <span class="run-hint" id="videoDlHint"></span>
    </div>
  `;

  const btn = $('#videoDownload', box);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const picked = box.querySelector('input[name="videoFmt"]:checked');
    const fmt = formats.find((f) => String(f.id) === (picked ? picked.value : ''));
    const target = fmt?.url || sourceUrl;
    const dlHint = $('#videoDlHint', box);
    setBusy(btn, true, '下载中…');
    dlHint.textContent = '正在下载，较长视频请耐心等待…';
    try {
      const res = await postJson('/api/video/download', {
        url: target,
        format: fmt?.id && /^\d/.test(String(fmt.id)) ? fmt.id : '',
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
      setBusy(btn, false, '下载选中清晰度');
    }
  });
}
