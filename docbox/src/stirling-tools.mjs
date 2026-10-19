/**
 * Stirling-PDF 工具清单（DocBox 与 Stirling 的唯一事实来源）。
 * 前端通过 /api/stirling/tools 读取，后端用同一份清单做代理白名单与路径映射。
 * 字段类型：text | number | range | select | checkbox | color | textarea
 */
export const STIRLING_CATS = {
  pdf: { name: 'PDF 工具箱', desc: '页面组织、裁剪缩放、合并拆分与页面增强' },
  security: { name: 'PDF 安全', desc: '加密解密、脱敏、清理与元数据' },
  convert: { name: '格式转换', desc: 'PDF ↔ 图片 / 文本，以及图片合成 PDF' },
};

export const STIRLING_TOOLS = [
  // ---------------------------------------------------------------- 页面组织
  {
    id: 'stirling-rotate', name: 'PDF 旋转', cat: 'pdf', icon: 'rotate',
    desc: '整份文档顺时针旋转 90/180/270 度，扫描件摆正利器。',
    path: '/general/rotate-pdf', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_rotated' },
    fields: [
      { name: 'angle', label: '旋转角度', type: 'select', value: '90', options: [['90', '顺时针 90°'], ['180', '180°'], ['270', '顺时针 270°']] },
    ],
  },
  {
    id: 'stirling-remove-pages', name: 'PDF 删除页面', cat: 'pdf', icon: 'trash',
    desc: '按页码删除不需要的页面，支持 1,3,5-9 写法。',
    path: '/general/remove-pages', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_removed' },
    fields: [
      { name: 'pageNumbers', label: '要删除的页面', type: 'text', value: '', placeholder: '例如 2,6-8' },
    ],
  },
  {
    id: 'stirling-rearrange', name: 'PDF 重排页面', cat: 'pdf', icon: 'pages',
    desc: '按你给定的顺序重新排列页面，例如 3,1,2。',
    path: '/general/rearrange-pages', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_reordered' },
    fields: [
      { name: 'pageNumbers', label: '新顺序', type: 'text', value: '', placeholder: '例如 3,1,2；留空保持原顺序' },
      { name: 'customMode', label: '严格模式', type: 'checkbox', value: '', checked: false, hint: '勾选后页码列表必须完整覆盖所有页面' },
    ],
  },
  {
    id: 'stirling-crop', name: 'PDF 裁剪', cat: 'pdf', icon: 'crop',
    desc: '按坐标裁掉页面留白或边缘，支持自动裁剪。',
    path: '/general/crop', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_cropped' },
    fields: [
      { name: 'x', label: '左边距 pt', type: 'number', value: 20, min: 0 },
      { name: 'y', label: '上边距 pt', type: 'number', value: 20, min: 0 },
      { name: 'width', label: '裁剪宽度 pt', type: 'number', value: 0, min: 0, hint: '留 0 表示从左边距到页面右边缘' },
      { name: 'height', label: '裁剪高度 pt', type: 'number', value: 0, min: 0, hint: '留 0 表示从上边距到页面下边缘' },
      { name: 'pageNumbers', label: '应用页码', type: 'text', value: 'all', placeholder: 'all 或 1,3-5' },
      { name: 'autoCrop', label: '自动裁掉白边', type: 'checkbox', value: '', checked: false },
    ],
  },
  {
    id: 'stirling-scale', name: 'PDF 缩放/改纸张', cat: 'pdf', icon: 'resize',
    desc: '把整份文档统一成 A4/A3 等纸张，或按比例缩放内容。',
    path: '/general/scale-pages', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_scaled' },
    fields: [
      { name: 'pageSize', label: '目标纸张', type: 'select', value: 'A4', options: [['A4', 'A4'], ['A3', 'A3'], ['A5', 'A5'], ['LETTER', 'Letter'], ['LEGAL', 'Legal'], ['KEEP', '保持原尺寸']] },
      { name: 'orientation', label: '方向', type: 'select', value: 'PORTRAIT', options: [['PORTRAIT', '纵向'], ['LANDSCAPE', '横向']] },
      { name: 'scaleFactor', label: '内容缩放', type: 'number', value: 1, min: 0.1, max: 5, step: 0.1 },
    ],
  },
  {
    id: 'stirling-nup', name: '多页合一（N-up）', cat: 'pdf', icon: 'grid',
    desc: '把 2/4/9/16 页拼到一张纸上，打印省纸或做讲义。',
    path: '/general/multi-page-layout', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_nup' },
    fields: [
      { name: 'pagesPerSheet', label: '每张页数', type: 'select', value: '2', options: [['2', '2 页合一'], ['4', '4 页合一'], ['9', '9 页合一'], ['16', '16 页合一']] },
      { name: 'mode', label: '排版模式', type: 'select', value: 'DEFAULT', options: [['DEFAULT', '按每张页数自动'], ['CUSTOM', '自定义行列']] },
      { name: 'arrangement', label: '排列方式', type: 'select', value: 'BY_ROWS', options: [['BY_ROWS', '按行填充'], ['BY_COLUMNS', '按列填充']] },
      { name: 'readingDirection', label: '阅读方向', type: 'select', value: 'LTR', options: [['LTR', '从左到右'], ['RTL', '从右到左']] },
      { name: 'addBorder', label: '页面加边框', type: 'checkbox', value: '', checked: false },
      { name: 'innerMargin', label: '页间距 pt', type: 'number', value: 0, min: 0 },
    ],
  },
  {
    id: 'stirling-booklet', name: '小册子排版', cat: 'pdf', icon: 'book',
    desc: '按书籍折页顺序重排，双面打印后对折即成小册子。',
    path: '/general/booklet-imposition', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_booklet' },
    fields: [
      { name: 'pagesPerSheet', label: '每张页数', type: 'select', value: '2', options: [['2', '2 页/张'], ['4', '4 页/张']] },
      { name: 'addBorder', label: '加边框', type: 'checkbox', value: '', checked: true },
      { name: 'doubleSided', label: '双面打印', type: 'checkbox', value: '', checked: true },
    ],
  },
  {
    id: 'stirling-sections', name: '页面切割（PDF 切片）', cat: 'pdf', icon: 'split',
    desc: '把一页横向/纵向切成多块，适合长图、拼接扫描件。',
    path: '/general/split-pdf-by-sections', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_sections' },
    fields: [
      { name: 'horizontalDivisions', label: '纵向切几刀', type: 'number', value: 1, min: 1, max: 20 },
      { name: 'verticalDivisions', label: '横向切几刀', type: 'number', value: 2, min: 1, max: 20 },
      { name: 'merge', label: '合并成一个 PDF', type: 'checkbox', value: '', checked: true },
      { name: 'splitMode', label: '切分模式', type: 'select', value: 'CUSTOM', options: [['CUSTOM', '自定义'], ['SPLIT_ALL', '每页都切'], ['SPLIT_ALL_EXCEPT_FIRST', '跳过首页'], ['SPLIT_ALL_EXCEPT_LAST', '跳过末页']] },
    ],
  },
  {
    id: 'stirling-overlay', name: 'PDF 叠加/水印合成', cat: 'pdf', icon: 'layers',
    desc: '把一份 PDF 逐页叠到另一份上，做信纸、背景或骑缝。',
    path: '/general/overlay-pdfs', accept: 'application/pdf', multiple: true,
    out: { ext: 'pdf', suffix: '_overlay' },
    fileField: 'fileInput', extraFiles: [{ field: 'overlayFiles', label: '叠加用的 PDF', multiple: true }],
    fields: [
      { name: 'overlayMode', label: '叠加模式', type: 'select', value: 'SequentialOverlay', options: [['SequentialOverlay', '顺序叠加'], ['InterleavedOverlay', '交错叠加'], ['FixedRepeatOverlay', '固定重复']] },
      { name: 'overlayPosition', label: '图层位置', type: 'select', value: '0', options: [['1', '作为背景'], ['0', '作为前景']] },
    ],
  },
  {
    id: 'stirling-singlepage', name: '长图（单页拼合）', cat: 'pdf', icon: 'layers',
    desc: '把多页竖向拼成一张超长页面，方便做长图分享。',
    path: '/general/pdf-to-single-page', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_singlepage' },
    fields: [],
  },
  {
    id: 'stirling-decompress', name: 'PDF 解压（还原对象流）', cat: 'pdf', icon: 'unlock',
    desc: '把压缩的对象流展开，便于二次编辑或排查。',
    path: '/misc/decompress-pdf', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_decompressed' },
    fields: [],
  },
  {
    id: 'stirling-flatten', name: 'PDF 展平', cat: 'pdf', icon: 'flatten',
    desc: '把表单、批注与图层压成静态内容，防止被二次修改。',
    path: '/misc/flatten', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_flattened' },
    fields: [
      { name: 'flattenOnlyForms', label: '只展平表单', type: 'checkbox', value: 'true', checked: false },
      { name: 'renderDpi', label: '渲染 DPI', type: 'number', value: 150, min: 72, max: 600 },
    ],
  },
  {
    id: 'stirling-remove-blanks', name: '删除空白页', cat: 'pdf', icon: 'trash',
    desc: '自动识别并删除扫描件里的空白页。',
    path: '/misc/remove-blanks', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_noblank' },
    fields: [
      { name: 'threshold', label: '空白阈值', type: 'range', value: 10, min: 0, max: 100, suffix: '%' },
      { name: 'whitePercent', label: '白色像素占比', type: 'range', value: 99, min: 50, max: 100, suffix: '%' },
    ],
  },

  // ------------------------------------------------------------------- 安全
  {
    id: 'stirling-encrypt', name: 'PDF 加密', cat: 'security', icon: 'lock',
    desc: '为文档设置打开密码与权限（打印、复制、修改）。',
    path: '/security/add-password', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_encrypted' },
    fields: [
      { name: 'password', label: '打开密码', type: 'text', value: '', required: true },
      { name: 'ownerPassword', label: '权限密码（可选）', type: 'text', value: '' },
      { name: 'keyLength', label: '密钥长度', type: 'select', value: '256', options: [['256', 'AES-256（推荐）'], ['128', 'AES-128'], ['40', 'RC4-40（兼容旧版）']] },
      { name: 'preventPrinting', label: '禁止打印', type: 'checkbox', value: 'true', checked: false },
      { name: 'preventExtractContent', label: '禁止复制内容', type: 'checkbox', value: 'true', checked: false },
      { name: 'preventModify', label: '禁止修改', type: 'checkbox', value: 'true', checked: false },
    ],
  },
  {
    id: 'stirling-decrypt', name: 'PDF 解密', cat: 'security', icon: 'unlock',
    desc: '输入密码移除打开限制（需知道原密码）。',
    path: '/security/remove-password', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_decrypted' },
    fields: [
      { name: 'password', label: '当前密码', type: 'text', value: '', required: true },
    ],
  },
  {
    id: 'stirling-sanitize', name: 'PDF 清理消毒', cat: 'security', icon: 'shield',
    desc: '移除脚本、嵌入文件、链接、元数据，适合对外发送前净化。',
    path: '/security/sanitize-pdf', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_sanitized' },
    fields: [
      { name: 'removeJavaScript', label: '移除 JavaScript', type: 'checkbox', value: 'true', checked: true },
      { name: 'removeEmbeddedFiles', label: '移除嵌入文件', type: 'checkbox', value: 'true', checked: true },
      { name: 'removeMetadata', label: '移除文档信息', type: 'checkbox', value: 'true', checked: true },
      { name: 'removeXMPMetadata', label: '移除 XMP 元数据', type: 'checkbox', value: 'true', checked: true },
      { name: 'removeLinks', label: '移除超链接', type: 'checkbox', value: 'true', checked: false },
      { name: 'removeFonts', label: '移除字体', type: 'checkbox', value: 'true', checked: false },
    ],
  },
  {
    id: 'stirling-metadata', name: '修改文档信息', cat: 'security', icon: 'tag',
    desc: '设置标题、作者、主题、关键词、创建时间。',
    path: '/misc/update-metadata', accept: 'application/pdf', multiple: false,
    out: { ext: 'pdf', suffix: '_meta' },
    fields: [
      { name: 'title', label: '标题', type: 'text', value: '' },
      { name: 'author', label: '作者', type: 'text', value: '' },
      { name: 'subject', label: '主题', type: 'text', value: '' },
      { name: 'keywords', label: '关键词', type: 'text', value: '', placeholder: '逗号分隔' },
      { name: 'creator', label: '创建工具', type: 'text', value: '' },
      { name: 'deleteAll', label: '先清空原有信息', type: 'checkbox', value: 'true', checked: false },
    ],
  },
  {
    id: 'stirling-info', name: 'PDF 信息检测', cat: 'security', icon: 'info',
    desc: '读取页数、版本、文件大小等基本信息（JSON 输出）。',
    path: '/analysis/basic-info', accept: 'application/pdf', multiple: false,
    out: { ext: 'json', suffix: '_info' },
    fields: [],
  },

  // ------------------------------------------------------------------- 转换
  {
    id: 'stirling-pdf2img', name: 'PDF 转图片（ZIP）', cat: 'convert', icon: 'layers',
    desc: '整份 PDF 逐页导出 PNG，自动打包 ZIP（服务端渲染）。',
    path: '/convert/pdf/img', accept: 'application/pdf', multiple: false,
    out: { ext: 'zip', suffix: '_images' },
    fields: [
      { name: 'imageFormat', label: '图片格式', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] },
      { name: 'dpi', label: '清晰度 DPI', type: 'select', value: '150', options: [['72', '72（屏幕）'], ['150', '150（推荐）'], ['300', '300（打印）']] },
      { name: 'singleOrMultiple', label: '输出方式', type: 'select', value: 'multiple', options: [['multiple', '逐页多个文件（ZIP）'], ['single', '全部合成一张长图']] },
    ],
  },
  {
    id: 'stirling-pdf2text', name: 'PDF 提取文本', cat: 'convert', icon: 'text',
    desc: '整份文档抽取纯文本，保留基本换行。',
    path: '/convert/pdf/text', accept: 'application/pdf', multiple: false,
    out: { ext: 'txt', suffix: '_text', mime: 'text/plain; charset=utf-8' },
    fields: [
      { name: 'outputFormat', label: '输出格式', type: 'select', value: 'txt', options: [['txt', 'TXT'], ['rtf', 'RTF']] },
    ],
  },
  {
    id: 'stirling-extract-images', name: '提取 PDF 内嵌图片', cat: 'convert', icon: 'image',
    desc: '把文档里嵌入的位图原样提取出来（ZIP）。',
    path: '/misc/extract-images', accept: 'application/pdf', multiple: false,
    out: { ext: 'zip', suffix: '_embedded' },
    fields: [
      { name: 'format', label: '输出格式', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPG'], ['gif', 'GIF']] },
    ],
  },
  {
    id: 'stirling-img2pdf', name: '图片合成 PDF', cat: 'convert', icon: 'imagePdf',
    desc: '多张图片按顺序合成 PDF，自动适配页面。',
    path: '/convert/img/pdf', accept: 'image/*', multiple: true,
    out: { ext: 'pdf', suffix: '_images' },
    fields: [
      { name: 'fitOption', label: '页面适配', type: 'select', value: 'fitDocumentToImage', options: [['fitDocumentToImage', '页面跟随图片'], ['fitImageToDocument', '图片适应 A4'], ['stretchImageToDocument', '拉伸铺满']] },
      { name: 'colorType', label: '色彩', type: 'select', value: 'color', options: [['color', '彩色'], ['greyscale', '灰度'], ['blackwhite', '黑白']] },
      { name: 'autoRotate', label: '按图片方向自动旋转页面', type: 'checkbox', value: 'true', checked: false },
    ],
  },
  {
    id: 'stirling-bookmarks', name: '提取书签/目录', cat: 'convert', icon: 'book',
    desc: '导出 PDF 书签树为 JSON，便于核对目录结构。',
    path: '/general/extract-bookmarks', accept: 'application/pdf', multiple: false,
    fileField: 'file',
    out: { ext: 'json', suffix: '_bookmarks' },
    fields: [],
  },
];

export const STIRLING_BY_ID = Object.fromEntries(STIRLING_TOOLS.map((t) => [t.id, t]));

/** Stirling 在此 Windows 部署下不可用的能力（官方 JAR 只带 linux-x64 原生库 / 缺少外部依赖）。 */
export const STIRLING_UNAVAILABLE = [
  { name: 'PDF 合并（Stirling 端）', reason: 'jpdfium 原生库缺失（官方 JAR 仅含 linux-x64），DocBox 自动改用本地引擎' },
  { name: 'PDF 按页拆分（Stirling 端）', reason: '同上，DocBox 自动改用本地引擎' },
  { name: 'PDF 转 Word / Excel / PPT', reason: '缺少 LibreOffice，Stirling 已关闭该接口' },
  { name: 'OCR 文本识别（Stirling 端）', reason: '缺少 Tesseract，已由 DocBox 内置 tesseract.js 提供' },
  { name: '扫描件 OCR / 自动纠偏', reason: 'Stirling 接口在当前配置下被禁用' },
  { name: 'PDF/A 转换、修复', reason: '当前 Stirling 配置禁用' },
];
