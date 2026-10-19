import { login } from '../core/auth.mjs';
import { esc } from '../core/dom.mjs';

export function renderLogin(onSuccess, note = '') {
  const el = document.getElementById('loginScreen');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-brand"><div class="brand-mark">DB</div><div><strong>文档百宝箱</strong><span>DocBox · 本地文档与图像工作台</span></div></div>
        <h1>登录到工作台</h1>
        <p class="login-sub">账户与权限保存在本机 MySQL，不上传任何服务器。</p>
        ${note ? '<div class="login-note">' + esc(note) + '</div>' : ''}
        <form id="loginForm" autocomplete="on">
          <label class="fld"><span>账号</span><input id="loginUser" name="username" type="text" value="root" autocomplete="username" required></label>
          <label class="fld"><span>密码</span><input id="loginPass" name="password" type="password" autocomplete="current-password" required></label>
          <div class="login-error" id="loginError" hidden></div>
          <button class="btn btn-primary full" id="loginBtn" type="submit">登录</button>
        </form>
        <div class="login-hint">
          <span>初始管理员 <b>root / root</b></span>
          <span>登录后可在「账户管理」中创建普通用户并限制模块</span>
        </div>
      </div>
      <div class="login-foot">DocBox · 单进程本地服务 · 127.0.0.1:3000</div>
    </div>`;

  const form = el.querySelector('#loginForm');
  const errBox = el.querySelector('#loginError');
  const btn = el.querySelector('#loginBtn');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const username = el.querySelector('#loginUser').value.trim();
    const password = el.querySelector('#loginPass').value;
    errBox.hidden = true;
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      await login(username, password);
      el.hidden = true;
      el.innerHTML = '';
      await onSuccess();
    } catch (err) {
      errBox.textContent = err.message || '登录失败';
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = '登录';
      el.querySelector('#loginPass').focus();
    }
  });
  setTimeout(() => el.querySelector('#loginPass')?.focus(), 60);
}

export function hideLogin() {
  const el = document.getElementById('loginScreen');
  if (el) { el.hidden = true; el.innerHTML = ''; }
}
