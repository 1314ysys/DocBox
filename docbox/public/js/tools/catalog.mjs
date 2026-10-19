const FIELD = (name, label, type, extra = {}) => ({ name, label, type, ...extra });

export const CATS = {
  image: { name: '图片', desc: '压缩 · 转换 · 尺寸 · 水印 · 证件照 · 合成 PDF', icon: 'image' },
  pdf: { name: 'PDF', desc: '合并拆分 · 页面组织 · 加密 · 提取 · 信息', icon: 'pages' },
  doc: { name: '文档', desc: 'Word / Excel / PPT / Markdown / TXT / HTML 与 PDF 互转 · 公文排版', icon: 'doc' },
  sheet: { name: '表格', desc: 'Excel / CSV / JSON 互转', icon: 'sheet' },
  ocr: { name: 'OCR 与转写', desc: '离线中文 OCR · 音视频 Whisper 转写 · 麦克风实时转写', icon: 'scan' },
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
  { id: 'ocr', cat: 'ocr', name: 'OCR 与转写', icon: 'scan', badge: '离线', route: '#/ocr', desc: '图片 OCR · PDF 整本识别 · 音视频 Whisper 转写 · 麦克风实时转写' },
  { id: 'net-terminal', cat: 'net', name: 'SSH / Telnet 终端', icon: 'terminal', badge: '网页直连', route: '#/terminal', desc: '浏览器里直连服务器：SSH（22）与 Telnet（23），多会话标签，断线自动回收' },
  {
    id: 'doc-word-to-pdf', cat: 'doc', name: 'Word 转 PDF', icon: 'doc', badge: '本地',
    desc: 'Word(.docx) 转 PDF，保留标题、列表、表格与图片',
    accept: '.docx', multiple: false, endpoint: '/api/doc/word-to-pdf', field: 'file',
  },
  {
    id: 'doc-excel-to-pdf', cat: 'doc', name: 'Excel 转 PDF', icon: 'sheet', badge: '本地',
    desc: 'Excel / CSV 转 PDF，多工作表自动分页',
    accept: '.xlsx,.xls,.csv', multiple: false, endpoint: '/api/doc/excel-to-pdf', field: 'file',
  },
  {
    id: 'doc-pptx-to-pdf', cat: 'doc', name: 'PowerPoint 转 PDF', icon: 'pages', badge: '本地',
    desc: 'PPTX 按幻灯片逐页输出横向 PDF（文字 + 图片）',
    accept: '.pptx', multiple: false, endpoint: '/api/doc/pptx-to-pdf', field: 'file',
  },
  {
    id: 'doc-md-to-pdf', cat: 'doc', name: 'Markdown 转 PDF', icon: 'markdown', badge: '本地',
    desc: 'Markdown 转排版好的 PDF，支持表格与代码块',
    accept: '.md,.markdown', multiple: false, endpoint: '/api/doc/md-to-pdf', field: 'file',
  },
  {
    id: 'doc-txt-to-pdf', cat: 'doc', name: '文本转 PDF', icon: 'doc', badge: '本地',
    desc: '纯文本转 PDF，等宽保留换行',
    accept: '.txt', multiple: false, endpoint: '/api/doc/txt-to-pdf', field: 'file',
  },
  { id: 'doc-md-editor', cat: 'doc', name: 'Markdown 编辑器', icon: 'markdown', badge: '实时预览', route: '#/md-editor',
    desc: '左边写 Markdown，右边实时预览，可导出 HTML / PDF / .md' },
  {
    id: 'doc-html-to-word', cat: 'doc', name: 'HTML 转 Word', icon: 'convert', badge: '本地',
    desc: '把 HTML 转成可编辑的 .docx（标题/列表/加粗保留）',
    accept: '.html,.htm', multiple: false, endpoint: '/api/doc/html-to-docx', field: 'file',
  },
  {
    id: 'doc-word-to-html', cat: 'doc', name: 'Word 转 HTML', icon: 'convert', badge: '本地',
    desc: '.docx 转成带样式的独立 HTML',
    accept: '.docx', multiple: false, endpoint: '/api/doc/docx-to-html', field: 'file',
  },
  {
    id: 'doc-word-to-txt', cat: 'doc', name: 'Word 转 TXT', icon: 'doc', badge: '本地',
    desc: '.docx 提取纯文本，去掉格式',
    accept: '.docx', multiple: false, endpoint: '/api/doc/word-to-txt', field: 'file',
  },
  {
    id: 'doc-batch-convert', cat: 'doc', name: 'Word 格式转换（批量）', icon: 'convert', badge: '批量',
    desc: '批量把 Word / HTML / Markdown 转成 TXT、HTML、Markdown 或 PDF',
    accept: '.docx,.html,.htm,.md,.markdown,.txt', multiple: true, endpoint: '/api/doc/batch-convert', field: 'files',
    fields: [
      FIELD('target', '目标格式', 'select', { value: 'txt', options: [['txt', 'TXT（纯文本）'], ['html', 'HTML（带样式）'], ['md', 'Markdown'], ['pdf', 'PDF']] }),
    ],
  },
  {
    id: 'doc-word-to-md', cat: 'doc', name: 'Word 转 Markdown', icon: 'markdown', badge: '本地',
    desc: '.docx 转 Markdown，适合写文档与知识库',
    accept: '.docx', multiple: false, endpoint: '/api/doc/to-markdown', field: 'file',
  },
  {
    id: 'doc-md-to-html', cat: 'doc', name: 'Markdown 转 HTML', icon: 'convert', badge: '本地',
    desc: 'Markdown 转成独立 HTML 文件（自带样式）',
    accept: '.md,.markdown,.txt', multiple: false, endpoint: '/api/doc/md-to-html', field: 'file',
  },
  {
    id: 'doc-html-to-md', cat: 'doc', name: 'HTML 转 Markdown', icon: 'markdown', badge: '本地',
    desc: '把网页或 HTML 片段转成 Markdown',
    accept: '.html,.htm', multiple: false, endpoint: '/api/doc/to-markdown', field: 'file',
  },
  {
    id: 'doc-gongwen', cat: 'doc', name: '公文一键排版', icon: 'docs', badge: '公文', 
    desc: 'A4 版式、标题小标宋二号、正文仿宋三号、首行缩进两字、页码、附件换页',
    accept: '.docx,.txt,.md', multiple: false, endpoint: '/api/doc/gongwen', field: 'file',
    fields: [
      FIELD('output', '输出格式', 'select', { value: 'both', options: [['both', 'Word + PDF'], ['docx', '仅 Word (.docx)'], ['pdf', '仅 PDF']] }),
      FIELD('lineSpacing', '行距（磅）', 'number', { value: 28 }),
      FIELD('pageNumbers', '页码', 'select', { value: '1', options: [['1', '添加（居中 — 1 —）'], ['0', '不加']] }),
      FIELD('attachBreak', '附件另起一页', 'select', { value: '1', options: [['1', '是'], ['0', '否']] }),
    ],
  },
  { id: 'doc-md-table', cat: 'doc', name: 'Markdown 表格生成器', icon: 'sheet', badge: '生成器', route: '#/md-table',
    desc: '按行数、列数生成标准 Markdown 表格模板，可选列对齐' },
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

export const MODULE_NAV = {
  image: { name: '图片工具', icon: 'image' },
  pdf: { name: 'PDF 工具', icon: 'pages' },
  doc: { name: '文档转换', icon: 'doc' },
  sheet: { name: '表格处理', icon: 'sheet' },
  ocr: { name: 'OCR 与转写', icon: 'scan' },
  media: { name: '音视频工具', icon: 'video' },
  net: { name: '网络安全', icon: 'shield' },
  history: { name: '处理历史', icon: 'history' },
  accounts: { name: '账户管理', icon: 'users' },
};

// 首页 / 分类页右侧展示卡片：与左侧模块一一对应
export const MODULE_ART = {
  home: [
    { ico: 'PDF', title: '23 项 PDF 能力', sub: '合并 · 加密 · 页面 · 渲染' },
    { ico: 'AV', title: '18 项音视频', sub: '转码 · 剪辑 · GIF · 提音' },
    { ico: 'SEC', title: '16 项安全体检', sub: '端口 · 证书 · 配置审计' },
  ],
  image: [
    { ico: 'WM', title: '工作水印', sub: '7 套模板 · 可调方向' },
    { ico: 'ID', title: '证件照排版', sub: '10 种规格 · A4 直印' },
    { ico: 'IMG', title: '压缩与转换', sub: 'WebP / AVIF · 批量' },
  ],
  pdf: [
    { ico: 'MRG', title: '合并与拆分', sub: '按范围 / 每 N 页' },
    { ico: 'AES', title: 'AES-256 加密', sub: '权限位 · 口令保护' },
    { ico: 'PG', title: '页面组织', sub: '重排 · 旋转 · 拼版' },
  ],
  doc: [
    { ico: 'DOC', title: 'Word / Excel / PPT 转 PDF', sub: '15 项文档能力 · 免装 Office' },
    { ico: 'MD', title: 'Markdown 编辑器', sub: '实时预览 · 导出 HTML/PDF' },
    { ico: 'GW', title: '公文一键排版', sub: 'A4 · 仿宋三号 · 页码' },
  ],
  sheet: [
    { ico: 'XLS', title: '表格互转', sub: 'Excel ⇄ CSV ⇄ JSON' },
    { ico: 'TAB', title: '多表拆分', sub: '每个工作表单独输出' },
    { ico: 'API', title: '联调友好', sub: '对象数组 JSON' },
  ],
  ocr: [
    { ico: 'OCR', title: '中文识别', sub: 'tesseract + chi_sim' },
    { ico: 'PDF', title: '整本识别', sub: 'PDF 渲染后逐页 OCR' },
    { ico: 'TXT', title: '一键导出', sub: '复制 / 下载 TXT' },
  ],
  media: [
    { ico: 'MP4', title: '转码与压缩', sub: 'H.264 / H.265 · CRF' },
    { ico: 'GIF', title: '动图与抽帧', sub: '片段转 GIF / 封面' },
    { ico: 'AUD', title: '音轨处理', sub: '提取 · 转码 · 标准化' },
  ],
  net: [
    { ico: 'SCAN', title: '端口扫描', sub: '64 并发 · 预设清单' },
    { ico: 'TERM', title: 'SSH / Telnet', sub: '浏览器直连 · 多会话' },
    { ico: 'HDR', title: '响应头审计', sub: 'A–E 评级 · 修复建议' },
  ],
  history: [
    { ico: 'LOG', title: '任务流水', sub: '每次处理自动入库' },
    { ico: 'STT', title: '转写任务', sub: '离线队列 · 事后下载' },
    { ico: 'DB', title: '本地 MySQL', sub: '可筛选 · 可清空' },
  ],
  accounts: [
    { ico: 'ADM', title: '角色管理', sub: '管理员 / 普通用户' },
    { ico: 'KEY', title: '模块授权', sub: '按账户勾选可见模块' },
    { ico: 'LCK', title: '接口级拦截', sub: '越权请求直接 403' },
  ],
};

export const SKIP_SUITE = new Set(['pdf-split', 'pdf-img2pdf']);

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
