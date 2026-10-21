import { $, esc } from '../core/dom.mjs';
import { getJson } from '../core/api.mjs';
import { toast, setBusy } from '../core/ui.mjs';
import { auth } from '../core/auth.mjs';

const ROLE_NAME = { admin: '管理员', user: '普通用户' };

export async function renderAccounts(app) {
  const view = $('#view-accounts');
  if (!auth.user || auth.user.role !== 'admin') {
    view.innerHTML = '<div class="panel"><div class="recent-empty">仅管理员可访问账户管理。</div></div>';
    return;
  }
  view.innerHTML = `
    <div class="tool-head">
      <a class="back" href="#/">← 返回全部工具</a>
      <div class="tool-title">
        <span class="tool-ico cat-pdf"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 20c0-3.3 2.5-5.4 5.5-5.4s5.5 2.1 5.5 5.4"></path><path d="M16.5 11.5h4M18.5 9.5v4"></path></svg></span>
        <div><h1>账户管理</h1><p>创建普通用户、切换角色、按模块授权。普通用户登录后只能看到并访问被授权的模块，接口层同样拦截。</p></div>
      </div>
    </div>
    <div class="workspace workspace-accounts">
      <div class="panel">
        <div class="panel-title"><h2>新建账户</h2><span class="muted">密码至少 4 位</span></div>
        <form id="newAccount" class="account-form">
          <label class="fld"><span>账号</span><input id="naUser" type="text" placeholder="例如 zhangsan" required></label>
          <label class="fld"><span>初始密码</span><input id="naPass" type="text" placeholder="例如 1234" required></label>
          <label class="fld"><span>角色</span>
            <select id="naRole"><option value="user">普通用户</option><option value="admin">管理员</option></select>
          </label>
          <button class="btn btn-primary" type="submit">创建账户</button>
        </form>
      </div>
      <div class="panel">
        <div class="panel-title"><h2>账户列表</h2><span id="accCount" class="muted"></span></div>
        <div id="accTable" class="acc-wrap"><div class="recent-empty">加载中…</div></div>
      </div>
      <div class="panel">
        <div class="panel-title"><h2>成品文件保留策略</h2><span id="retainUsage" class="muted"></span></div>
        <p class="muted">所有工具产出的成品都放在服务端 <code id="retainDir">outputs</code> 目录（视频解析的 MP4、导出的 PDF/图片等）。默认保留 <b>24 小时</b>，超时由后台每 30 分钟清理一次；设为「永久保存」则不再自动清理。</p>
        <div class="run-bar">
          <label class="fld inline"><span>保留时长</span>
            <select id="retainHours">
              <option value="0">永久保存（不清理）</option>
              <option value="1">1 小时</option>
              <option value="6">6 小时</option>
              <option value="12">12 小时</option>
              <option value="24">24 小时（默认）</option>
              <option value="48">48 小时</option>
              <option value="72">72 小时（3 天）</option>
              <option value="168">168 小时（7 天）</option>
              <option value="custom">自定义…</option>
            </select>
          </label>
          <label class="fld inline" id="retainCustomWrap" hidden><span>小时数</span>
            <input id="retainCustom" type="number" min="0" step="1" value="24" style="width:110px">
          </label>
          <button class="btn btn-primary" id="retainSave">保存并立即清理</button>
          <button class="btn btn-ghost" id="retainSweep">只清理一次</button>
          <span class="run-hint" id="retainHint"></span>
        </div>
      </div>
    </div>`;

  let data = null;
  const table = $('#accTable', view);

  async function load() {
    data = await getJson('/api/accounts');
    $('#accCount', view).textContent = data.users.length + ' 个账户 · ' + data.modules.length + ' 个模块';
    table.innerHTML = '<table class="acc-table"><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>授权模块</th><th>最近登录</th><th>操作</th></tr></thead><tbody>' +
      data.users.map((u) => row(u, data.modules)).join('') + '</tbody></table>';
  }

  function row(u, modules) {
    const isRoot = u.username === 'root';
    const isSelf = u.id === auth.user.id;
    const chips = modules.filter((m) => m.key !== 'accounts').map((m) => {
      const on = u.role === 'admin' || u.modules.includes(m.key);
      const dis = u.role === 'admin' ? ' disabled' : '';
      return '<label class="mod-chip' + (on ? ' on' : '') + (u.role === 'admin' ? ' locked' : '') + '">' +
        '<input type="checkbox" data-mod="' + m.key + '"' + (on ? ' checked' : '') + dis + '>' + esc(m.name) + '</label>';
    }).join('');
    return `<tr data-id="${u.id}">
      <td><b>${esc(u.username)}</b>${isRoot ? ' <span class="tag">内置</span>' : ''}${isSelf ? ' <span class="tag">当前</span>' : ''}<div class="acc-sub">${esc(u.displayName || '')}</div></td>
      <td>
        <select data-role ${isRoot ? 'disabled' : ''}>
          <option value="user"${u.role === 'user' ? ' selected' : ''}>普通用户</option>
          <option value="admin"${u.role === 'admin' ? ' selected' : ''}>管理员</option>
        </select>
      </td>
      <td><button class="btn btn-ghost btn-sm" data-toggle ${isRoot || isSelf ? 'disabled' : ''}>${u.status === 'active' ? '启用中' : '已停用'}</button></td>
      <td><div class="mod-grid">${chips}</div></td>
      <td class="mono">${esc(String(u.lastLoginAt || '—').replace('T', ' ').slice(0, 16))}</td>
      <td class="acc-actions">
        <button class="btn btn-soft btn-sm" data-save>保存</button>
        <button class="btn btn-ghost btn-sm" data-pass>改密码</button>
        <button class="btn btn-ghost btn-sm" data-del ${isRoot || isSelf ? 'disabled' : ''}>删除</button>
      </td>
    </tr>`;
  }

  async function patch(id, body) {
    const res = await fetch('/api/accounts/' + id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '保存失败');
    return json;
  }

  table.addEventListener('click', async (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    const mods = [...tr.querySelectorAll('[data-mod]')].filter((c) => c.checked).map((c) => c.dataset.mod);
    if (ev.target.closest('[data-save]')) {
      const role = tr.querySelector('[data-role]').value;
      try {
        await patch(id, { role, modules: role === 'admin' ? undefined : mods });
        toast('已保存');
        await load();
      } catch (err) { toast(err.message, 'error'); }
    } else if (ev.target.closest('[data-toggle]')) {
      const current = tr.querySelector('[data-toggle]').textContent.includes('启用中') ? 'active' : 'disabled';
      try { await patch(id, { status: current === 'active' ? 'disabled' : 'active' }); await load(); toast('状态已更新'); }
      catch (err) { toast(err.message, 'error'); }
    } else if (ev.target.closest('[data-pass]')) {
      const pw = prompt('输入新的密码（至少 4 位）');
      if (!pw) return;
      try { await patch(id, { password: pw }); toast('密码已重置，该账户需重新登录'); }
      catch (err) { toast(err.message, 'error'); }
    } else if (ev.target.closest('[data-del]')) {
      if (!confirm('确定删除该账户？')) return;
      try {
        const res = await fetch('/api/accounts/' + id, { method: 'DELETE' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || '删除失败');
        toast('已删除');
        await load();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  $('#newAccount', view).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const username = $('#naUser', view).value.trim();
    const password = $('#naPass', view).value;
    const role = $('#naRole', view).value;
    const btn = ev.target.querySelector('button[type=submit]');
    setBusy(btn, true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, role, modules: role === 'admin' ? undefined : ['image', 'pdf', 'doc', 'sheet', 'ocr', 'media', 'net', 'history'] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '创建失败');
      toast('账户已创建');
      ev.target.reset();
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false, '创建账户');
    }
  });

  async function loadRetention() {
    try {
      const s = await getJson('/api/settings');
      const hours = s.retention?.hours ?? 24;
      const sel = $('#retainHours', view);
      const known = ['0', '1', '6', '12', '24', '48', '72', '168'];
      if (known.includes(String(hours))) {
        sel.value = String(hours);
        $('#retainCustomWrap', view).hidden = true;
      } else {
        sel.value = 'custom';
        $('#retainCustom', view).value = String(hours);
        $('#retainCustomWrap', view).hidden = false;
      }
      $('#retainDir', view).textContent = s.outputs?.dir ? s.outputs.dir : 'outputs';
      const used = s.outputs ? (s.outputs.files + ' 个文件 · ' + fmtSize(s.outputs.bytes)) : '';
      const last = s.lastSweep ? ('上次清理 ' + String(s.lastSweep.at).replace('T', ' ').slice(0, 16) + '（删 ' + s.lastSweep.removedFiles + ' 个）') : '尚未清理过';
      $('#retainUsage', view).textContent = used + ' · ' + last;
      $('#retainHint', view).textContent = hours === 0 ? '当前：永久保存' : '当前：保留 ' + hours + ' 小时';
    } catch (e) {
      $('#retainHint', view).textContent = e.message;
    }
  }

  function fmtSize(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB';
    return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function pickHours() {
    const sel = $('#retainHours', view);
    if (sel.value === 'custom') return Number($('#retainCustom', view).value);
    return Number(sel.value);
  }

  $('#retainHours', view).addEventListener('change', () => {
    $('#retainCustomWrap', view).hidden = $('#retainHours', view).value !== 'custom';
  });

  $('#retainSave', view).addEventListener('click', async () => {
    const btn = $('#retainSave', view);
    const hours = pickHours();
    if (!Number.isFinite(hours) || hours < 0) { toast('请填写不小于 0 的小时数', 'error'); return; }
    setBusy(btn, true, '保存中…');
    try {
      const res = await fetch('/api/settings/retention', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hours }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '保存失败');
      toast(json.note || '已保存', 'ok', 5000);
      await loadRetention();
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      setBusy(btn, false, '保存并立即清理');
    }
  });

  $('#retainSweep', view).addEventListener('click', async () => {
    const btn = $('#retainSweep', view);
    setBusy(btn, true, '清理中…');
    try {
      const res = await fetch('/api/settings/retention/sweep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '清理失败');
      toast(json.note || '已清理', 'ok', 5000);
      await loadRetention();
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      setBusy(btn, false, '只清理一次');
    }
  });

  await loadRetention();
  await load();
}
