export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return num + ' B';
  if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
  if (num < 1024 * 1024 * 1024) return (num / 1024 / 1024).toFixed(1) + ' MB';
  return (num / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function extOf(name) {
  const m = /\.([^.]+)$/.exec(String(name || ''));
  return m ? '.' + m[1].toLowerCase() : '';
}

export function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const ICONS = {
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  compress: '<path d="M9 3v4H5m10-4v4h4M9 21v-4H5m10 4v-4h4"/><path d="M9 9h6v6H9z"/>',
  convert: '<path d="M4 8h12l-3-3m3 3-3 3"/><path d="M20 16H8l3 3m-3-3 3-3"/>',
  resize: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 15V9h6"/>',
  watermark: '<path d="M12 3v18M3 12h18" opacity=".35"/><rect x="4" y="13" width="10" height="7" rx="1.5"/><path d="M6.5 17h5"/>',
  imagePdf: '<rect x="3" y="4" width="12" height="12" rx="2"/><path d="M7 20h12a1 1 0 0 0 1-1V8"/><path d="m5 13 3-3 4 4"/>',
  wand: '<path d="m4 20 10-10M14 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/><path d="m18 14 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  portrait: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="2.6"/><path d="M8 17c.7-2 2.2-3 4-3s3.3 1 4 3"/>',
  merge: '<path d="M7 3v6a4 4 0 0 0 4 4h2a4 4 0 0 1 4 4v4"/><path d="M3 6h4M17 3h4v4"/>',
  split: '<path d="M12 3v18"/><path d="M7 8H3m18 0h-4M7 16H3m18 0h-4"/>',
  pages: '<rect x="3" y="4" width="8" height="10" rx="1"/><rect x="13" y="10" width="8" height="10" rx="1"/>',
  rotate: '<path d="M4 12a8 8 0 1 1 2.3 5.7"/><path d="M4 20v-5h5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14"/>',
  crop: '<path d="M6 3v13a2 2 0 0 0 2 2h13"/><path d="M3 6h13a2 2 0 0 1 2 2v13"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m21 15-4.5-4.5L7 20"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  tag: '<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z"/><circle cx="8" cy="8" r="1.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  markdown: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 15V9l2.5 3L12 9v6M16 9v6m0 0 2-2m-2 2-2-2"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M4 12h16"/>',
  stirling: '<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
  paint: '<path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 1.2-2-.7-1 0-2 1.3-2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16" cy="10" r="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  terminal: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="m6 9 3 3-3 3"/><path d="M13 15h5"/>',
  drag: '<path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/>',
};

export function iconSvg(name = 'doc') {
  const body = ICONS[name] || ICONS.doc;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}
