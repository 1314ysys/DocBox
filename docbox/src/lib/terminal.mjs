/**
 * SSH / Telnet 网页终端会话管理（移植自 WebTerminalTool V2，Node 实现）
 * - SSH：ssh2（纯 JS，无需 OpenSSH 客户端）
 * - Telnet：net.Socket + 最小 IAC 协商 + 简单登录提示识别
 * - 会话先由 POST /api/terminal/connect 创建，再由 WebSocket /ws/terminal?id= 接管
 */
import net from 'node:net';
import crypto from 'node:crypto';
import { Client as SshClient } from 'ssh2';

export const MAX_SESSIONS = 12;
const UNCLAIMED_TTL = 90 * 1000;
const sessions = new Map();

function newId() {
  return crypto.randomBytes(9).toString('hex');
}

function friendlySshError(err) {
  const msg = String(err?.message || err);
  if (/authentication/i.test(msg)) return new Error('认证失败：用户名或密码错误');
  if (/ECONNREFUSED/.test(msg)) return new Error('连接被拒绝：端口未开放或防火墙拦截');
  if (/ETIMEDOUT|timed out/i.test(msg)) return new Error('连接超时：请检查网络或主机是否可达');
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return new Error('域名解析失败：请检查主机地址');
  return new Error('SSH 连接失败：' + msg);
}

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;

/** 过滤 Telnet 协商字节，并对 WILL/DO 做礼貌拒绝，避免远端刷屏 */
function filterTelnet(buf, reply) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b !== IAC) { out.push(b); continue; }
    const cmd = buf[i + 1];
    if (cmd === undefined) break;
    if (cmd === IAC) { out.push(IAC); i += 1; continue; }
    if (cmd === WILL || cmd === WONT || cmd === DO || cmd === DONT) {
      const opt = buf[i + 2];
      i += 2;
      if (cmd === WILL) reply.push(IAC, DONT, opt);
      if (cmd === DO) reply.push(IAC, WONT, opt);
      continue;
    }
    if (cmd === SB) {
      i += 2;
      while (i < buf.length - 1 && !(buf[i] === IAC && buf[i + 1] === SE)) i++;
      i += 1;
      continue;
    }
    i += 1;
  }
  return Buffer.from(out);
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id, protocol: s.protocol, addr: s.addr, claimed: s.claimed, closed: s.closed, createdAt: s.createdAt,
  }));
}

export async function openSession({ protocol = 'ssh', host, port, username = '', password = '', cols = 100, rows = 30, timeout = 12000 }) {
  if (sessions.size >= MAX_SESSIONS) throw new Error('已达最大连接数（' + MAX_SESSIONS + '），请先关闭部分终端');
  if (!host) throw new Error('请填写主机地址');
  const p = Number(port) || (protocol === 'telnet' ? 23 : 22);

  if (protocol === 'telnet') return openTelnet({ host, port: p, username, password, cols, rows, timeout });

  const conn = new SshClient();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { conn.end(); reject(new Error('连接超时：' + host + ':' + p)); }, timeout);
    conn.once('ready', () => { clearTimeout(timer); resolve(); });
    conn.once('error', (err) => { clearTimeout(timer); reject(friendlySshError(err)); });
    conn.connect({ host, port: p, username, password, readyTimeout: timeout, keepaliveInterval: 15000, keepaliveCountMax: 3 });
  });

  const stream = await new Promise((resolve, reject) => {
    conn.shell({ term: 'xterm-256color', cols, rows }, (err, st) => (err ? reject(new Error('无法打开 shell：' + err.message)) : resolve(st)));
  });

  const session = {
    id: newId(), protocol: 'ssh', addr: host + ':' + p, createdAt: Date.now(), claimed: false, closed: false,
    cols, rows, conn, stream, dataCbs: [], closeCbs: [],
    buffer: Buffer.alloc(0),
    flush() { if (this.buffer.length) { const b = this.buffer; this.buffer = Buffer.alloc(0); this.dataCbs.forEach((cb) => cb(b)); } },
    write(buf) { if (!this.closed) { try { this.stream.write(buf); } catch { this.close(); } } },
    resize(c, r) { this.cols = c; this.rows = r; try { this.stream.setWindow(r, c, 0, 0); } catch { /* 忽略 */ } },
    onData(cb) { this.dataCbs.push(cb); },
    onClose(cb) { this.closeCbs.push(cb); },
    close() {
      if (this.closed) return;
      this.closed = true;
      sessions.delete(this.id);
      try { conn.end(); } catch { /* 忽略 */ }
      this.closeCbs.forEach((cb) => cb());
    },
  };
  stream.on('data', (buf) => {
    if (!session.claimed) session.buffer = Buffer.concat([session.buffer, buf]).slice(-64 * 1024);
    if (session.claimed) session.dataCbs.forEach((cb) => cb(buf));
  });
  stream.on('close', () => session.close());
  conn.on('close', () => session.close());
  sessions.set(session.id, session);
  return session;
}

function openTelnet({ host, port, username, password, cols, rows, timeout }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const state = { authed: !(username || password), stage: 'idle', seen: '' };
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('连接超时：' + host + ':' + port));
    }, timeout);

    socket.once('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const msg = /ECONNREFUSED/.test(String(err)) ? '连接被拒绝：端口未开放或防火墙拦截' : 'Telnet 连接失败：' + err.message;
      reject(new Error(msg));
    });

    socket.once('connect', () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const session = {
        id: newId(), protocol: 'telnet', addr: host + ':' + port, createdAt: Date.now(), claimed: false, closed: false,
        cols, rows, socket, dataCbs: [], closeCbs: [],
        buffer: Buffer.alloc(0),
        flush() { if (this.buffer.length) { const b = this.buffer; this.buffer = Buffer.alloc(0); this.dataCbs.forEach((cb) => cb(b)); } },
        write(buf) { if (!this.closed) { try { this.socket.write(buf); } catch { this.close(); } } },
        resize(c, r) { this.cols = c; this.rows = r; },
        onData(cb) { this.dataCbs.push(cb); },
        onClose(cb) { this.closeCbs.push(cb); },
        close() {
          if (this.closed) return;
          this.closed = true;
          sessions.delete(this.id);
          try { this.socket.destroy(); } catch { /* 忽略 */ }
          this.closeCbs.forEach((cb) => cb());
        },
      };

      socket.on('data', (buf) => {
        const reply = [];
        const clean = filterTelnet(buf, reply);
        if (reply.length) socket.write(Buffer.from(reply));
        if (clean.length) {
          if (!session.claimed) session.buffer = Buffer.concat([session.buffer, clean]).slice(-64 * 1024);
          else session.dataCbs.forEach((cb) => cb(clean));
          // 自动登录：识别 login/username 与 password 提示
          if (!state.authed) {
            state.seen = (state.seen + clean.toString('latin1')).slice(-400);
            const text = state.seen.toLowerCase();
            if (state.stage === 'idle' && /(login|username)[:：]?\s*$/.test(text)) {
              state.stage = 'user'; state.seen = '';
              socket.write(Buffer.from(username + '\n'));
            } else if (state.stage === 'user' && /password[:：]?\s*$/.test(text)) {
              state.stage = 'pass'; state.seen = '';
              socket.write(Buffer.from(password + '\n'));
            } else if (state.stage === 'pass') {
              state.authed = true;
            }
          }
        }
      });
      socket.on('close', () => session.close());
      sessions.set(session.id, session);
      resolve(session);
    });
  });
}

export function claimSession(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('会话不存在或已过期，请重新连接');
  if (s.closed) throw new Error('会话已断开');
  s.claimed = true;
  return s;
}

export function closeSession(id) {
  const s = sessions.get(id);
  if (s) s.close();
  return Boolean(s);
}

export function startSessionReaper() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const s of [...sessions.values()]) {
      if (!s.claimed && now - s.createdAt > UNCLAIMED_TTL) s.close();
    }
  }, 15000);
  timer.unref?.();
  return timer;
}
