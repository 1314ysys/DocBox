/**
 * 账户与权限（v0.1.2）
 * - 密码：scrypt(N=16384, r=8, p=1) + 16 字节随机盐，存储格式 scrypt$N$r$p$salt$hash
 * - 会话：随机 24 字节 sid，HttpOnly Cookie，7 天有效，落库 sessions 表
 * - 角色：admin（全部模块 + 账户管理）/ user（仅授权模块）
 * - 数据库不可用时进入“免登录模式”，所有接口放行，避免本地工具被自身故障锁死
 */
import crypto from 'node:crypto';
import { dbState, getSessionUser, createSession, deleteSession, touchLogin, getUserModules } from './db.mjs';

export const SESSION_COOKIE = 'docbox_sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const MODULES = [
  { key: 'image', name: '图片工具', desc: '压缩 · 转换 · 尺寸 · 水印 · 证件照' },
  { key: 'pdf', name: 'PDF 工具', desc: '合并拆分 · 页面 · 加密 · 套件 23 项' },
  { key: 'doc', name: '文档转换', desc: 'Word / Markdown / HTML → PDF' },
  { key: 'sheet', name: '表格处理', desc: 'Excel / CSV / JSON 互转' },
  { key: 'ocr', name: '文字识别', desc: '离线中文 OCR' },
  { key: 'media', name: '音视频工具', desc: '转码 · 剪辑 · 合并 · GIF' },
  { key: 'net', name: '网络安全', desc: '连通性 · 端口 · 证书 · 审计' },
  { key: 'history', name: '处理历史', desc: '任务记录与安全报告' },
  { key: 'accounts', name: '账户管理', desc: '仅管理员可见' },
];

export const USER_MODULE_KEYS = MODULES.filter((m) => m.key !== 'accounts').map((m) => m.key);
export const ALL_MODULE_KEYS = MODULES.map((m) => m.key);

export function authEnabled() {
  return dbState().available;
}

/* ---------------- 密码 ---------------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384; const r = 8; const p = 1;
  const hash = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 }).toString('hex');
  return 'scrypt$' + N + '$' + r + '$' + p + '$' + salt + '$' + hash;
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
    const [, N, r, p, salt, hash] = parts;
    const calc = crypto.scryptSync(String(password), salt, 64, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    const expected = Buffer.from(hash, 'hex');
    return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
  } catch {
    return false;
  }
}

/* ---------------- Cookie ---------------- */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(idx + 1).trim()); } catch { out[k] = part.slice(idx + 1).trim(); }
  }
  return out;
}

function cookieHeader(sid, maxAgeSec) {
  return SESSION_COOKIE + '=' + sid + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeSec;
}

/* ---------------- 模块解析 ---------------- */
const PATH_RULES = [
  [/^\/api\/image\//, 'image'],
  [/^\/api\/idphoto\//, 'image'],
  [/^\/api\/watermark\//, 'image'],
  [/^\/api\/pdf\//, 'pdf'],
  [/^\/api\/suite\/pdf\//, 'pdf'],
  [/^\/api\/suite\/media\//, 'media'],
  [/^\/api\/suite\/net\//, 'net'],
  [/^\/api\/net\//, 'net'],
  [/^\/api\/doc\//, 'doc'],
  [/^\/api\/sheet\//, 'sheet'],
  [/^\/api\/ocr\//, 'ocr'],
  [/^\/api\/history/, 'history'],
  [/^\/api\/templates/, 'history'],
  [/^\/api\/settings/, 'history'],
  [/^\/api\/accounts/, 'accounts'],
];

export function moduleForPath(pathname) {
  for (const [re, mod] of PATH_RULES) if (re.test(pathname)) return mod;
  return null;
}

export function modulesForUser(user, list) {
  if (!user) return [];
  if (user.role === 'admin') return ALL_MODULE_KEYS;
  const allowed = new Set(list || []);
  return USER_MODULE_KEYS.filter((m) => allowed.has(m));
}

export function publicUser(user, modules) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName || '',
    modules,
  };
}

/* ---------------- 中间件 ---------------- */
export async function attachUser(req, _res, next) {
  if (!authEnabled()) { req.user = null; req.userModules = ALL_MODULE_KEYS; req.authMode = 'open'; return next(); }
  try {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sid) {
      const user = await getSessionUser(sid);
      if (user) {
        req.user = user;
        req.userModules = modulesForUser(user, await getUserModules(user.id));
        req.sid = sid;
      }
    }
  } catch { /* 忽略：视为未登录 */ }
  req.authMode = 'strict';
  next();
}

export function requireAuth(req, res, next) {
  if (!authEnabled() || req.user) return next();
  return res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' });
}

export function requireAdmin(req, res, next) {
  if (!authEnabled()) return next();
  if (!req.user) return res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可访问', code: 'FORBIDDEN' });
  return next();
}

export function requireModule(req, res, next) {
  if (!authEnabled() || !req.user) return next();
  const mod = moduleForPath(req.path);
  if (!mod) return next();
  if (req.user.role === 'admin') return next();
  if ((req.userModules || []).includes(mod)) return next();
  return res.status(403).json({ error: '当前账户没有该模块的访问权限', code: 'MODULE_FORBIDDEN', module: mod });
}

/* ---------------- 登录 / 登出 ---------------- */
const attempts = new Map();
function throttleKey(req) {
  return (req.ip || req.socket?.remoteAddress || 'local') + ':' + String(req.body?.username || '');
}
export function checkLoginThrottle(req) {
  const key = throttleKey(req);
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, since: now };
  if (now - rec.since > 5 * 60 * 1000) { attempts.delete(key); return true; }
  return rec.count < 8;
}
export function recordLoginFail(req) {
  const key = throttleKey(req);
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, since: now };
  if (now - rec.since > 5 * 60 * 1000) { rec.count = 0; rec.since = now; }
  rec.count += 1;
  attempts.set(key, rec);
}
export function clearLoginFails(req) {
  attempts.delete(throttleKey(req));
}

export async function startSession(req, res, user) {
  const sid = crypto.randomBytes(24).toString('hex');
  await createSession({
    sid,
    userId: user.id,
    ip: req.ip || req.socket?.remoteAddress || '',
    ua: req.headers['user-agent'] || '',
    ttlMs: SESSION_TTL_MS,
  });
  await touchLogin(user.id);
  res.setHeader('Set-Cookie', cookieHeader(sid, Math.floor(SESSION_TTL_MS / 1000)));
  return sid;
}

export async function endSession(req, res) {
  const sid = req.sid || parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sid) await deleteSession(sid).catch(() => {});
  res.setHeader('Set-Cookie', cookieHeader('', 0));
  return true;
}
