import { $, esc, fmtBytes, extOf } from './dom.mjs';
import { toast } from './ui.mjs';

/**
 * 文件列表：支持拖入、点击选择、拖拽排序、单条删除。
 * 返回 { files, add, clear, render, setFiles }
 */
export function createFileList(root, { multiple = true, accept = '*/*', onChange = () => {} } = {}) {
  const state = { files: [] };
  root.innerHTML = `
    <div class="dropzone" data-drop>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
      <b>拖入文件，或点击选择</b>
      <span>${multiple ? '支持一次选择多个文件，可拖动排序' : '一次处理一个文件'} · 单文件最大 200MB</span>
      <button type="button" class="btn btn-primary btn-sm">选择文件</button>
      <input type="file" accept="${esc(accept)}" ${multiple ? 'multiple' : ''} hidden>
    </div>
    <div class="file-list" data-list hidden></div>
  `;
  const drop = $('[data-drop]', root);
  const input = $('input[type=file]', root);
  const list = $('[data-list]', root);

  function emit() {
    onChange(state.files);
    render();
  }

  function addFiles(fileList) {
    const incoming = [...fileList];
    if (!incoming.length) return;
    if (!multiple) state.files = incoming.slice(0, 1);
    else state.files = state.files.concat(incoming);
    state.files = state.files.slice(0, 40);
    emit();
  }

  function render() {
    if (!state.files.length) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.hidden = false;
    list.innerHTML = state.files.map((f, idx) => `
      <div class="file-row" draggable="true" data-idx="${idx}">
        <span class="f-drag" title="拖动排序">⠿</span>
        <span class="f-ico">${esc((extOf(f.name).replace('.', '') || 'FILE').slice(0, 4).toUpperCase())}</span>
        <span class="f-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="f-size">${fmtBytes(f.size)}</span>
        <button type="button" class="f-del" title="移除">×</button>
      </div>`).join('');
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-drop]')) input.click();
    const del = e.target.closest('.f-del');
    if (del) {
      const idx = Number(del.closest('.file-row').dataset.idx);
      state.files.splice(idx, 1);
      emit();
    }
  });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) addFiles(files);
  });

  let dragIdx = null;
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.file-row');
    if (!row) return;
    dragIdx = Number(row.dataset.idx);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragend', () => {
    dragIdx = null;
    list.querySelectorAll('.file-row').forEach((r) => r.classList.remove('dragging', 'drag-over'));
  });
  list.addEventListener('dragover', (e) => {
    const row = e.target.closest('.file-row');
    if (!row) return;
    e.preventDefault();
    list.querySelectorAll('.file-row').forEach((r) => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });
  list.addEventListener('drop', (e) => {
    const row = e.target.closest('.file-row');
    if (!row || dragIdx === null) return;
    e.preventDefault();
    const target = Number(row.dataset.idx);
    if (target === dragIdx) return;
    const [moved] = state.files.splice(dragIdx, 1);
    state.files.splice(target, 0, moved);
    emit();
  });

  return {
    get files() { return state.files; },
    add: addFiles,
    clear: () => { state.files = []; emit(); },
    setFiles: (list2) => { state.files = [...list2]; emit(); },
    render,
  };
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
