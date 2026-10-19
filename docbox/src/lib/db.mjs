/**
 * DocBox 本地数据库（MySQL）：连接、建库建表、任务记录、模板与报告存储。
 * 设计原则：数据库是“增强项”，不可用时所有功能仍能跑，只是历史记录为空。
 */
import mysql from 'mysql2/promise';
import { DB } from '../config.mjs';

const state = {
  available: false,
  error: null,
  version: null,
  password: null,
  pool: null,
  checkedAt: null,
};

const CANDIDATE_PASSWORDS = [DB.password, '', 'root', '123456', 'mysql', 'password'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    suite VARCHAR(24) NOT NULL,
    tool VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ok',
    duration_ms INT UNSIGNED NULL,
    input_summary VARCHAR(512) NULL,
    output_summary VARCHAR(512) NULL,
    note VARCHAR(512) NULL,
    error VARCHAR(512) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_jobs_created (created_at),
    KEY idx_jobs_tool (tool),
    KEY idx_jobs_suite (suite)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS templates (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    template_id VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    spec JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_template (template_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS net_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tool VARCHAR(64) NOT NULL,
    target VARCHAR(255) NOT NULL,
    summary JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_reports_tool (tool),
    KEY idx_reports_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    display_name VARCHAR(64) NULL,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS user_modules (
    user_id INT UNSIGNED NOT NULL,
    module VARCHAR(32) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, module),
    KEY idx_um_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS stt_jobs (
    id CHAR(16) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
    language VARCHAR(8) NOT NULL DEFAULT 'zh',
    mode VARCHAR(16) NOT NULL DEFAULT 'offline',
    duration_ms INT UNSIGNED NULL,
    text LONGTEXT NULL,
    segments LONGTEXT NULL,
    file_path VARCHAR(512) NULL,
    error VARCHAR(512) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_stt_status (status),
    KEY idx_stt_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    sid CHAR(48) NOT NULL PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    ip VARCHAR(64) NULL,
    ua VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    KEY idx_sessions_expire (expires_at),
    KEY idx_sessions_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(64) NOT NULL PRIMARY KEY,
    v TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
];

async function connectWith(password, withDatabase) {
  const pool = mysql.createPool({
    host: DB.host,
    port: DB.port,
    user: DB.user,
    password,
    database: withDatabase ? DB.database : undefined,
    connectionLimit: DB.connectionLimit,
    waitForConnections: true,
    charset: 'utf8mb4',
    connectTimeout: 8000,
    multipleStatements: false,
    dateStrings: true,
  });
  const conn = await pool.getConnection();
  const [rows] = await conn.query('SELECT VERSION() AS v, CURRENT_USER() AS u');
  conn.release();
  return { pool, version: rows[0].v, user: rows[0].u };
}

export async function initDb() {
  state.checkedAt = new Date().toISOString();
  let lastErr = null;
  const tried = [...new Set(CANDIDATE_PASSWORDS)];
  for (const password of tried) {
    try {
      let handle;
      try {
        handle = await connectWith(password, true);
      } catch (err) {
        if (err.code !== 'ER_BAD_DB_ERROR') { lastErr = err; continue; }
        const boot = await connectWith(password, false);
        await boot.pool.query(`CREATE DATABASE IF NOT EXISTS \`${DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
        await boot.pool.end();
        handle = await connectWith(password, true);
      }
      for (const sql of SCHEMA) await handle.pool.query(sql);
      await handle.pool.query(
        "INSERT INTO settings (k, v) VALUES ('schema_version', '1'), ('installed_at', ?) ON DUPLICATE KEY UPDATE v = v",
        [new Date().toISOString()],
      );
      await seedAdmin(handle.pool);
      state.pool = handle.pool;
      state.available = true;
      state.error = null;
      state.version = handle.version;
      state.password = password;
      return { ok: true, version: handle.version, user: handle.user, passwordChanged: password !== DB.password ? password : null };
    } catch (err) {
      lastErr = err;
    }
  }
  state.available = false;
  state.error = lastErr ? (lastErr.code || lastErr.message) : 'unknown';
  return { ok: false, error: state.error };
}

export function dbState() {
  return {
    available: state.available,
    version: state.version,
    error: state.error,
    database: DB.database,
    host: DB.host,
    port: DB.port,
    user: DB.user,
    checkedAt: state.checkedAt,
  };
}

async function query(sql, params = []) {
  if (!state.available || !state.pool) throw new Error('数据库不可用');
  const [rows] = await state.pool.query(sql, params);
  return rows;
}

export async function recordJob(job) {
  try {
    await query(
      `INSERT INTO jobs (suite, tool, status, duration_ms, input_summary, output_summary, note, error)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        String(job.suite || 'misc').slice(0, 24),
        String(job.tool || 'unknown').slice(0, 64),
        String(job.status || 'ok').slice(0, 16),
        job.durationMs ? Math.round(job.durationMs) : null,
        job.input ? String(job.input).slice(0, 512) : null,
        job.output ? String(job.output).slice(0, 512) : null,
        job.note ? String(job.note).slice(0, 512) : null,
        job.error ? String(job.error).slice(0, 512) : null,
      ],
    );
    return true;
  } catch {
    return false;
  }
}

export async function listJobs({ limit = 50, suite = null, q = null } = {}) {
  const where = [];
  const params = [];
  if (suite) { where.push('suite = ?'); params.push(suite); }
  if (q) { where.push('(tool LIKE ? OR note LIKE ? OR input_summary LIKE ?)'); const like = '%' + q + '%'; params.push(like, like, like); }
  params.push(Math.min(Number(limit) || 50, 300));
  const rows = await query(
    `SELECT id, suite, tool, status, duration_ms AS durationMs, input_summary AS input, output_summary AS output,
            note, error, created_at AS createdAt
     FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`,
    params,
  );
  return rows;
}

export async function jobStats() {
  const rows = await query(
    `SELECT suite, COUNT(*) AS total,
            SUM(status = 'ok') AS ok,
            SUM(status <> 'ok') AS failed,
            ROUND(AVG(duration_ms)) AS avgMs,
            MAX(created_at) AS lastAt
     FROM jobs GROUP BY suite`,
  );
  const [total] = await query('SELECT COUNT(*) AS total FROM jobs');
  return { total: total?.total || 0, bySuite: rows };
}

export async function clearJobs() {
  await query('TRUNCATE TABLE jobs');
  return true;
}

export async function saveTemplate({ templateId, name, spec }) {
  await query(
    `INSERT INTO templates (template_id, name, spec) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), spec = VALUES(spec)`,
    [templateId, name, JSON.stringify(spec)],
  );
  return true;
}

export async function listTemplates() {
  const rows = await query('SELECT template_id AS templateId, name, spec, updated_at AS updatedAt FROM templates ORDER BY updated_at DESC');
  return rows.map((r) => ({ ...r, spec: typeof r.spec === 'string' ? JSON.parse(r.spec) : r.spec }));
}

export async function deleteTemplate(templateId) {
  await query('DELETE FROM templates WHERE template_id = ?', [templateId]);
  return true;
}

export async function saveNetReport({ tool, target, summary }) {
  await query('INSERT INTO net_reports (tool, target, summary) VALUES (?,?,?)', [tool, String(target).slice(0, 255), JSON.stringify(summary)]);
  return true;
}

export async function listNetReports(limit = 30) {
  const rows = await query(
    'SELECT id, tool, target, summary, created_at AS createdAt FROM net_reports ORDER BY id DESC LIMIT ?',
    [Math.min(Number(limit) || 30, 200)],
  );
  return rows.map((r) => ({ ...r, summary: typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary }));
}

export async function getSetting(k) {
  const rows = await query('SELECT v FROM settings WHERE k = ?', [k]);
  return rows[0]?.v ?? null;
}

export async function setSetting(k, v) {
  await query('INSERT INTO settings (k, v) VALUES (?,?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, String(v)]);
  return true;
}

export async function closeDb() {
  if (state.pool) await state.pool.end().catch(() => {});
  state.pool = null;
  state.available = false;
}


/* ------------------------------------------------------------------ *
 * 账户、角色与会话（v0.1.2）
 * ------------------------------------------------------------------ */

async function seedAdmin(pool) {
  const [rows] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  if (rows[0]?.n > 0) return;
  const hash = await hashPasswordLazy('root');
  await pool.query(
    "INSERT INTO users (username, password_hash, role, status, display_name) VALUES ('root', ?, 'admin', 'active', '超级管理员') ON DUPLICATE KEY UPDATE role = 'admin'",
    [hash],
  );
  const [admin] = await pool.query("SELECT id FROM users WHERE username = 'root'");
  if (admin[0]) {
    for (const m of ['image', 'pdf', 'doc', 'sheet', 'ocr', 'media', 'net', 'history']) {
      await pool.query('INSERT IGNORE INTO user_modules (user_id, module) VALUES (?, ?)', [admin[0].id, m]);
    }
  }
}

// 延迟导入，避免 db.mjs 与 auth.mjs 循环依赖
let _hashPassword = null;
async function hashPasswordLazy(pw) {
  if (!_hashPassword) {
    const mod = await import('./auth.mjs');
    _hashPassword = mod.hashPassword;
  }
  return _hashPassword(pw);
}

export async function findUserByUsername(username) {
  const rows = await query('SELECT * FROM users WHERE username = ? LIMIT 1', [String(username || '').slice(0, 64)]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

export async function createUser({ username, passwordHash, role = 'user', displayName = null }) {
  const [res] = await state.pool.query(
    'INSERT INTO users (username, password_hash, role, display_name) VALUES (?,?,?,?)',
    [String(username).slice(0, 64), passwordHash, role === 'admin' ? 'admin' : 'user', displayName],
  );
  return res.insertId;
}

export async function listUsers() {
  const users = await query(
    'SELECT id, username, role, status, display_name AS displayName, last_login_at AS lastLoginAt, created_at AS createdAt FROM users ORDER BY (role = \'admin\') DESC, id ASC',
  );
  const mods = await query('SELECT user_id AS userId, module FROM user_modules');
  const map = new Map();
  for (const m of mods) {
    if (!map.has(m.userId)) map.set(m.userId, []);
    map.get(m.userId).push(m.module);
  }
  return users.map((u) => ({ ...u, modules: map.get(u.id) || [] }));
}

export async function updateUser(id, { role, status, displayName }) {
  const sets = [];
  const params = [];
  if (role) { sets.push('role = ?'); params.push(role === 'admin' ? 'admin' : 'user'); }
  if (status) { sets.push('status = ?'); params.push(status === 'disabled' ? 'disabled' : 'active'); }
  if (displayName !== undefined) { sets.push('display_name = ?'); params.push(displayName === null ? null : String(displayName).slice(0, 64)); }
  if (!sets.length) return false;
  params.push(id);
  await query('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?', params);
  return true;
}

export async function updateUserPassword(id, passwordHash) {
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  return true;
}

export async function deleteUser(id) {
  await query('DELETE FROM user_modules WHERE user_id = ?', [id]);
  await query('DELETE FROM sessions WHERE user_id = ?', [id]);
  await query('DELETE FROM users WHERE id = ?', [id]);
  return true;
}

export async function setUserModules(userId, modules) {
  const list = [...new Set((modules || []).map((m) => String(m).slice(0, 32)))];
  await query('DELETE FROM user_modules WHERE user_id = ?', [userId]);
  for (const m of list) await query('INSERT IGNORE INTO user_modules (user_id, module) VALUES (?, ?)', [userId, m]);
  return list;
}

export async function getUserModules(userId) {
  const rows = await query('SELECT module FROM user_modules WHERE user_id = ?', [userId]);
  return rows.map((r) => r.module);
}

export async function countAdmins() {
  const rows = await query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'");
  return rows[0]?.n || 0;
}

export async function createSession({ sid, userId, ip, ua, ttlMs }) {
  const expires = new Date(Date.now() + ttlMs);
  await query('INSERT INTO sessions (sid, user_id, ip, ua, expires_at) VALUES (?,?,?,?,?)', [
    sid, userId, ip ? String(ip).slice(0, 64) : null, ua ? String(ua).slice(0, 255) : null, expires,
  ]);
  return true;
}

export async function getSessionUser(sid) {
  const rows = await query(
    `SELECT u.id, u.username, u.role, u.status, u.display_name AS displayName, u.last_login_at AS lastLoginAt,
            s.expires_at AS expiresAt
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.sid = ? AND s.expires_at > NOW() AND u.status = 'active' LIMIT 1`,
    [sid],
  );
  return rows[0] || null;
}

export async function deleteSession(sid) {
  await query('DELETE FROM sessions WHERE sid = ?', [sid]);
  return true;
}

export async function deleteUserSessions(userId) {
  await query('DELETE FROM sessions WHERE user_id = ?', [userId]);
  return true;
}

export async function touchLogin(userId) {
  await query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userId]);
  return true;
}

export async function cleanupSessions() {
  await query('DELETE FROM sessions WHERE expires_at <= NOW()');
  return true;
}

/* ---------------- 语音转写任务 ---------------- */
export async function createSttJob({ id, name, language, mode, filePath }) {
  if (!state.pool) return false;
  await state.pool.execute(
    'INSERT INTO stt_jobs (id, name, status, progress, language, mode, file_path) VALUES (?,?,?,?,?,?,?)',
    [id, name, 'queued', 0, language, mode, filePath || null],
  );
  return true;
}

export async function updateSttJob(id, patch) {
  if (!state.pool) return false;
  const keys = Object.keys(patch);
  if (!keys.length) return false;
  await state.pool.execute(
    'UPDATE stt_jobs SET ' + keys.map((k) => k + ' = ?').join(', ') + ' WHERE id = ?',
    [...keys.map((k) => patch[k]), id],
  );
  return true;
}

export async function getSttJob(id) {
  if (!state.pool) return null;
  const [rows] = await state.pool.execute('SELECT * FROM stt_jobs WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function listSttJobs(limit = 50) {
  if (!state.pool) return [];
  const [rows] = await state.pool.execute(
    'SELECT id, name, status, progress, language, mode, duration_ms, LEFT(text, 200) AS excerpt, file_path, error, created_at FROM stt_jobs ORDER BY created_at DESC LIMIT ?',
    [limit],
  );
  return rows;
}

export async function deleteSttJob(id) {
  if (!state.pool) return false;
  await state.pool.execute('DELETE FROM stt_jobs WHERE id = ?', [id]);
  return true;
}
