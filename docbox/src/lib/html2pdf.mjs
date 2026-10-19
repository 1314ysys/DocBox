import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { TMP_DIR, EDGE_PROFILE_DIR, findEdge } from '../config.mjs';

const DOC_STYLES = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif; font-size: 11.5pt; line-height: 1.75; color: #1f2937; }
h1,h2,h3,h4 { line-height: 1.35; margin: 1.1em 0 .5em; color: #111827; }
h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
p { margin: .55em 0; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9.5pt; }
td, th { border: 1px solid #9ca3af; padding: 4px 7px; vertical-align: top; }
th { background: #f1f5f9; }
pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
blockquote { border-left: 3px solid #93c5fd; margin: .8em 0; padding: .2em 0 .2em 12px; color: #4b5563; }
code { font-family: Consolas, monospace; background: #f1f5f9; padding: 0 3px; }
.page-break { page-break-before: always; }
`;

export function wrapHtml(body, title = '文档', extraCss = '') {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + title +
    '</title><style>' + DOC_STYLES + '\n' + extraCss + '</style></head><body>' + body + '</body></html>';
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One headless Edge process at a time: each run costs a browser start and ~100MB.
let chain = Promise.resolve();
function serialized(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

export async function htmlToPdf(html) {
  return serialized(async () => {
    const edge = findEdge();
    if (!edge) throw new Error('未找到 Microsoft Edge / Chrome，无法执行文档打印转 PDF');
    const id = crypto.randomBytes(8).toString('hex');
    const htmlPath = path.join(TMP_DIR, id + '.html');
    const pdfPath = path.join(TMP_DIR, id + '.pdf');
    await fsp.writeFile(htmlPath, html, 'utf8');
    const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/').replace(/ /g, '%20');
    await new Promise((resolve, reject) => {
      const child = spawn(edge, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
        '--no-pdf-header-footer', '--print-to-pdf-no-header',
        '--print-to-pdf=' + pdfPath, '--user-data-dir=' + EDGE_PROFILE_DIR, fileUrl,
      ], { windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } reject(new Error('文档渲染超时')); }, 90000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('exit', () => { clearTimeout(timer); resolve(); });
    });
    try {
      const buf = await fsp.readFile(pdfPath);
      if (buf.length < 800) throw new Error('生成的 PDF 异常，请检查文档内容');
      return buf;
    } finally {
      fsp.unlink(htmlPath).catch(() => {});
      fsp.unlink(pdfPath).catch(() => {});
    }
  });
}
