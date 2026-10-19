import express from 'express';
import fsp from 'node:fs/promises';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads, sendResult } from '../lib/files.mjs';
import { logJob } from '../lib/track.mjs';
import { TOOL_BY_ID } from '../tool-catalog.mjs';
import { runPdfTool } from '../lib/pdfops.mjs';
import { runMediaTool } from '../lib/media.mjs';
import { runNetTool } from '../lib/netprobe.mjs';
import { saveNetReport } from '../lib/db.mjs';

export const suiteRouter = express.Router();

const TARGET_FIELDS = ['host', 'url', 'domain', 'query', 'ip'];

async function readOutputs(outputs) {
  const list = [];
  for (const item of outputs || []) {
    const buffer = item.buffer || (item.path ? await fsp.readFile(item.path) : null);
    if (!buffer) continue;
    list.push({ name: item.name || 'output.bin', buffer, kind: item.kind || '' });
    if (item.path) fsp.rm(item.path, { force: true }).catch(() => {});
  }
  return list;
}

for (const suite of ['pdf', 'media', 'net']) {
  suiteRouter.post('/api/suite/' + suite + '/:action', upload.array('files', 40), ah(async (req, res) => {
    const toolId = suite + '-' + req.params.action;
    const tool = TOOL_BY_ID.get(toolId);
    if (!tool) return res.status(404).json({ error: '未知工具：' + toolId });
    const files = [];
    for (const f of req.files || []) files.push({ path: f.path, name: f.originalname, size: f.size, buffer: await fsp.readFile(f.path) });
    const fields = { ...req.body };
    try {
      if (tool.suite !== 'net' && !files.length) return res.status(400).json({ error: '请先选择文件' });
      if ((tool.suite === 'pdf' || tool.suite === 'media') && !tool.multiple && files.length > 1) {
        return res.status(400).json({ error: '该工具一次只处理一个文件' });
      }
      let result;
      if (tool.suite === 'pdf') {
        if (toolId === 'pdf-overlay' && files.length >= 2) {
          fields.overlayFile = await fsp.readFile(files[1].path);
        }
        result = await runPdfTool(toolId.replace(/^pdf-/, ''), files, fields);
      } else if (tool.suite === 'media') {
        result = await runMediaTool(toolId.replace(/^media-/, ''), files, fields);
      } else {
        result = await runNetTool(toolId.replace(/^net-/, ''), fields);
      }

      if (result.data) {
        logJob(req, { suite: tool.suite, tool: toolId, note: result.note || '', status: 'ok' });
        if (tool.suite === 'net') {
          const target = TARGET_FIELDS.map((k) => fields[k]).find(Boolean) || '';
          saveNetReport({ tool: toolId, target, summary: result.data }).catch(() => {});
        }
        return res.json({ ok: true, data: result.data, note: result.note || '' });
      }

      const outputs = await readOutputs(result.outputs);
      if (!outputs.length) return res.status(400).json({ error: '没有生成任何结果' });
      logJob(req, { suite: tool.suite, tool: toolId, note: result.note || '', outputs: outputs.length, status: 'ok' });
      await sendResult(res, outputs, result.note || '');
    } catch (err) {
      const message = err && err.message ? err.message : '处理失败';
      logJob(req, { suite: tool.suite, tool: toolId, status: 'fail', error: message.slice(0, 300) });
      if (!res.headersSent) res.status(400).json({ error: message });
    } finally {
      cleanupUploads(req);
    }
  }));
}
