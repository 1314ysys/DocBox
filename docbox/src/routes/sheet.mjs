import express from 'express';
import fsp from 'node:fs/promises';
import XLSX from 'xlsx';
import { upload } from '../lib/upload.mjs';
import { ah } from '../lib/async.mjs';
import { cleanupUploads, baseName, sendResult } from '../lib/files.mjs';

export const sheetRouter = express.Router();

sheetRouter.post('/api/sheet/convert', upload.array('files', 40), ah(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '请选择表格文件' });
  try {
    const target = (req.body.target || 'csv').toLowerCase();
    const outputs = [];
    for (const f of files) {
      const buffer = await fsp.readFile(f.path);
      const ext = (f.originalname.split('.').pop() || '').toLowerCase();
      const stem = baseName(f.originalname);
      if (ext === 'csv') {
        const wb = XLSX.read(buffer.toString('utf8'), { type: 'string' });
        if (target === 'json') {
          const json = {};
          wb.SheetNames.forEach((n) => { json[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
          outputs.push({ name: stem + '.json', buffer: Buffer.from(JSON.stringify(json, null, 2), 'utf8') });
        } else {
          const out = XLSX.write(wb, { bookType: target === 'xls' ? 'biff8' : 'xlsx', type: 'buffer' });
          outputs.push({ name: stem + '.' + (target === 'xls' ? 'xls' : 'xlsx'), buffer: out });
        }
      } else {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        if (target === 'json') {
          const json = {};
          wb.SheetNames.forEach((n) => { json[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }); });
          outputs.push({ name: stem + '.json', buffer: Buffer.from(JSON.stringify(json, null, 2), 'utf8') });
        } else if (wb.SheetNames.length === 1) {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          outputs.push({ name: stem + '.csv', buffer: Buffer.from('\ufeff' + csv, 'utf8') });
        } else {
          for (const name of wb.SheetNames) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
            outputs.push({ name: stem + '_' + name.replace(/[\\/:*?"<>|]/g, '_') + '.csv', buffer: Buffer.from('\ufeff' + csv, 'utf8') });
          }
        }
      }
    }
    await sendResult(res, outputs, '已转换 ' + outputs.length + ' 个文件');
  } finally {
    cleanupUploads(req);
  }
}));

sheetRouter.post('/api/sheet/to-json', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 Excel / CSV 文件' });
  try {
    const buffer = await fsp.readFile(req.file.path);
    const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
    const wb = XLSX.read(ext === 'csv' ? buffer.toString('utf8') : buffer, { type: ext === 'csv' ? 'string' : 'buffer' });
    const json = {};
    wb.SheetNames.forEach((name) => { json[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }); });
    await sendResult(res, [{ name: baseName(req.file.originalname) + '.json', buffer: Buffer.from(JSON.stringify(json, null, 2), 'utf8') }],
      '共 ' + wb.SheetNames.length + ' 个工作表，已转为对象数组');
  } finally {
    cleanupUploads(req);
  }
}));
