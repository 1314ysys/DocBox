import express from 'express';
import { ah } from '../lib/async.mjs';
import { openSession, listSessions, closeSession } from '../lib/terminal.mjs';

export const terminalRouter = express.Router();

function pick(body) {
  const b = body || {};
  return {
    protocol: b.protocol === 'telnet' ? 'telnet' : 'ssh',
    host: String(b.hostname || b.host || '').trim(),
    port: Number(b.port) || 0,
    username: String(b.username || ''),
    password: String(b.password || ''),
    cols: Number(b.cols) || 100,
    rows: Number(b.rows) || 30,
  };
}

terminalRouter.post('/api/terminal/connect', ah(async (req, res) => {
  const opts = pick(req.body);
  if (!opts.host) return res.status(400).json({ error: '请填写主机地址' });
  if (opts.protocol === 'ssh' && !opts.username) return res.status(400).json({ error: 'SSH 需要用户名' });
  try {
    const s = await openSession(opts);
    res.json({ ok: true, id: s.id, protocol: s.protocol, addr: s.addr, ws: '/ws/terminal?id=' + s.id });
  } catch (err) {
    res.status(502).json({ error: err.message || '连接失败' });
  }
}));

terminalRouter.get('/api/terminal/sessions', (req, res) => {
  res.json({ ok: true, sessions: listSessions() });
});

terminalRouter.post('/api/terminal/close', (req, res) => {
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ error: '缺少会话 id' });
  res.json({ ok: true, closed: closeSession(id) });
});
