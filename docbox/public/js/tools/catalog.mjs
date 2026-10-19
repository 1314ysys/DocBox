const FIELD = (name, label, type, extra = {}) => ({ name, label, type, ...extra });

export const CATS = {
  image: { name: '图片', desc: '压缩 · 转换 · 尺寸 · 水印 · 证件照 · 合成 PDF', icon: 'image' },
  pdf: { name: 'PDF', desc: '合并拆分 · 页面组织 · 加密 · 提取 · 信息', icon: 'pages' },
  doc: { name: '文档', desc: 'Word / Markdown / HTML / Excel 与 PDF 互转', icon: 'doc' },
  sheet: { name: '表格', desc: 'Excel / CSV / JSON 互转', icon: 'sheet' },
  ocr: { name: '文字识别', desc: '图片与 PDF 的离线 OCR（中文）', icon: 'scan' },
  media: { name: '音视频', desc: '转码 · 压缩 · 剪辑 · 合并 · GIF · 提音 · 水印', icon: 'video' },
  net: { name: '网络安全', desc: '连通性 · 端口 · DNS · 证书 · 配置审计 · 信息收集', icon: 'shield' },
};

export const NATIVE_TOOLS = [
  {
    id: 'img-compress', cat: 'image', name: '图片压缩', icon: 'compress', badge: '本地',
    desc: '在尽量保持观感的前提下减小体积，支持批量',
    accept: 'image/*', multiple: true, endpoint: '/api/image/process', field: 'files',
    fields: [
      FIELD('quality', '压缩质量', 'range', { min: 10, max: 100, value: 78, suffix: '%' }),
      FIELD('maxWidth', '最大宽度（可选）', 'number', { value: '', placeholder: '例如 1920，留空保持原尺寸' }),
    ],
    fixed: { op: 'compress' },
  },
  {
    id: 'img-convert', cat: 'image', name: '格式转换', icon: 'convert', badge: '本地',
    desc: 'PNG / JPG / WebP / AVIF / TIFF 互转',
    accept: 'image/*', multiple: true, endpoint: '/api/image/process', field: 'files',
    fields: [
      FIELD('format', '目标格式', 'select', { value: 'webp', options: [['webp', 'WebP（体积小）'], ['jpeg', 'JPG（兼容好）'], ['png', 'PNG（无损/透明）'], ['avif', 'AVIF（更小）'], ['tiff', 'TIFF']] }),
      FIELD('quality', '质量', 'range', { min: 10, max: 100, value: 85, suffix: '%' }),
    ],
    fixed: { op: 'convert' },
  },
  {
    id: 'img-resize', cat: 'image', name: '尺寸调整', icon: 'resize', badge: '本地',
    desc: '按宽度 / 高度缩放，可裁切填充',
    accept: 'image/*', multiple: true, endpoint: '/api/image/process', field: 'files',
    fields: [
      FIELD('width', '宽度（px）', 'number', { value: 1080 }),
      FIELD('height', '高度（px）', 'number', { value: '', placeholder: '留空按比例' }),
      FIELD('fit', '缩放方式', 'select', { value: 'inside', options: [['inside', '等比适配（不裁切）'], ['cover', '裁切填充'], ['fill', '拉伸填充'], ['contain', '留白适配']] }),
    ],
    fixed: { op: 'resize' },
  },
  { id: 'img-watermark', cat: 'image', name: '工作水印 / 全图水印', icon: 'watermark', badge: '7 套模板', route: '#/watermark', desc: '6 套现场打卡水印 + 1 套证件防滥用透明水印' },
  { id: 'img-editor', cat: 'image', name: '图片编辑', icon: 'wand', badge: '本地', route: '#/editor', desc: '裁剪 / 旋转 / 尺寸 / 色彩微调 / 文字水印' },
  { id: 'idphoto', cat: 'image', name: '证件照排版', icon: 'portrait', badge: '本地', route: '#/idphoto', desc: '1 寸 / 2 寸 / 护照等 10 种规格，A4 排版可直接打印' },
  {
    id: 'img-to-pdf', cat: 'image', name: '图片合成 PDF', icon: 'imagePdf', badge: '本地',
    desc: '按顺序把多张图片合成 PDF，自动适配方向',
    accept: 'image/*', multiple: true, endpoint: '/api/pdf/images-to-pdf', field: 'files',
    fields: [
      FIELD('pageSize', '页面尺寸', 'select', { value: 'A4', options: [['A4', 'A4'], ['Letter', 'Letter'], ['A3', 'A3'], ['fit', '跟随图片尺寸']] }),
      FIELD('orientation', '方向', 'select', { value: 'auto', options: [['auto', '自动'], ['portrait', '纵向'], ['landscape', '横向']] }),
      FIELD('margin', '页边距（pt）', 'number', { value: 28 }),
    ],
  },
  {
    id: 'pdf-merge', cat: 'pdf', name: 'PDF 合并', icon: 'merge', badge: '本地',
    desc: '按列表顺序合并多个 PDF',
    accept: 'application/pdf', multiple: true, endpoint: '/api/pdf/merge', field: 'files', minFiles: 2,
  },
  {
    id: 'pdf-split', cat: 'pdf', name: 'PDF 拆分', icon: 'split', badge: '本地',
    desc: '按页码范围拆分 / 提取 / 每 N 页一份 / 逐页拆分',
    accept: 'application/pdf', multiple: false, endpoint: '/api/pdf/split', field: 'file',
    fields: [
      FIELD('mode', '拆分方式', 'select', { value: 'ranges', options: [['ranges', '按范围拆分（逗号分开=多份）'], ['extract', '提取指定页（合成一份）'], ['every', '每 N 页一份'], ['each', '逐页拆分']] }),
      FIELD('ranges', '页码范围', 'text', { value: '1-3,4-6', placeholder: '例如 1-3,5,8-10' }),
      FIELD('every', '每份页数', 'number', { value: 2 }),
    ],
  },
  {
    id: 'pdf-pages', cat: 'pdf', name: '页面管理', icon: 'pages', badge: '本地',
    desc: '删除页面、旋转页面、按新顺序重排',
    accept: 'application/pdf', multiple: false, endpoint: '/api/pdf/pages', field: 'file',
    fields: [
      FIELD('deletePages', '删除页', 'text', { value: '', placeholder: '例如 2,5-7（留空不删除）' }),
      FIELD('rotate', '旋转角度', 'select', { value: '0', options: [['0', '不旋转'], ['90', '顺时针 90°'], ['180', '旋转 180°'], ['270', '顺时针 270°']] }),
      FIELD('rotatePages', '旋转范围', 'text', { value: '', placeholder: '留空 = 全部页面' }),
      FIELD('order', '新顺序', 'text', { value: '', placeholder: '例如 3,1,2,4-6（留空保持原序）' }),
    ],
  },
  {
    id: 'pdf-watermark', cat: 'pdf', name: 'PDF 水印', icon: 'watermark', badge: '本地',
    desc: '给 PDF 叠加文字水印，支持中文与页面范围',
    accept: 'application/pdf', multiple: false, endpoint: '/api/pdf/watermark', field: 'file',
    fields: [
      FIELD('text', '水印文字', 'text', { value: '内部资料 请勿外传' }),
      FIELD('sizePct', '字号（页面短边占比）', 'range', { min: 2, max: 20, value: 8, suffix: '%' }),
      FIELD('opacity', '不透明度', 'range', { min: 5, max: 60, value: 16, suffix: '%', scale: 100 }),
      FIELD('color', '颜色', 'color', { value: '#cbd5e1' }),
      FIELD('diagonal', '倾斜 45°', 'checkbox', { value: '1', checked: true }),
      FIELD('pages', '应用页码', 'text', { value: '', placeholder: '留空 = 全部页面' }),
    ],
  },
  {
    id: 'pdf-numbers', cat: 'pdf', name: '添加页码', icon: 'tag', badge: '本地',
    desc: '批量插入“第 n 页 / 共 m 页”页码',
    accept: 'application/pdf', multiple: false, endpoint: '/api/pdf/numbers', field: 'file',
    fields: [
      FIELD('position', '位置', 'select', { value: 'bottom-center', options: [['bottom-center', '底部居中'], ['bottom-right', '底部右侧'], ['bottom-left', '底部左侧'], ['top-center', '顶部居中'], ['top-right', '顶部右侧'], ['top-left', '顶部左侧']] }),
      FIELD('template', '页码格式', 'text', { value: '{n} / {total}', placeholder: '可用 {n} 与 {total}' }),
      FIELD('start', '起始页码', 'number', { value: 1 }),
      FIELD('size', '字号', 'number', { value: 10 }),
      FIELD('color', '颜色', 'color', { value: '#3f3f3f' }),
    ],
  },
  {
    id: 'pdf-compress', cat: 'pdf', name: 'PDF 压缩', icon: 'compress', badge: '本地',
    desc: '重写文档结构并优化对象存储，减小体积',
    accept: 'application/pdf', multiple: false, endpoint: '/api/pdf/compress', field: 'file',
    fields: [FIELD('level', '压缩强度', 'range', { min: 1, max: 9, value: 5 })],
  },
  { id: 'pdf-extract', cat: 'pdf', name: 'PDF 拆解导出', icon: 'eye', badge: '前端', route: '#/extract', desc: '导出页面图片、提取文字、查看页数' },
  { id: 'ocr', cat: 'ocr', name: 'OCR 文字识别', icon: 'scan', badge: '离线', route: '#/ocr', desc: '图片识别与 PDF 整本识别，支持导出 TXT' },
  {
    id: 'doc-to-pdf', cat: 'doc', name: '文档转 PDF', icon: 'doc', badge: '本地',
    desc: 'Word(.docx) / Markdown / HTML / Excel / CSV 转 PDF',
    accept: '.docx,.md,.markdown,.html,.htm,.txt,.csv,.xlsx,.xls', multiple: false, endpoint: '/api/doc/to-pdf', field: 'file',
  },
  {
    id: 'docx-to-html', cat: 'doc', name: 'Word 转 HTML', icon: 'convert', badge: '本地',
    desc: '.docx 转成带样式的独立 HTML',
    accept: '.docx', multiple: false, endpoint: '/api/doc/docx-to-html', field: 'file',
  },
  {
    id: 'doc-to-markdown', cat: 'doc', name: '文档转 Markdown', icon: 'markdown', badge: '本地',
    desc: '.docx / .html 转 Markdown，适合写文档与知识库',
    accept: '.docx,.html,.htm', multiple: false, endpoint: '/api/doc/to-markdown', field: 'file',
  },
  {
    id: 'sheet-convert', cat: 'sheet', name: '表格格式转换', icon: 'sheet', badge: '本地',
    desc: 'Excel ⇄ CSV ⇄ JSON，多工作表自动拆分',
    accept: '.xlsx,.xls,.csv', multiple: true, endpoint: '/api/sheet/convert', field: 'files',
    fields: [
      FIELD('target', '目标格式', 'select', { value: 'csv', options: [['csv', 'CSV'], ['xlsx', 'Excel (.xlsx)'], ['xls', 'Excel 97-2003 (.xls)'], ['json', 'JSON']] }),
    ],
  },
  {
    id: 'sheet-to-json', cat: 'sheet', name: '表格转 JSON', icon: 'convert', badge: '本地',
    desc: '按工作表输出对象数组，接口联调常用',
    accept: '.xlsx,.xls,.csv', multiple: false, endpoint: '/api/sheet/to-json', field: 'file',
  },
];

const SKIP_SUITE = new Set(['pdf-split', 'pdf-img2pdf']);

export function buildCatalog(app) {
  const tools = NATIVE_TOOLS.map((t) => ({ ...t }));
  const used = new Set(tools.map((t) => t.id));
  const suiteTools = [];
  for (const suite of ['pdf', 'media', 'net']) {
    for (const t of app.suites?.[suite] || []) {
      if (SKIP_SUITE.has(t.id) || used.has(t.id)) continue;
      used.add(t.id);
      suiteTools.push({
        id: t.id,
        cat: suite,
        name: t.name,
        desc: t.desc,
        icon: t.icon || suite,
        badge: t.badge || (suite === 'media' ? 'FFmpeg' : suite === 'net' ? '本地探测' : '本地引擎'),
        accept: t.accept || null,
        multiple: Boolean(t.multiple),
        endpoint: '/api/suite/' + suite + '/' + t.id.replace(new RegExp('^' + suite + '-'), ''),
        field: 'files',
        mode: t.mode || 'file',
        minFiles: t.multiple ? 1 : 0,
        fields: (t.fields || []).map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type || 'text',
          value: f.type === 'checkbox' ? 'true' : (f.value ?? ''),
          checked: f.type === 'checkbox' ? Boolean(f.checked) : undefined,
          min: f.min, max: f.max, step: f.step, suffix: f.suffix, options: f.options, placeholder: f.placeholder, hint: f.hint,
        })),
        filesHint: t.filesHint,
        suite: suite,
      });
    }
  }
  return { tools: tools.concat(suiteTools), cats: CATS, suiteTools };
}
