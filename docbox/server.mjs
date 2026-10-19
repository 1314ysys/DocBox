import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PORT, HOST, PUBLIC_DIR, OUTPUT_DIR, UPLOAD_DIR, TMP_DIR, APP_VERSION } from './src/config.mjs';
import { cleanupRuntime, cleanupOld } from './src/lib/files.mjs';
import { initDb, dbState, closeDb } from './src/lib/db.mjs';
import { mediaHealth } from './src/lib/media.mjs';
import { imageRouter } from './src/routes/image.mjs';
import { idphotoRouter } from './src/routes/idphoto.mjs';
import { pdfRouter } from './src/routes/pdf.mjs';
import { suiteRouter } from './src/routes/suite.mjs';
import { historyRouter } from './src/routes/history.mjs';
import { docRouter } from './src/routes/doc.mjs';
import { sheetRouter } from './src/routes/sheet.mjs';
import { ocrRouter } from './src/routes/ocr.mjs';
import { metaRouter } from './src/routes/meta.mjs';
import { authRouter } from './src/routes/auth.mjs';
import { accountsRouter } from './src/routes/accounts.mjs';
import { attachUser, requireAuth, requireModule, authEnabled } from './src/lib/auth.mjs';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => { req._t0 = Date.now(); next(); });
app.use(express.static(PUBLIC_DIR, { maxAge: 0, etag: true, index: 'index.html' }));
app.use('/files', express.static(OUTPUT_DIR, {
  maxAge: '2h',
  setHeaders(res, filePath) {
    const name = path.basename(filePath);
    res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(name));
  },
}));

// ---- 认证与模块权限（数据库不可用时自动进入免登录模式）----
app.use(attachUser);
app.use(authRouter);
app.use((req, res, next) => (req.path === '/api/health' ? next() : requireAuth(req, res, next)));
app.use(requireModule);

app.use(metaRouter);
app.use(accountsRouter);
app.use(imageRouter);
app.use(idphotoRouter);
app.use(pdfRouter);
app.use(suiteRouter);
app.use(historyRouter);
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

await cleanupRuntime();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const cleanupTimer = setInterval(() => {
  cleanupOld(UPLOAD_DIR, 60 * 60 * 1000);
  cleanupOld(OUTPUT_DIR, 6 * 60 * 60 * 1000);
  cleanupOld(TMP_DIR, 2 * 60 * 60 * 1000);
}, 30 * 60 * 1000);
cleanupTimer.unref();

const server = app.listen(PORT, HOST, async () => {
  const db = await initDb();
  const media = await mediaHealth();
  console.log('DocBox v' + APP_VERSION + ' listening on http://' + HOST + ':' + PORT);
  console.log('MySQL: ' + (db.ok ? 'CONNECTED v' + db.version + (db.passwordChanged !== null ? '（实际密码：' + db.passwordChanged + '）' : '') : 'UNAVAILABLE（历史记录功能降级）'));
  console.log('AUTH: ' + (authEnabled() ? '启用（默认账号 root/root）' : '免登录模式（数据库不可用）'));
  console.log('FFmpeg: ' + (media.ok ? 'READY v' + media.version : 'MISSING'));
});

async function shutdown() {
  clearInterval(cleanupTimer);
  server.close();
  await closeDb().catch(() => {});
  await fsp.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, dbState };
