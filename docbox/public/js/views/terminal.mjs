import { $, esc } from '../core/dom.mjs';
import { toast } from '../core/ui.mjs';

/**
 * SSH / Telnet 网页终端（xterm.js + WebSocket）
 * 后端：POST /api/terminal/connect → { id }，然后 ws://…/ws/terminal?id=
 */
let st = null;

const FONT_SIZE = 13;
const FONT_FAMILY = 'Consolas, "Cascadia Mono", monospace';

function measureChar() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:' + FONT_FAMILY + ';font-size:' + FONT_SIZE + 'px;line-height:1';
  probe.textContent = 'MMMMMMMMMM';
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 10;
  document.body.removeChild(probe);
  return w > 0 ? w : FONT_SIZE * 0.6;
}

export function renderTerminal(app) {
  const sessions = new Map();
  let seq = 0;
  const charW = measureChar();
  const lineH = Math.round(FONT_SIZE * 1.32);

  const listEl = $('#termList');
  const tabsEl = $('#termTabs');
  const bodyEl = $('#termBody');
  const form = $('#termForm');

  st = { sessions, closeAll };

  function updateCount() {
    $('#termCount').textContent = String(sessions.size);
    const empty = listEl.querySelector('.term-empty');
    if (empty) empty.hidden = sessions.size > 0;
  }

  function showForm(show) {
    form.hidden = !show;
    if (show) $('#termHost').focus();
  }

  $('#termNew').onclick = () => showForm(form.hidden);
  $('#termProtocol').onchange = () => {
    const ssh = $('#termProtocol').value === 'ssh';
    $('#termUser').placeholder = ssh ? 'root' : '可留空';
    $('#termPass').placeholder = ssh ? '（SSH 密码）' : '可留空（自动登录）';
  };
  $('#termProtocol').onchange();

  function fit(entry) {
    const rect = entry.inst.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cols = Math.max(20, Math.floor(rect.width / charW));
    const rows = Math.max(6, Math.floor(rect.height / lineH));
    if (entry.cols === cols && entry.rows === rows) return;
    entry.cols = cols;
    entry.rows = rows;
    try { entry.term.resize(cols, rows); } catch { /* 忽略 */ }
    if (entry.ws && entry.ws.readyState === 1) entry.ws.send('\u0000resize:' + cols + ',' + rows);
  }

  function switchTo(sid) {
    for (const [id, entry] of sessions) {
      entry.inst.classList.toggle('active', id === sid);
      entry.tab.classList.toggle('active', id === sid);
      entry.card.classList.toggle('active', id === sid);
    }
    const tip = bodyEl.querySelector('.term-tip');
    if (tip) tip.hidden = true;
    const entry = sessions.get(sid);
    if (entry) {
      requestAnimationFrame(() => {
        fit(entry);
        try { entry.term.focus(); } catch { /* 忽略 */ }
        // xterm 聚焦隐藏 textarea 时浏览器会滚动祖先容器，这里复位
        setTimeout(() => {
          bodyEl.scrollTop = 0;
          const shell = bodyEl.closest('.term-shell');
          if (shell) shell.scrollTop = 0;
          if (shell?.parentElement) shell.parentElement.scrollTop = 0;
        }, 0);
      });
    }
  }

  function cardOf(sid, addr, protocol) {
    const card = document.createElement('div');
    card.className = 'term-card';
    card.innerHTML = '<div class="tc-head"><b>' + esc(protocol.toUpperCase()) + ' ' + esc(addr) + '</b><button type="button" title="断开">×</button></div>' +
      '<div class="tc-meta"><i class="dot connecting"></i><span>连接中…</span></div>';
    card.querySelector('button').onclick = (e) => { e.stopPropagation(); closeSession(sid); };
    card.onclick = () => switchTo(sid);
    listEl.appendChild(card);
    return card;
  }

  function setCardStatus(entry, status, text) {
    const meta = entry.card.querySelector('.tc-meta');
    meta.innerHTML = '<i class="dot ' + status + '"></i><span>' + esc(text) + '</span>';
  }

  function closeSession(sid) {
    const entry = sessions.get(sid);
    if (!entry) return;
    try { entry.ws?.close(1000, '用户关闭'); } catch { /* 忽略 */ }
    try { entry.term.dispose(); } catch { /* 忽略 */ }
    entry.inst.remove();
    entry.tab.remove();
    entry.card.remove();
    sessions.delete(sid);
    updateCount();
    const first = sessions.keys().next().value;
    if (first) switchTo(first);
    else {
      const tip = bodyEl.querySelector('.term-tip');
      if (tip) tip.hidden = false;
    }
  }

  function closeAll() {
    for (const sid of [...sessions.keys()]) closeSession(sid);
  }

  function appendData(entry, text) {
    if (text) entry.term.write(text);
  }

  async function connect() {
    const protocol = $('#termProtocol').value;
    const host = $('#termHost').value.trim();
    const port = $('#termPort').value.trim();
    const username = $('#termUser').value.trim();
    const password = $('#termPass').value;
    if (!host) { toast('请填写主机地址', 'error'); return; }
    if (protocol === 'ssh' && !username) { toast('SSH 需要用户名', 'error'); return; }

    const btn = $('#termConnect');
    btn.disabled = true;
    btn.textContent = '连接中…';
    try {
      const rect = bodyEl.getBoundingClientRect();
      const cols = Math.max(20, Math.floor((rect.width || 800) / charW));
      const rows = Math.max(6, Math.floor((rect.height || 400) / lineH));
      const res = await fetch('/api/terminal/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol, host, port, username, password, cols, rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '连接失败');
      openSession(data, protocol, host, port);
      $('#termPass').value = '';
      showForm(false);
    } catch (err) {
      toast(err.message, 'error', 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = '连接';
    }
  }

  function openSession(data, protocol, host, port) {
    const sid = 's' + (++seq);
    const addr = host + ':' + (port || (protocol === 'telnet' ? 23 : 22));

    const inst = document.createElement('div');
    inst.className = 'term-inst';
    bodyEl.appendChild(inst);
    const term = new window.Terminal({
      cursorBlink: true,
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY,
      scrollback: 5000,
      theme: 'dark',
    });
    term.open(inst);

    const tab = document.createElement('div');
    tab.className = 'term-tab';
    tab.innerHTML = '<span>' + esc(protocol.toUpperCase()) + ' ' + esc(host) + '</span><b class="close" title="关闭">×</b>';
    tabsEl.appendChild(tab);

    const card = cardOf(sid, addr, protocol);
    const entry = { sid, term, inst, tab, card, ws: null, cols: 0, rows: 0, protocol, addr };
    sessions.set(sid, entry);
    updateCount();
    switchTo(sid);
    fit(entry);

    tab.querySelector('.close').onclick = (e) => { e.stopPropagation(); closeSession(sid); };
    tab.onclick = () => switchTo(sid);
    term.on('data', (chunk) => {
      if (entry.ws && entry.ws.readyState === 1) entry.ws.send(new TextEncoder().encode(chunk));
    });

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + data.ws);
    ws.binaryType = 'arraybuffer';
    entry.ws = ws;
    const decoder = new TextDecoder('utf-8', { fatal: false });

    ws.onopen = () => {
      setCardStatus(entry, 'on', '已连接');
      term.writeln('\x1b[32m── ' + protocol.toUpperCase() + ' ' + addr + ' 已连接 ──\x1b[0m');
      fit(entry);
      switchTo(sid);
    };
    ws.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : decoder.decode(event.data, { stream: true });
      appendData(entry, text);
    };
    ws.onerror = () => { term.writeln('\r\n\x1b[31m── 通信错误 ──\x1b[0m'); };
    ws.onclose = (e) => {
      setCardStatus(entry, 'off', '已断开');
      term.writeln('\r\n\x1b[31m── 连接断开：' + esc(e.reason || '远程关闭') + ' ──\x1b[0m');
    };
  }

  form.onsubmit = (e) => { e.preventDefault(); connect(); };
  window.addEventListener('resize', () => sessions.forEach((entry) => fit(entry)));

  // 离开终端页时断开所有会话，避免后台长连接
  const onHash = () => {
    if (!location.hash.startsWith('#/terminal')) {
      closeAll();
      window.removeEventListener('hashchange', onHash);
    }
  };
  window.addEventListener('hashchange', onHash);

  return st;
}
