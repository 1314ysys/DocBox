import { esc, fmtBytes, extOf } from './dom.mjs';
import { addRecent } from './store.mjs';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

export function renderResults(container, data, toolName) {
  if (!data) return;
  const files = data.files || [];
  container.hidden = false;
  const note = data.note ? '<div class="result-note">' + esc(data.note) + '</div>' : '';
  const cards = files.map((f) => {
    const ext = extOf(f.name);
    const isImage = IMAGE_EXT.has(ext);
    return `<div class="result-item">
      ${isImage ? `<img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy">` : `<span class="r-ext">${esc(ext.replace('.', '').toUpperCase() || 'FILE')}</span>`}
      <div class="r-meta"><b title="${esc(f.name)}">${esc(f.name)}</b><span>${fmtBytes(f.size)}</span></div>
      <a class="btn btn-ghost btn-sm" href="${esc(f.url)}" download="${esc(f.name)}">下载</a>
    </div>`;
  }).join('');
  container.innerHTML = note + '<div class="result-grid">' + cards + '</div>';
  addRecent(files.map((f) => ({ name: f.name, url: f.url, size: f.size })), toolName || '');
}

export function clearResults(container) {
  container.hidden = true;
  container.innerHTML = '';
}
