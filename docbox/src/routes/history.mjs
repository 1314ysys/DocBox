import express from 'express';
import { ah } from '../lib/async.mjs';
import {
  dbState, listJobs, jobStats, clearJobs, listNetReports,
  listTemplates, saveTemplate, deleteTemplate, getSetting, setSetting,
} from '../lib/db.mjs';

export const historyRouter = express.Router();

historyRouter.get('/api/history', ah(async (req, res) => {
  if (!dbState().available) return res.json({ ok: true, jobs: [], stats: null, note: '本地数据库不可用，历史记录暂不可用' });
  const jobs = await listJobs({ limit: req.query.limit, suite: req.query.suite, q: req.query.q });
  const stats = await jobStats();
  res.json({ ok: true, jobs, stats });
}));

historyRouter.delete('/api/history', ah(async (_req, res) => {
  if (!dbState().available) return res.status(400).json({ error: '本地数据库不可用' });
  await clearJobs();
  res.json({ ok: true });
}));

historyRouter.get('/api/net/reports', ah(async (req, res) => {
  if (!dbState().available) return res.json({ ok: true, reports: [] });
  res.json({ ok: true, reports: await listNetReports(req.query.limit) });
}));

historyRouter.get('/api/templates', ah(async (_req, res) => {
  if (!dbState().available) return res.json({ ok: true, templates: [] });
  res.json({ ok: true, templates: await listTemplates() });
}));

historyRouter.post('/api/templates', ah(async (req, res) => {
  if (!dbState().available) return res.status(400).json({ error: '本地数据库不可用' });
  const { templateId, name, spec } = req.body || {};
  if (!templateId) return res.status(400).json({ error: '缺少 templateId' });
  await saveTemplate({ templateId: String(templateId), name: String(name || templateId), spec: spec || {} });
  res.json({ ok: true });
}));

historyRouter.delete('/api/templates/:id', ah(async (req, res) => {
  if (!dbState().available) return res.status(400).json({ error: '本地数据库不可用' });
  await deleteTemplate(req.params.id);
  res.json({ ok: true });
}));

historyRouter.get('/api/settings/:key', ah(async (req, res) => {
  if (!dbState().available) return res.status(400).json({ error: '本地数据库不可用' });
  res.json({ ok: true, value: await getSetting(req.params.key) });
}));

historyRouter.post('/api/settings/:key', ah(async (req, res) => {
  if (!dbState().available) return res.status(400).json({ error: '本地数据库不可用' });
  await setSetting(req.params.key, req.body?.value ?? '');
  res.json({ ok: true });
}));
