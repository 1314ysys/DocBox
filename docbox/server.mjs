import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PORT, HOST, PUBLIC_DIR, OUTPUT_DIR, UPLOAD_DIR, TMP_DIR, APP_VERSION } from './src/config.mjs';
import { cleanupRuntime, cleanupOld } from './src/lib/files.mjs';
import { imageRouter } from './src/routes/image.mjs';
import { idphotoRouter } from './src/routes/idphoto.mjs';
import { pdfRouter } from './src/routes/pdf.mjs';
import { stirlingRouter } from './src/routes/stirling.mjs';
import { docRouter } from './src/routes/doc.mjs';
import { sheetRouter } from './src/routes/sheet.mjs';
import { ocrRouter } from './src/routes/ocr.mjs';
import { metaRouter } from './src/routes/meta.mjs';
import { stirlingInfo } from './src/lib/stirling.mjs';

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR, { maxAge: 0, etag: true, index: 'index.html' }));
app.use('/files', express.static(OUTPUT_DIR, {
  maxAge: '2h',
  setHeaders(res, filePath) {
    const name = path.basename(filePath);
    res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(name));
  },
}));

app.use(metaRouter);
app.use(imageRouter);
app.use(idphotoRouter);
app.use(pdfRouter);
app.use(stirlingRouter);
app.use(docRouter);
app.use(sheetRouter);
app.use(ocrRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

app.use((err, _req, res, _next) => {
  const message = err?.message || '处理失败';
  if (res.headersSent) return;
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '单个文件不能超过 200MB' });
  if (err?.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: '一次最多处理 40 个文件' });
  console.error('[DocBox]', message);
  res.status(400).json({ error: message });
});

// 启动即清理：上次异常退出留下的上传临时文件、渲染中间件，以及过期的输出。
await cleanupRuntime();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const cleanupTimer = setInterval(() => {
  cleanupOld(UPLOAD_DIR, 60 * 60 * 1000);
  cleanupOld(OUTPUT_DIR, 6 * 60 * 60 * 1000);
  cleanupOld(TMP_DIR, 2 * 60 * 60 * 1000);
}, 30 * 60 * 1000);
cleanupTimer.unref();

const server = app.listen(PORT, HOST, async () => {
  const st = await stirlingInfo();
  console.log('DocBox v' + APP_VERSION + ' listening on http://' + HOST + ':' + PORT);
  console.log('Stirling-PDF: ' + (st.online ? 'ONLINE v' + (st.version || '?') + ' @ ' + st.base : 'OFFLINE（PDF 专业工具将回退本地引擎）'));
});

async function shutdown() {
  clearInterval(cleanupTimer);
  server.close();
  await fsp.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);