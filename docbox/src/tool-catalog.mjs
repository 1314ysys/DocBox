/**
 * DocBox 工具清单（服务端）：PDF 套件、音视频套件、网络安全套件。
 * 前端通过 /api/app 读取，与自研图片/文档/表格工具共用同一套动态表单。
 * 字段类型：text | number | range | select | checkbox | textarea | color
 */

const PDF = (o) => ({ suite: 'pdf', accept: 'application/pdf', multiple: false, ...o });

export const PDF_TOOLS = [
  PDF({ id: 'pdf-rotate', name: 'PDF 旋转', cat: 'pdf', icon: 'rotate', desc: '整页顺时针旋转 90/180/270 度，扫描件摆正利器。',
    fields: [
      { name: 'angle', label: '旋转角度', type: 'select', value: '90', options: [['90', '顺时针 90°'], ['180', '180°'], ['270', '顺时针 270°']] },
      { name: 'pages', label: '应用页码', type: 'text', value: 'all', placeholder: 'all 或 1,3-5' },
    ] }),
  PDF({ id: 'pdf-remove-pages', name: 'PDF 删除页面', cat: 'pdf', icon: 'trash', desc: '按页码删除不需要的页面，支持 1,3,5-9 写法。',
    fields: [{ name: 'pages', label: '要删除的页面', type: 'text', value: '', placeholder: '例如 2,6-8' }] }),
  PDF({ id: 'pdf-rearrange', name: 'PDF 重排页面', cat: 'pdf', icon: 'pages', desc: '按给定顺序重排页面，未列出的页面按原顺序追加。',
    fields: [{ name: 'order', label: '新顺序', type: 'text', value: '', placeholder: '例如 3,1,2' }] }),
  PDF({ id: 'pdf-crop', name: 'PDF 裁剪', cat: 'pdf', icon: 'crop', desc: '按坐标裁掉页面留白，或自动识别内容边界。',
    fields: [
      { name: 'x', label: '左边距 pt', type: 'number', value: 20, min: 0 },
      { name: 'y', label: '上边距 pt', type: 'number', value: 20, min: 0 },
      { name: 'width', label: '裁剪宽度 pt', type: 'number', value: 0, min: 0, hint: '留 0 表示到页面右边缘' },
      { name: 'height', label: '裁剪高度 pt', type: 'number', value: 0, min: 0, hint: '留 0 表示到页面下边缘' },
      { name: 'pages', label: '应用页码', type: 'text', value: 'all' },
      { name: 'autoCrop', label: '自动裁掉白边', type: 'checkbox', value: 'true', checked: false },
    ] }),
  PDF({ id: 'pdf-scale', name: 'PDF 缩放 / 改纸', cat: 'pdf', icon: 'scale', desc: '按倍率缩放，或整体套到 A4/A3/Letter 纸张并居中。',
    fields: [
      { name: 'mode', label: '缩放方式', type: 'select', value: 'paper', options: [['paper', '套到纸张'], ['factor', '按倍率缩放']] },
      { name: 'paper', label: '目标纸张', type: 'select', value: 'a4', options: [['a4', 'A4'], ['a3', 'A3'], ['letter', 'Letter'], ['legal', 'Legal']] },
      { name: 'orientation', label: '方向', type: 'select', value: 'auto', options: [['auto', '跟随原页'], ['portrait', '纵向'], ['landscape', '横向']] },
      { name: 'factor', label: '倍率', type: 'number', value: 1.2, min: 0.2, max: 4, step: 0.1 },
      { name: 'pages', label: '应用页码', type: 'text', value: 'all' },
    ] }),
  PDF({ id: 'pdf-nup', name: 'PDF 多页拼版', cat: 'pdf', icon: 'grid', desc: '每张纸排 2/4/6/9/16 页，省纸打印。',
    fields: [
      { name: 'perSheet', label: '每页张数', type: 'select', value: '4', options: [['2', '2 张'], ['4', '4 张'], ['6', '6 张'], ['9', '9 张'], ['16', '16 张']] },
      { name: 'paper', label: '纸张', type: 'select', value: 'a4', options: [['a4', 'A4'], ['a3', 'A3'], ['letter', 'Letter']] },
      { name: 'orientation', label: '方向', type: 'select', value: 'portrait', options: [['portrait', '纵向'], ['landscape', '横向']] },
    ] }),
  PDF({ id: 'pdf-booklet', name: 'PDF 小册子', cat: 'pdf', icon: 'book', desc: '按“对折成册”的顺序重排页面，打印后中缝装订即可成册。',
    fields: [
      { name: 'paper', label: '纸张', type: 'select', value: 'a4', options: [['a4', 'A4'], ['a3', 'A3'], ['letter', 'Letter']] },
    ] }),
  PDF({ id: 'pdf-split', name: 'PDF 拆分', cat: 'pdf', icon: 'split', desc: '按每 N 页、自定义范围或固定段长拆分，每段一个文件。',
    fields: [
      { name: 'mode', label: '拆分方式', type: 'select', value: 'every', options: [['every', '每 N 页一个文件'], ['ranges', '按自定义范围'], ['sections', '按固定段长']] },
      { name: 'every', label: '每份页数', type: 'number', value: 1, min: 1 },
      { name: 'ranges', label: '页码范围', type: 'text', value: '', placeholder: '例如 1-2,3-5,6-9' },
      { name: 'size', label: '每段页数', type: 'number', value: 5, min: 1 },
    ] }),
  PDF({ id: 'pdf-overlay', name: 'PDF 叠加', cat: 'pdf', icon: 'layers', desc: '把一份 PDF（如带水印/印章的版本）叠加到正文上。', multiple: true,
    fields: [
      { name: 'pages', label: '叠加到页码', type: 'text', value: 'all' },
      { name: 'overlayPassword', label: '叠加文件密码', type: 'text', value: '', placeholder: '未加密留空' },
    ],
    filesHint: '第 1 个是正文，第 2 个是叠加层' }),
  PDF({ id: 'pdf-single-page', name: 'PDF 单页化', cat: 'pdf', icon: 'stack', desc: '把多页纵向拼成一张长页，适合滚动阅读或长图导出。',
    fields: [{ name: 'gap', label: '页间距 pt', type: 'number', value: 0, min: 0 }] }),
  PDF({ id: 'pdf-decompress', name: 'PDF 解压重写', cat: 'pdf', icon: 'archive', desc: '重写文档结构并移除对象流压缩，便于某些老工具读取。', fields: [] }),
  PDF({ id: 'pdf-flatten', name: 'PDF 表单扁平化', cat: 'pdf', icon: 'form', desc: '把可填写的表单字段固化为普通内容，防止误改。', fields: [] }),
  PDF({ id: 'pdf-remove-blanks', name: 'PDF 移除空白页', cat: 'pdf', icon: 'eraser', desc: '自动识别没有文字且近乎纯白的页面并移除。', fields: [] }),
  PDF({ id: 'pdf-encrypt', name: 'PDF 加密', cat: 'pdf', icon: 'lock', desc: 'AES-256 加密，可限制打印、复制、修改。',
    fields: [
      { name: 'userPassword', label: '打开密码', type: 'text', value: '', placeholder: '必填' },
      { name: 'ownerPassword', label: '权限密码', type: 'text', value: '', placeholder: '留空则同打开密码' },
      { name: 'algorithm', label: '算法', type: 'select', value: 'AES-256', options: [['AES-256', 'AES-256（推荐）'], ['AES-128', 'AES-128'], ['RC4-128', 'RC4-128（兼容老阅读器）']] },
      { name: 'allowPrinting', label: '允许打印', type: 'checkbox', value: 'true', checked: true },
      { name: 'allowCopying', label: '允许复制', type: 'checkbox', value: 'true', checked: false },
      { name: 'allowModifying', label: '允许修改', type: 'checkbox', value: 'true', checked: false },
      { name: 'allowAnnotating', label: '允许批注', type: 'checkbox', value: 'true', checked: false },
    ] }),
  PDF({ id: 'pdf-decrypt', name: 'PDF 解密', cat: 'pdf', icon: 'unlock', desc: '移除打开密码；需要提供正确密码。',
    fields: [{ name: 'password', label: '当前密码', type: 'text', value: '', placeholder: '未加密可留空' }] }),
  PDF({ id: 'pdf-sanitize', name: 'PDF 脱敏清理', cat: 'pdf', icon: 'shield', desc: '清除脚本、动作、附件、XMP 元数据与文档属性，防止信息泄露。', fields: [] }),
  PDF({ id: 'pdf-metadata', name: 'PDF 文档信息', cat: 'pdf', icon: 'info', desc: '读取页数、纸张、标题、作者、引擎与加密状态。', fields: [], mode: 'data' }),
  PDF({ id: 'pdf-set-metadata', name: 'PDF 改属性', cat: 'pdf', icon: 'form', desc: '修改标题、作者、主题、关键词等文档属性。',
    fields: [
      { name: 'title', label: '标题', type: 'text', value: '' },
      { name: 'author', label: '作者', type: 'text', value: '' },
      { name: 'subject', label: '主题', type: 'text', value: '' },
      { name: 'keywords', label: '关键词', type: 'text', value: '', placeholder: '用逗号分隔' },
    ] }),
  PDF({ id: 'pdf-pdf2img', name: 'PDF 转图片', cat: 'pdf', icon: 'image', desc: '逐页渲染为 PNG/JPG，可指定页面与 DPI。',
    fields: [
      { name: 'format', label: '格式', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpg', 'JPG']] },
      { name: 'dpi', label: '清晰度 DPI', type: 'select', value: '150', options: [['96', '96（快）'], ['150', '150（推荐）'], ['200', '200'], ['300', '300（高清）']] },
      { name: 'pages', label: '页码', type: 'text', value: 'all' },
    ] }),
  PDF({ id: 'pdf-pdf2text', name: 'PDF 转文本', cat: 'pdf', icon: 'text', desc: '提取文字层并保留分页标记；扫描件请用 OCR。',
    fields: [{ name: 'withPageMarkers', label: '保留分页标记', type: 'checkbox', value: 'true', checked: true }] }),
  PDF({ id: 'pdf-extract-images', name: 'PDF 提取图片', cat: 'pdf', icon: 'images', desc: '导出 PDF 内嵌的原始图片（最多 40 张）。', fields: [] }),
  PDF({ id: 'pdf-img2pdf', name: '图片合成 PDF', cat: 'pdf', icon: 'images', desc: '多张图片合成一份 PDF，可套 A4 纸或按图片尺寸。', accept: 'image/*', multiple: true,
    fields: [
      { name: 'pageSize', label: '纸张', type: 'select', value: 'a4', options: [['a4', 'A4'], ['a3', 'A3'], ['letter', 'Letter'], ['fit', '跟随图片']] },
      { name: 'margin', label: '页边距 pt', type: 'number', value: 0, min: 0 },
    ] }),
  PDF({ id: 'pdf-bookmarks', name: 'PDF 书签提取', cat: 'pdf', icon: 'bookmark', desc: '读取 PDF 目录结构，导出书签树。', fields: [], mode: 'data' }),
];

// ---------------------------------------------------------------- 音视频
const V = (o) => ({ suite: 'media', accept: 'video/*,audio/*', multiple: false, ...o });
const FORMAT_VIDEO = [['mp4', 'MP4 (H.264)'], ['mkv', 'MKV'], ['webm', 'WebM (VP9)'], ['mov', 'MOV']];
const FORMAT_AUDIO = [['mp3', 'MP3'], ['wav', 'WAV'], ['aac', 'AAC (m4a)'], ['flac', 'FLAC'], ['ogg', 'OGG (Vorbis)'], ['opus', 'Opus']];

export const MEDIA_TOOLS = [
  V({ id: 'media-convert', name: '视频转码', cat: 'video', icon: 'video', desc: '在 MP4 / MKV / WebM / MOV 之间互转，可选编码与质量。',
    fields: [
      { name: 'format', label: '目标格式', type: 'select', value: 'mp4', options: FORMAT_VIDEO },
      { name: 'crf', label: '质量 (CRF)', type: 'range', value: 23, min: 16, max: 32, step: 1, hint: '数值越小画质越好、体积越大' },
      { name: 'preset', label: '编码速度', type: 'select', value: 'medium', options: [['veryfast', '很快'], ['fast', '快'], ['medium', '标准'], ['slow', '慢（更小）']] },
    ] }),
  V({ id: 'media-compress', name: '视频压缩', cat: 'video', icon: 'compress', desc: '降分辨率 + 提高 CRF，快速减小视频体积。',
    fields: [
      { name: 'resolution', label: '分辨率上限', type: 'select', value: '720', options: [['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['original', '保持原分辨率']] },
      { name: 'crf', label: '压缩强度 (CRF)', type: 'range', value: 28, min: 20, max: 36, step: 1 },
    ] }),
  V({ id: 'media-extract-audio', name: '视频提取音频', cat: 'video', icon: 'audio', desc: '从视频中分离音轨并转成常用音频格式。',
    fields: [
      { name: 'format', label: '音频格式', type: 'select', value: 'mp3', options: FORMAT_AUDIO },
      { name: 'bitrate', label: '码率', type: 'select', value: '192', options: [['128', '128 kbps'], ['192', '192 kbps'], ['320', '320 kbps']] },
    ] }),
  V({ id: 'media-audio-convert', name: '音频转码', cat: 'audio', icon: 'audio', desc: 'MP3 / WAV / AAC / FLAC / OGG / Opus 互转，可调整码率与采样率。', accept: 'audio/*',
    fields: [
      { name: 'format', label: '目标格式', type: 'select', value: 'mp3', options: FORMAT_AUDIO },
      { name: 'bitrate', label: '码率', type: 'select', value: '192', options: [['96', '96 kbps'], ['128', '128 kbps'], ['192', '192 kbps'], ['320', '320 kbps']] },
      { name: 'samplerate', label: '采样率', type: 'select', value: 'keep', options: [['keep', '保持原样'], ['44100', '44.1 kHz'], ['48000', '48 kHz']] },
    ] }),
  V({ id: 'media-trim', name: '音视频剪辑', cat: 'video', icon: 'cut', desc: '按起止时间截取片段，精确到秒。',
    fields: [
      { name: 'start', label: '开始时间（秒）', type: 'number', value: 0, min: 0, step: 0.1 },
      { name: 'end', label: '结束时间（秒）', type: 'number', value: 10, min: 0, step: 0.1, hint: '留 0 表示到结尾' },
      { name: 'reencode', label: '精确剪切（重新编码）', type: 'checkbox', value: 'true', checked: true },
    ] }),
  V({ id: 'media-merge', name: '音视频合并', cat: 'video', icon: 'merge', desc: '把多段同规格的音视频按顺序拼接成一个文件。', multiple: true,
    fields: [{ name: 'format', label: '输出格式', type: 'select', value: 'mp4', options: [...FORMAT_VIDEO, ...FORMAT_AUDIO] }] }),
  V({ id: 'media-gif', name: '视频转 GIF', cat: 'video', icon: 'gif', desc: '生成高质量调色板 GIF，可限制时长与宽度。',
    fields: [
      { name: 'fps', label: '帧率', type: 'select', value: '12', options: [['8', '8 fps'], ['12', '12 fps'], ['15', '15 fps'], ['20', '20 fps']] },
      { name: 'width', label: '宽度 px', type: 'number', value: 480, min: 120, max: 1280 },
      { name: 'start', label: '开始（秒）', type: 'number', value: 0, min: 0 },
      { name: 'duration', label: '时长（秒）', type: 'number', value: 5, min: 0.5, max: 60 },
    ] }),
  V({ id: 'media-frame', name: '视频截帧', cat: 'video', icon: 'camera', desc: '在指定时间点截取一张高清画面。',
    fields: [
      { name: 'time', label: '时间点（秒）', type: 'number', value: 0, min: 0, step: 0.1 },
      { name: 'format', label: '图片格式', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpg', 'JPG']] },
    ] }),
  V({ id: 'media-resize', name: '视频改尺寸', cat: 'video', icon: 'scale', desc: '按宽度等比缩放，或指定精确分辨率。',
    fields: [
      { name: 'width', label: '宽度 px', type: 'number', value: 1280, min: 64 },
      { name: 'height', label: '高度 px', type: 'number', value: 0, min: 0, hint: '留 0 自动等比' },
    ] }),
  V({ id: 'media-speed', name: '变速播放', cat: 'video', icon: 'speed', desc: '0.25×～4× 变速，音调自动补偿。',
    fields: [{ name: 'factor', label: '速度倍率', type: 'range', value: 1.5, min: 0.25, max: 4, step: 0.25 }] }),
  V({ id: 'media-volume', name: '音量调整', cat: 'audio', icon: 'volume', desc: '增益或响度标准化（loudnorm）。', accept: 'video/*,audio/*',
    fields: [
      { name: 'mode', label: '处理方式', type: 'select', value: 'normalize', options: [['normalize', '响度标准化 (-16 LUFS)'], ['gain', '固定增益']] },
      { name: 'gain', label: '增益 dB', type: 'number', value: 6, min: -30, max: 30 },
    ] }),
  V({ id: 'media-mute', name: '去除音轨', cat: 'video', icon: 'mute', desc: '静音视频（移除音轨，体积更小）。', fields: [] }),
  V({ id: 'media-rotate', name: '视频旋转 / 翻转', cat: 'video', icon: 'rotate', desc: '旋转 90/180/270 度或左右/上下翻转。',
    fields: [{ name: 'mode', label: '方向', type: 'select', value: 'cw90', options: [['cw90', '顺时针 90°'], ['ccw90', '逆时针 90°'], ['180', '180°'], ['flipH', '左右镜像'], ['flipV', '上下翻转']] }] }),
  V({ id: 'media-watermark', name: '视频水印', cat: 'video', icon: 'watermark', desc: '在视频上叠加文字水印，可调位置与透明度。', multiple: true,
    fields: [
      { name: 'text', label: '水印文字', type: 'text', value: '内部资料 请勿外传' },
      { name: 'position', label: '位置', type: 'select', value: 'br', options: [['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下'], ['center', '居中']] },
      { name: 'opacity', label: '透明度', type: 'range', value: 0.35, min: 0.05, max: 1, step: 0.05 },
      { name: 'fontsize', label: '字号', type: 'number', value: 32, min: 10, max: 120 },
    ],
    filesHint: '第 1 个是视频，第 2 个可选（图片水印）' }),
  V({ id: 'media-slideshow', name: '图片转视频', cat: 'video', icon: 'slideshow', desc: '多张图片轮播生成 MP4，可设每张时长与转场。', accept: 'image/*', multiple: true,
    fields: [
      { name: 'duration', label: '每张时长（秒）', type: 'number', value: 2, min: 0.5, max: 30, step: 0.5 },
      { name: 'width', label: '宽度 px', type: 'number', value: 1280, min: 128 },
    ] }),
  V({ id: 'media-fade', name: '淡入淡出', cat: 'video', icon: 'fade', desc: '为开头和结尾添加淡入淡出效果。',
    fields: [
      { name: 'type', label: '类型', type: 'select', value: 'both', options: [['both', '视频 + 音频'], ['video', '仅视频'], ['audio', '仅音频']] },
      { name: 'duration', label: '时长（秒）', type: 'number', value: 1.5, min: 0.2, max: 10, step: 0.1 },
    ] }),
  V({ id: 'media-probe', name: '媒体信息', cat: 'video', icon: 'info', desc: '读取时长、分辨率、码率、编码、音轨等详细参数。', accept: 'video/*,audio/*', mode: 'upload-data' }),
  V({ id: 'media-strip-meta', name: '清除媒体元数据', cat: 'video', icon: 'shield', desc: '移除拍摄设备、GPS、创建时间等元数据。', fields: [] }),
];

// ---------------------------------------------------------------- 网络安全
const N = (o) => ({ suite: 'net', accept: null, multiple: false, mode: 'data', ...o });

export const NET_TOOLS = [
  N({ id: 'net-dns', name: 'DNS 查询', cat: 'net', icon: 'dns', desc: '查询 A/AAAA/MX/TXT/NS/CNAME/SOA 记录。',
    fields: [
      { name: 'host', label: '域名', type: 'text', value: 'example.com', placeholder: 'example.com' },
      { name: 'types', label: '记录类型', type: 'text', value: 'A,AAAA,MX,TXT,NS,CNAME', placeholder: 'A,AAAA,MX' },
    ] }),
  N({ id: 'net-portscan', name: '端口扫描', cat: 'net', icon: 'scan', desc: 'TCP 连接探测常用端口，识别开放服务。仅限自有资产。',
    fields: [
      { name: 'host', label: '目标主机', type: 'text', value: '127.0.0.1' },
      { name: 'mode', label: '端口范围', type: 'select', value: 'top100', options: [['web', '常用 Web 端口'], ['top100', 'Top 100'], ['top1000', 'Top 1000'], ['custom', '自定义']] },
      { name: 'ports', label: '自定义端口', type: 'text', value: '', placeholder: '例如 80,443,8080-8090' },
      { name: 'timeout', label: '超时 ms', type: 'number', value: 600, min: 100, max: 5000 },
    ] }),
  N({ id: 'net-ping', name: '连通性测试', cat: 'net', icon: 'ping', desc: 'ICMP ping + 常用端口 TCP 握手测试。',
    fields: [
      { name: 'host', label: '目标主机', type: 'text', value: '127.0.0.1' },
      { name: 'count', label: '次数', type: 'number', value: 4, min: 1, max: 10 },
    ] }),
  N({ id: 'net-traceroute', name: '路由追踪', cat: 'net', icon: 'route', desc: '追踪到目标的网络路径与各跳延迟（tracert）。',
    fields: [
      { name: 'host', label: '目标主机', type: 'text', value: 'www.baidu.com' },
      { name: 'maxHops', label: '最大跳数', type: 'number', value: 15, min: 3, max: 30 },
    ] }),
  N({ id: 'net-headers', name: 'HTTP 头与安全审计', cat: 'net', icon: 'shield', desc: '抓取响应头并评估 CSP/HSTS/X-Frame-Options 等安全策略。',
    fields: [{ name: 'url', label: 'URL', type: 'text', value: 'https://example.com' }] }),
  N({ id: 'net-tls', name: 'TLS 证书检查', cat: 'net', icon: 'cert', desc: '检查证书链、颁发者、到期时间、SAN 与协议版本。',
    fields: [
      { name: 'host', label: '域名', type: 'text', value: 'example.com' },
      { name: 'port', label: '端口', type: 'number', value: 443, min: 1, max: 65535 },
    ] }),
  N({ id: 'net-rdap', name: 'WHOIS / RDAP', cat: 'net', icon: 'whois', desc: '直连权威 RDAP 服务器（IANA 引导表内置）+ WHOIS 43 兜底，查过的结果本地缓存 24 小时，不经过任何第三方代理。',
    fields: [
      { name: 'query', label: '域名或 IP', type: 'text', value: 'example.com' },
      { name: 'server', label: 'WHOIS 服务器（可选，自动探测）', type: 'text', value: '' },
      { name: 'fresh', label: '忽略本地缓存', type: 'checkbox', value: false },
    ] }),
  N({ id: 'net-redirect', name: '重定向追踪', cat: 'net', icon: 'redirect', desc: '逐跳跟踪 3xx 跳转与最终落地地址。',
    fields: [{ name: 'url', label: 'URL', type: 'text', value: 'http://example.com' }] }),
  N({ id: 'net-timing', name: '访问性能拆解', cat: 'net', icon: 'speed', desc: '拆分 DNS / TCP / TLS / 首字节 / 总耗时。',
    fields: [{ name: 'url', label: 'URL', type: 'text', value: 'https://example.com' }] }),
  N({ id: 'net-dirs', name: '常见路径探测', cat: 'net', icon: 'folder', desc: '探测常见后台/配置文件路径是否存在（只读 GET）。',
    fields: [
      { name: 'url', label: '站点根地址', type: 'text', value: 'https://example.com' },
      { name: 'preset', label: '字典', type: 'select', value: 'common', options: [['common', '常见 24 条'], ['admin', '后台相关'], ['leak', '敏感文件']] },
    ] }),
  N({ id: 'net-methods', name: 'HTTP 方法探测', cat: 'net', icon: 'method', desc: '检测站点允许的 HTTP 方法，识别危险方法暴露。',
    fields: [{ name: 'url', label: 'URL', type: 'text', value: 'https://example.com' }] }),
  N({ id: 'net-banner', name: '服务指纹识别', cat: 'net', icon: 'fingerprint', desc: '连接目标端口读取 Banner，识别服务与版本。',
    fields: [
      { name: 'host', label: '主机', type: 'text', value: '127.0.0.1' },
      { name: 'port', label: '端口', type: 'number', value: 3000, min: 1, max: 65535 },
    ] }),
  N({ id: 'net-local', name: '本机网络信息', cat: 'net', icon: 'network', desc: '本机网卡、网关、DNS、ARP 邻居表与监听端口。', fields: [] }),
  N({ id: 'net-subdomain', name: '子域名枚举', cat: 'net', icon: 'subdomain', desc: '本地字典 DNS 爆破为主（全程不依赖第三方接口），可选叠加证书透明日志补充；带泛解析识别与本地缓存。',
    fields: [
      { name: 'domain', label: '域名', type: 'text', value: 'example.com' },
      { name: 'mode', label: '来源', type: 'select', value: 'dict', options: [['dict', '本地字典（推荐）'], ['ct', '证书日志（不碰目标）'], ['both', '两者都要']] },
      { name: 'size', label: '字典条数', type: 'select', value: '600', options: [['200', '前 200 条（快）'], ['600', '全部内置（约 600）'], ['2000', '2000 条（含自备字典）']] },
      { name: 'threads', label: '并发数', type: 'number', value: 40, min: 4, max: 200 },
      { name: 'dns', label: 'DNS 服务器（可选，如 223.5.5.5）', type: 'text', value: '' },
      { name: 'fresh', label: '忽略本地缓存', type: 'checkbox', value: false },
    ] }),
  N({ id: 'net-headers-gen', name: '安全头配置生成', cat: 'net', icon: 'code', desc: '按站点类型生成 Nginx / Apache 安全响应头配置。',
    fields: [
      { name: 'server', label: '服务器', type: 'select', value: 'nginx', options: [['nginx', 'Nginx'], ['apache', 'Apache']] },
      { name: 'strict', label: '严格模式（HSTS 预加载）', type: 'checkbox', value: 'true', checked: true },
    ] }),
  N({ id: 'net-ip-info', name: 'IP 归属查询', cat: 'net', icon: 'globe', desc: '查询 IP 的 ASN、所属网络与地理位置（RDAP）。',
    fields: [{ name: 'ip', label: 'IP 地址', type: 'text', value: '8.8.8.8' }] }),
];

export const SUITE_TOOLS = { pdf: PDF_TOOLS, media: MEDIA_TOOLS, net: NET_TOOLS };
export const ALL_SUITE_TOOLS = [...PDF_TOOLS, ...MEDIA_TOOLS, ...NET_TOOLS];
export const TOOL_BY_ID = new Map(ALL_SUITE_TOOLS.map((t) => [t.id, t]));
