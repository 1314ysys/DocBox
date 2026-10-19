import express from 'express';
import { ah } from '../lib/async.mjs';
import { requireAdmin, requireAuth, hashPassword, MODULES, USER_MODULE_KEYS, ALL_MODULE_KEYS } from '../lib/auth.mjs';
import {
  listUsers, createUser, findUserByUsername, findUserById, updateUser, updateUserPassword,
  deleteUser, setUserModules, countAdmins, deleteUserSessions,
} from '../lib/db.mjs';

export const accountsRouter = express.Router();

accountsRouter.use('/api/accounts', requireAuth, requireAdmin);

accountsRouter.get('/api/accounts', ah(async (_req, res) => {
  res.json({ ok: true, users: await listUsers(), modules: MODULES, userModules: USER_MODULE_KEYS });
}));

accountsRouter.post('/api/accounts', ah(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) return res.status(400).json({ error: '账号需为 2-32 位字母、数字、下划线、点或短横线' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  if (await findUserByUsername(username)) return res.status(409).json({ error: '该账号已存在' });
  const modules = role === 'admin'
    ? ALL_MODULE_KEYS
    : (Array.isArray(req.body?.modules) ? req.body.modules : USER_MODULE_KEYS);
  const id = await createUser({ username, passwordHash: hashPassword(password), role, displayName: req.body?.displayName || null });
  await setUserModules(id, modules);
  res.json({ ok: true, id });
}));

accountsRouter.patch('/api/accounts/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const user = await findUserById(id);
  if (!user) return res.status(404).json({ error: '账户不存在' });

  const body = req.body || {};
  if (user.username === 'root' && body.role === 'user') return res.status(400).json({ error: '内置 root 账户必须保持管理员角色' });
  if (body.role && body.role !== user.role && user.role === 'admin' && body.role === 'user') {
    if ((await countAdmins()) <= 1) return res.status(400).json({ error: '至少需要保留一名启用的管理员' });
  }
  if (body.status === 'disabled' && user.id === req.user.id) return res.status(400).json({ error: '不能停用自己的账户' });
  if (body.status === 'disabled' && user.username === 'root') return res.status(400).json({ error: '内置 root 账户不能停用' });
  if (body.status === 'disabled' && user.role === 'admin' && (await countAdmins()) <= 1) {
    return res.status(400).json({ error: '至少需要保留一名启用的管理员' });
  }

  await updateUser(id, { role: body.role, status: body.status, displayName: body.displayName });
  if (body.password) {
    const pw = String(body.password);
    if (pw.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
    await updateUserPassword(id, hashPassword(pw));
    await deleteUserSessions(id);
  }
  if (Array.isArray(body.modules) && user.role !== 'admin') {
    await setUserModules(id, body.modules.filter((m) => USER_MODULE_KEYS.includes(m)));
  }
  res.json({ ok: true });
}));

accountsRouter.delete('/api/accounts/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  const user = await findUserById(id);
  if (!user) return res.status(404).json({ error: '账户不存在' });
  if (user.username === 'root') return res.status(400).json({ error: '内置 root 账户不能删除' });
  if (user.id === req.user.id) return res.status(400).json({ error: '不能删除当前登录的账户' });
  if (user.role === 'admin' && (await countAdmins()) <= 1) return res.status(400).json({ error: '至少需要保留一名启用的管理员' });
  await deleteUser(id);
  res.json({ ok: true });
}));
