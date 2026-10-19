/**
 * 任务记录：把每次处理写入 MySQL（jobs 表），供“处理历史”页面使用。
 * 数据库不可用时静默跳过，不影响主流程。
 */
import { recordJob } from './db.mjs';

export function logJob(req, { suite, tool, note = '', outputs = 0, input = '', status = 'ok', error = null }) {
  const durationMs = req && req._t0 ? Date.now() - req._t0 : 0;
  recordJob({
    suite,
    tool,
    status,
    durationMs,
    input: input || summarizeInput(req),
    output: outputs ? outputs + ' 个产物' : '',
    note,
    error,
  }).catch(() => {});
}

function summarizeInput(req) {
  try {
    const files = req.files ? [].concat(req.files) : [];
    if (files.length) {
      const names = files.map((f) => f.originalname).slice(0, 3).join(', ');
      return files.length > 3 ? names + ' 等 ' + files.length + ' 个' : names;
    }
    const body = req.body || {};
    const pick = body.host || body.url || body.domain || body.query || body.ip || body.text || '';
    return String(pick).slice(0, 120);
  } catch {
    return '';
  }
}
