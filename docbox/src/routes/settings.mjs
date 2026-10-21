import express from 'express';
import { ah } from '../lib/async.mjs';
import { requireAuth, requireAdmin } from '../lib/auth.mjs';
import { getRetentionHours, setRetentionHours, sweepOutputs, outputsUsage, lastSweepInfo, DEFAULT_RETENTION_HOURS } from '../lib/retention.mjs';

export const settingsRouter = express.Router();

/** 当前设置（登录用户可读） */
settingsRouter.get('/api/settings', requireAuth, ah(async (_req, res) => {
  const hours = await getRetentionHours();
  const usage = await outputsUsage();
  res.json({
    ok: true,
    retention: {
      hours,
      permanent: hours === 0,
      defaultHours: DEFAULT_RETENTION_HOURS,
    },
    outputs: usage,
    lastSweep: lastSweepInfo(),
  });
}));

/** 修改成品保留时长（仅管理员）：0 = 永久保存 */
settingsRouter.post('/api/settings/retention', requireAuth, requireAdmin, ah(async (req, res) => {
  const raw = req.body?.hours;
  if (raw === undefined || raw === null || raw === '') return res.status(400).json({ error: '请提供 hours（0 = 永久保存，其余为小时数）' });
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: '保留时长必须是不小于 0 的整数（0 = 永久保存）' });
  const hours = await setRetentionHours(n);
  const swept = req.body?.sweep === false ? null : await sweepOutputs({ hours });
  res.json({
    ok: true,
    retention: { hours, permanent: hours === 0, defaultHours: DEFAULT_RETENTION_HOURS },
    sweep: swept,
    note: hours === 0 ? '已设为永久保存，不再自动清理成品' : '已设为保留 ' + hours + ' 小时，超时的成品会被自动清理',
  });
}));

/** 立即清理一次（仅管理员，便于验证设置） */
settingsRouter.post('/api/settings/retention/sweep', requireAuth, requireAdmin, ah(async (req, res) => {
  const hours = req.body?.hours === undefined ? undefined : Number(req.body.hours);
  const result = await sweepOutputs({ hours });
  res.json({ ok: true, result, note: result.permanent ? '当前为永久保存，未清理任何文件' : '已清理 ' + result.removedFiles + ' 个成品、' + result.removedTasks + ' 条任务记录' });
}));
