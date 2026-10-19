import express from 'express';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads, baseName, sendResult } from '../lib/files.mjs';
import { STIRLING_TOOLS, STIRLING_BY_ID, STIRLING_CATS, STIRLING_UNAVAILABLE } from '../stirling-tools.mjs';
import { callStirling, stirlingInfo } from '../lib/stirling.mjs';

export const stirlingRouter = express.Router();

stirlingRouter.get('/api/stirling/tools', (_req, res) => {
  res.json({ ok: true, cats: STIRLING_CATS, tools: STIRLING_TOOLS, unavailable: STIRLING_UNAVAILABLE });
});

stirlingRouter.get('/api/stirling/status', ah(async (_req, res) => {
  const info = await stirlingInfo();
  res.json({ ok: info.online, ...info, unavailable: STIRLING_UNAVAILABLE });
}));

function fieldValue(field, raw) {
  if (field.type === 'checkbox') return raw === 'true' || raw === 'on' || raw === '1' ? 'true' : null;
  if (raw === undefined || raw === null) return null;
  return String(raw);
}

stirlingRouter.post('/api/stirling/:id', upload.any(), ah(async (req, res) => {
  const tool = STIRLING_BY_ID[req.params.id];
  if (!tool) return res.status(404).json({ error: '未知的 Stirling 工具：' + req.params.id });
  const files = req.files || [];
  const mainField = tool.fileField || 'fileInput';
  const mainFiles = files.filter((f) => f.fieldname === mainField);
  if (!mainFiles.length) return res.status(400).json({ error: '请先选择文件' });

  const fields = {};
  for (const field of tool.fields || []) {
    const raw = req.body?.[field.name];
    let value = fieldValue(field, raw);
    if (value === null && raw === undefined && field.type !== 'checkbox' && field.value !== undefined) {
      value = String(field.value);
    }
    if (value !== null) fields[field.name] = value;
  }

  const outgoing = mainFiles.map((f) => ({ field: mainField, path: f.path, name: f.originalname }));
  for (const extra of tool.extraFiles || []) {
    for (const f of files.filter((x) => x.fieldname === extra.field)) {
      outgoing.push({ field: extra.field, path: f.path, name: f.originalname });
    }
  }

  try {
    const result = await callStirling(tool.path, { files: outgoing, fields });
    if (!result.ok) {
      return res.status(502).json({ error: 'Stirling-PDF：' + result.error });
    }
    const ext = result.ext || tool.out?.ext || 'bin';
    const name = baseName(mainFiles[0].originalname) + (tool.out?.suffix || '') + '.' + ext;
    await sendResult(res, [{ name, buffer: result.buffer }], '已由 Stirling-PDF 处理（' + tool.name + '）');
  } finally {
    cleanupUploads(req);
  }
}));