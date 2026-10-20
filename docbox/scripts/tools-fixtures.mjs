/**
 * 生成 tools-check 用的测试夹具（图片 / PDF / 音频 / 视频 / 表格 / 文本 / docx）
 * 用法：node scripts/tools-fixtures.mjs [输出目录]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const sharp = require('sharp');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const { FFMPEG } = await import('../src/config.mjs');

const run = promisify(execFile);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 允许命令行传输出目录；被 tools-check import 时 argv 里是 baseUrl，不能被当成目录
const argDir = process.argv[2] && !/^[a-z]+:\/\//i.test(process.argv[2]) ? process.argv[2] : '';
const OUT = path.resolve(argDir || path.join(ROOT, 'tmp', 'fixtures'));

async function makePdf(file, pages = 5) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpgBytes = await fs.readFile(path.join(OUT, 'sample.jpg')).catch(() => null);
  const img = jpgBytes ? await doc.embedJpg(jpgBytes) : null;
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText('DocBox test page ' + i, { x: 60, y: 780, size: 22, font, color: rgb(0.1, 0.2, 0.6) });
    page.drawText('Generated fixture for tool checks - page ' + i + '/' + pages, { x: 60, y: 750, size: 12, font });
    page.drawRectangle({ x: 60, y: 120, width: 460, height: 560, borderColor: rgb(0.7, 0.75, 0.85), borderWidth: 1, color: rgb(0.96, 0.97, 1) });
    page.drawText('Line ' + i, { x: 80, y: 640, size: 40, font, color: rgb(0.85, 0.3, 0.3) });
    if (img) page.drawImage(img, { x: 300, y: 160, width: 200, height: 133 });
  }
  await fs.writeFile(file, await doc.save());
}

async function makeImages() {
  const base = sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 238, g: 242, b: 250 } } });
  const svg = Buffer.from('<svg width="900" height="600"><rect x="40" y="40" width="820" height="520" fill="#dbeafe" stroke="#2563eb" stroke-width="4"/><text x="90" y="260" font-family="Arial" font-size="64" fill="#1e3a8a">DocBox</text><text x="90" y="340" font-family="Arial" font-size="30" fill="#475569">test image 900x600</text></svg>');
  const png = await base.clone().composite([{ input: svg }]).png().toBuffer();
  await fs.writeFile(path.join(OUT, 'sample.png'), png);
  await fs.writeFile(path.join(OUT, 'sample.jpg'), await sharp(png).jpeg({ quality: 88 }).toBuffer());
  await fs.writeFile(path.join(OUT, 'sample.webp'), await sharp(png).webp({ quality: 88 }).toBuffer());
  await fs.writeFile(path.join(OUT, 'overlay.png'), await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 255, g: 90, b: 90, alpha: 0.75 } } }).png().toBuffer());
  // 证件照素材：竖版人像占位
  await fs.writeFile(path.join(OUT, 'portrait.jpg'), await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 225, g: 232, b: 245 } } }).composite([{ input: Buffer.from('<svg width="600" height="800"><circle cx="300" cy="300" r="140" fill="#c7d2fe"/><rect x="180" y="460" width="240" height="260" rx="60" fill="#a5b4fc"/></svg>') }]).jpeg().toBuffer());
}

async function makeMedia() {
  const mp4 = path.join(OUT, 'sample.mp4');
  await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4], { maxBuffer: 1 << 26 });
  await run(FFMPEG, ['-y', '-i', mp4, '-vn', '-c:a', 'libmp3lame', '-b:a', '96k', path.join(OUT, 'sample.mp3')], { maxBuffer: 1 << 26 });
  await run(FFMPEG, ['-y', '-i', mp4, '-vn', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', path.join(OUT, 'sample.wav')], { maxBuffer: 1 << 26 });
  await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', path.join(OUT, 'speech-test.wav')], { maxBuffer: 1 << 26 });
}

async function makeDocs() {
  await fs.writeFile(path.join(OUT, 'sample.md'), '# DocBox 测试\n\n- 第一项\n- 第二项\n\n| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n');
  await fs.writeFile(path.join(OUT, 'sample.html'), '<!doctype html><meta charset="utf-8"><h1>DocBox 测试</h1><p>HTML 夹具，用于 html→docx / md / pdf。</p><ul><li>甲</li><li>乙</li></ul>');
  await fs.writeFile(path.join(OUT, 'sample.txt'), 'DocBox 纯文本夹具\n第二行 English text.\n');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['姓名', '分数', '备注'], ['张三', 90, '优秀'], ['李四', 78, '良好'], ['王五', 61, '及格']]);
  XLSX.utils.book_append_sheet(wb, ws, '成绩');
  XLSX.writeFile(wb, path.join(OUT, 'sample.xlsx'));
  await fs.writeFile(path.join(OUT, 'sample.csv'), 'a,b,c\n1,2,3\n4,5,6\n');

  // 最小 docx
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder('word').file('document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DocBox docx fixture</w:t></w:r></w:p><w:p><w:r><w:t>第二段：用于 word→txt / html / pdf 测试。</w:t></w:r></w:p></w:body></w:document>');
  await fs.writeFile(path.join(OUT, 'sample.docx'), await zip.generateAsync({ type: 'nodebuffer' }));

  // 最小 pptx（1 页）
  const pz = new JSZip();
  pz.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
  pz.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
  pz.folder('ppt').file('presentation.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>');
  pz.folder('ppt').folder('_rels').file('presentation.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
  pz.folder('ppt').folder('slides').file('slide1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>DocBox pptx fixture</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  await fs.writeFile(path.join(OUT, 'sample.pptx'), await pz.generateAsync({ type: 'nodebuffer' }));
}

await fs.mkdir(OUT, { recursive: true });
await makeImages();
await makePdf(path.join(OUT, 'sample.pdf'));
await makeDocs();
await makeMedia();
const files = (await fs.readdir(OUT)).sort();
const sizes = [];
for (const f of files) sizes.push(f + ' (' + Math.round((await fs.stat(path.join(OUT, f))).size / 1024) + 'KB)');
console.log('fixtures ->', OUT);
console.log(sizes.join('\n'));
