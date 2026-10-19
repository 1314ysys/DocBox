import { esc, fmtBytes, extOf } from './dom.mjs';
import { addRecent } from './store.mjs';
import { mediaKind, canPlayInBrowser } from './media.mjs';
import { resultPreviewKind, fillResultPreviews } from './preview.mjs';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

export function renderResults(container, data, toolName) {
  if (!data) return;
  const files = data.files || [];
  container.hidden = false;
  const note = data.note ? '<div class="result-note">' + esc(data.note) + '</div>' : '';
  const cards = files.map((f) => {
    const ext = extOf(f.name);
    const isImage = IMAGE_EXT.has(ext);
    const kind = mediaKind(f.name);
    const playable = kind && canPlayInBrowser(f.name);
    const media = playable
      ? (kind === 'video'
        ? '<video class="r-media" src="' + esc(f.url) + '" controls preload="metadata" playsinline></video>'
        : '<audio class="r-audio" src="' + esc(f.url) + '" controls preload="metadata"></audio>')
      : (kind ? '<span class="r-ext">' + esc(ext.replace('.', '').toUpperCase()) + '</span><div class="r-hint">该格式需下载后播放，或先转码为 MP4 / MP3</div>' : '<span class="r-ext">' + esc(ext.replace('.', '').toUpperCase() || 'FILE') + '</span>');
    const pvKind = !isImage && !kind ? resultPreviewKind(f.name) : null;
    const pvSlot = pvKind ? '<div class="r-pv" data-pv-url="' + esc(f.url) + '" data-pv-name="' + esc(f.name) + '"></div>' : '';
    return `<div class="result-item${kind ? ' result-media' : ''}">
      ${isImage ? `<img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy">` : (pvSlot || media)}
      <div class="r-meta"><b title="${esc(f.name)}">${esc(f.name)}</b><span>${fmtBytes(f.size)}</span></div>
      <a class="btn btn-ghost btn-sm" href="${esc(f.url)}" download="${esc(f.name)}">下载</a>
    </div>`;
  }).join('');
  container.innerHTML = note + '<div class="result-grid">' + cards + '</div>';
  fillResultPreviews(container);
  addRecent(files.map((f) => ({ name: f.name, url: f.url, size: f.size })), toolName || '');
}

export function clearResults(container) {
  container.hidden = true;
  container.innerHTML = '';
}
