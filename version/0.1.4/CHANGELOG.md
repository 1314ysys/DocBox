# 0.1.4 · 2026-10-20

> 主题：**所有带文件的工具都加上预览，结果是文件也能直接看。**

## 新增

### 输入预览（新增 core/preview.mjs）
- 图片：多图缩略图网格（最多 8 张，点击新标签放大）
- PDF：pdf.js 客户端渲染首页缩略图 + 页数（多文件工具渲染前 2 个），超过 80MB 跳过
- 音视频：复用播放器，显示格式 / 体积 / 时长 / 分辨率，不支持的容器提示转码
- Word / Excel / PPT：`POST /api/preview/document` → 文本 / 表格（多工作表）/ 分页要点
- Markdown / TXT / HTML / CSV / JSON：FileReader 读取前 120KB，预览 2400 字
- 其它类型：给出「可直接运行工具查看结果」提示

### 结果预览
- `POST /api/preview/output`：只接受 `/files/...` 地址，解析后返回 text / table / slides / pdf
- PDF 结果卡片渲染首页缩略图；Word 结果显示文本、Excel 显示表格、TXT/MD 显示文本
- 图片与音视频结果保持原有缩略图与播放器

### 其它
- OCR 页增加 `#ocrPreview`：选图 / 选 PDF 后先看缩略图
- 预览按 token 防竞态：快速换文件时旧渲染结果会被丢弃
- ObjectURL 统一回收，避免内存泄漏

## 安全
- `/api/preview/output` 校验路径必须在输出目录内，`/files` 之外的地址一律 400
- 预览接口需要登录（受全局 requireAuth 保护），不做模块限制（只解析调用者自己上传/生成的文件）

## 测试
- `npm run smoke`：**143 / 143 通过**（新增 11 项预览断言：docx/xlsx/pptx/md 解析、输出文件预览、非法地址被拒）
- 浏览器实测：图片 2 张缩略图、PDF 4 页取 2 页缩略图、docx 文本、xlsx 表格、pptx 2 页要点、md/txt 文本、结果 PDF/Word/TXT 预览、OCR 缩略图、音视频播放器，控制台 0 报错
- 截图：`docbox/shots/v014-*.png`

## 已知问题
- PPTX 预览只列文字要点，不还原版式
- 大文件（PDF > 80MB）跳过缩略图