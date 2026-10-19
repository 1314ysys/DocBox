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
