# 0.1.3 · 2026-10-20

> 主题：**文档模块对齐 gongjuheji.com/document 全部 16 项能力 + 音视频预览。**

## 新增 · 文档（15 项）

| 工具 | 端点 | 实现 |
| --- | --- | --- |
| Word 转 PDF | `/api/doc/word-to-pdf` | mammoth → HTML → Edge 打印 |
| Excel 转 PDF | `/api/doc/excel-to-pdf` | xlsx → 表格 HTML → Edge 打印 |
| PowerPoint 转 PDF | `/api/doc/pptx-to-pdf` | JSZip 解析 pptx，逐页文字 + 图片 → A4 横向 PDF |
| Markdown 转 PDF | `/api/doc/md-to-pdf` | marked → HTML → PDF |
| 文本转 PDF | `/api/doc/txt-to-pdf` | `<pre>` → PDF |
| HTML 转 Word | `/api/doc/html-to-docx` | turndown → OOXML DOCX（标题/列表/加粗） |
| Word 转 TXT | `/api/doc/word-to-txt` | mammoth extractRawText |
| Word 格式转换（批量） | `/api/doc/batch-convert` | 多文件 → TXT/HTML/MD/PDF，自动打包 |
| Markdown 转 HTML | `/api/doc/md-to-html` | 独立 HTML（内联样式） |
| 公文一键排版 | `/api/doc/gongwen` | 公文块识别 → DOCX(OOXML) + PDF |
| Markdown 表格生成器 | `/api/doc/md-table` | 行列 + 表头 + 列对齐 |
| Markdown 编辑器 | `/api/doc/md-render` / `#/md-editor` | 实时预览、导出 HTML/PDF/.md |
| Word 转 HTML / Word 转 Markdown / HTML 转 Markdown | 既有端点重命名与补齐 | turndown / mammoth |

图片转 PDF 继续由「图片合成 PDF」提供，覆盖参考站的 16 项。

## 新增 · 音视频预览
- `core/media.mjs`：`mountPlayer` / `createFilePreview`，支持 video/audio 自动识别、ObjectURL 生命周期管理、时长/分辨率/体积元信息
- 工具页选中文件后立即预览；结果卡片内嵌播放器；不支持的容器（MKV/AVI/FLV/WMV）给出转码提示

## 新增 · 库
- `src/lib/docops.mjs`：DOCX 直写（paragraphs/styles/footer PAGE 域/sectPr 页边距）、Markdown→块解析、PPTX 解析、公文块识别与 HTML 渲染、Markdown 表格生成、HTML 消毒
- `html2pdf.wrapHtml` 支持附加 CSS（横向 / 公文版式）

## 修复
- 工具页上传字段写死 `files`，导致所有 `upload.single('file')` 的单文件工具（PDF 拆分/页面/水印/压缩、文档类）返回 400 —— 现在按 `tool.field` 提交
- `/api/app` 的 `nativeToolCount` / `toolCount` 改为按实际目录计算（32 + 57 = 89）

## 测试
- `npm run smoke`：**132 / 132 通过**（新增 16 项文档断言，含错误类型被拒）
- 浏览器实测：文档 15 项卡片、Markdown 编辑器导出 HTML/PDF、表格生成器、公文排版输出 zip(docx+pdf)、音视频预览（MP4 0:03 320×240）与结果播放器、MP3 音频预览，控制台 0 报错
- 截图：`docbox/shots/v013-*.png`

## 已知问题
- PPTX 仅还原文字与图片，动画 / SmartArt / 图表不还原
- 旧版 .ppt / .doc 需另存为新格式
- 公文排版按「标题 + 一、（一）1. + 附件」启发式分段，复杂红头文件建议人工微调