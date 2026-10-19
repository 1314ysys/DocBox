import { esc, fmtBytes, extOf } from './dom.mjs';

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv', '.avi', '.flv', '.wmv', '.ts']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma', '.amr']);

export function mediaKind(name) {
  const ext = extOf(name);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

export function canPlayInBrowser(name) {
  const ext = extOf(name);
  return ['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'].includes(ext);
}

/** 在容器内渲染播放器；返回销毁函数（释放 ObjectURL）。 */
export function mountPlayer(container, src, name, opts = {}) {
  const kind = mediaKind(name) || (opts.kind || 'video');
  container.hidden = false;
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'mp-wrap';
  const ext = extOf(name).replace('.', '').toUpperCase() || 'MEDIA';
  wrap.innerHTML = '<div class="mp-head"><span class="mp-badge">' + esc(kind === 'video' ? 'VIDEO' : 'AUDIO') + '</span>' +
    '<b title="' + esc(name) + '">' + esc(name) + '</b>' +
    '<span class="mp-info" data-info>' + ext + (opts.size ? ' · ' + fmtBytes(opts.size) : '') + '</span></div>';

  if (!canPlayInBrowser(name)) {
    wrap.innerHTML += '<div class="mp-fallback">当前浏览器不能直接播放 ' + esc(ext) + ' 格式，可先用「视频转码」/「音频转码」转成 MP4 / MP3 再预览，或直接下载查看。</div>';
    wrap.innerHTML += '<div class="mp-actions"><a class="btn btn-ghost btn-sm" href="' + esc(src) + '" download="' + esc(name) + '">下载文件</a></div>';
    container.appendChild(wrap);
    return () => { container.innerHTML = ''; container.hidden = true; };
  }

  const video = document.createElement('video');
  video.controls = true;
  video.preload = 'metadata';
  video.playsInline = true;
  if (kind === 'audio') {
    video.style.display = 'none';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = src;
    audio.addEventListener('loadedmetadata', () => announce(audio.duration));
    wrap.appendChild(audio);
  } else {
    video.src = src;
    video.addEventListener('loadedmetadata', () => announce(video.duration, video.videoWidth, video.videoHeight));
    wrap.appendChild(video);
  }
  const info = wrap.querySelector('[data-info]');
  function announce(duration, w, h) {
    const parts = [ext];
    if (opts.size) parts.push(fmtBytes(opts.size));
    if (Number.isFinite(duration) && duration > 0) parts.push(fmtTime(duration));
    if (w && h) parts.push(w + '×' + h);
    info.textContent = parts.join(' · ');
  }
  container.appendChild(wrap);
  return () => {
    container.querySelectorAll('video,audio').forEach((el) => { el.pause(); el.removeAttribute('src'); el.load(); });
    container.innerHTML = '';
    container.hidden = true;
  };
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

/** 选中本地文件时预览（自动管理 ObjectURL）。 */
export function createFilePreview(container) {
  let revoke = null;
  let dispose = null;
  return {
    show(files) {
      const file = (files || []).find((f) => mediaKind(f.name));
      if (dispose) { dispose(); dispose = null; }
      if (revoke) { URL.revokeObjectURL(revoke); revoke = null; }
      if (!file) { container.hidden = true; container.innerHTML = ''; return; }
      revoke = URL.createObjectURL(file);
      dispose = mountPlayer(container, revoke, file.name, { size: file.size });
    },
    clear() {
      if (dispose) { dispose(); dispose = null; }
      if (revoke) { URL.revokeObjectURL(revoke); revoke = null; }
    },
  };
}
