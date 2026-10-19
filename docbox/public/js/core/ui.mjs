let toastTimer = null;

export function toast(message, type = '', duration = 3200) {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.append(box);
  }
  box.textContent = message;
  box.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = 'toast'; }, duration);
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> ' + (label || '处理中…');
  } else {
    button.disabled = false;
    button.textContent = label || button.dataset.label || '开始处理';
  }
}

export function openModal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = html;
  document.body.append(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  return { back, close };
}
