// 客户端登录态（与 /api/auth/me 同步）
export const auth = {
  enabled: false,
  mode: 'strict',       // strict | open（本机降级）| locked（安全锁定）
  dbAvailable: true,
  user: null,
  modules: [],
};

export function isAdmin() {
  return auth.user?.role === 'admin';
}

export function can(mod) {
  if (!auth.enabled) return true;
  if (!auth.user) return false;
  if (isAdmin()) return true;
  return auth.modules.includes(mod);
}

export function applyMe(me) {
  auth.enabled = Boolean(me.authEnabled);
  auth.mode = me.authMode || 'strict';
  auth.dbAvailable = me.dbAvailable !== false;
  auth.user = me.user || null;
  auth.modules = me.user?.modules || [];
  return auth;
}

export async function fetchMe() {
  const res = await fetch('/api/auth/me', { headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  return applyMe(data);
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || '登录失败');
  applyMe({ authEnabled: true, user: data.user });
  return auth.user;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  auth.user = null;
  auth.modules = [];
}
