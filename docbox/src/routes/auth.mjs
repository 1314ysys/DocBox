import express from 'express';
import { ah } from '../lib/async.mjs';
import {
  authEnabled, authModeFor, verifyPassword, hashPassword, startSession, endSession,
  checkLoginThrottle, recordLoginFail, clearLoginFails, publicUser, modulesForUser,
} from '../lib/auth.mjs';
import { findUserByUsername, findUserById, getUserModules, updateUserPassword, deleteUserSessions } from '../lib/db.mjs';

export const authRouter = express.Router();

function denyLogin(res, message) {
  return res.status(401).json({ error: message, code: 'LOGIN_FAILED' });
}

authRouter.post('/api/auth/login', ah(async (req, res) => {
  const mode = authModeFor(req);
  if (mode === 'locked') {
    return res.status(503).json({
      error: '本地数据库不可用，服务已进入安全锁定状态（外部访问一律拒绝），无法登录。请检查 MySQL 后重试。',
      code: 'DB_UNAVAILABLE',
      authMode: 'locked',
    });
  }
  if (mode === 'open') {
    return res.status(503).json({
      error: '本地数据库不可用，当前为本机降级模式（免登录，仅 127.0.0.1 可用）。数据库恢复后自动回到登录模式。',
      code: 'DB_UNAVAILABLE',
      authMode: 'open',
    });
  }
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });
  if (!checkLoginThrottle(req)) return res.status(429).json({ error: '尝试次数过多，请 5 分钟后再试' });

  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFail(req);
    return denyLogin(res, '账号或密码不正确');
  }
  if (user.status !== 'active') return res.status(403).json({ error: '该账户已被停用，请联系管理员' });

  clearLoginFails(req);
  await startSession(req, res, user);
  const modules = modulesForUser(user, await getUserModules(user.id));
  res.json({ ok: true, user: publicUser(user, modules), authEnabled: true });
}));

authRouter.post('/api/auth/logout', ah(async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
}));

authRouter.get('/api/auth/me', ah(async (req, res) => {
  const mode = req.authMode || authModeFor(req);
  const dbAvailable = Boolean(authEnabled());
  if (mode === 'locked') {
    return res.json({ ok: true, authEnabled: true, authMode: 'locked', dbAvailable, user: null, modules: [] });
  }
  if (mode === 'open') {
    return res.json({ ok: true, authEnabled: false, authMode: 'open', dbAvailable, user: null, modules: [] });
  }
  if (!req.user) return res.json({ ok: true, authEnabled: true, authMode: 'strict', dbAvailable, user: null, modules: [] });
  res.json({ ok: true, authEnabled: true, authMode: 'strict', dbAvailable, user: publicUser(req.user, req.userModules) });
}));

authRouter.post('/api/auth/password', ah(async (req, res) => {
  if (!authEnabled()) return res.status(503).json({ error: '本地数据库不可用，暂无法修改密码', code: 'DB_UNAVAILABLE' });
  if (!req.user) return res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' });
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  if (next.length < 4) return res.status(400).json({ error: '新密码至少 4 位' });
  const full = await findUserById(req.user.id);
  if (!full || !verifyPassword(current, full.password_hash)) return res.status(400).json({ error: '当前密码不正确' });
  await updateUserPassword(full.id, hashPassword(next));
  await deleteUserSessions(full.id);
  await endSession(req, res);
  res.json({ ok: true, note: '密码已更新，请重新登录' });
}));
