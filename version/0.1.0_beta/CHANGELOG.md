# 变更记录

## 0.1.0_beta — 2026-10-20

首个基线版本，对应 git tag `v0.1.0_beta`。

### 新增

**水印（核心）**
- 全新水印引擎 `src/lib/watermark.mjs`：信息卡（深色渐变 + 主色竖条 + 行式排版）与全图透明水印两套渲染器。
- 7 套模板（`src/watermark-templates.mjs`，前后端共用）：
  建筑施工、销售外勤、物业管理、酒店餐饮、快递物流、环境卫生、透明全图水印。
- 实时预览（首张图）、批量套用、Logo 上传、位置/缩放/透明度/主色可调。
- 透明水印支持多行文字、方向 -90°~90°、透明度 4%~70%、行间距、字号、颜色、平铺/单条；平铺按网格铺满整图并支持错位。
- 水印参数按模板持久化到 `localStorage`，可一键恢复默认；证件场景内置 4 个文字预设。

**OCR**
- 新增 `/api/ocr/image`、`/api/ocr/batch`，基于 tesseract.js v7 + 本地 `chi_sim` 语言包，完全离线。
- OCR 在独立子进程运行（`src/ocr-worker.mjs`），识别完即退出，避免主服务常驻 WASM 内存；请求串行排队。
- 新增 OCR 视图：图片批量识别、整本 PDF 识别（前端 PDF.js 渲染 → 分批识别）、置信度/字数、复制与 TXT 导出。
- 自动合并中文识别结果中的字间空格。

**Stirling-PDF 融合**
- 新增 `src/lib/stirling.mjs` 客户端与 `src/routes/stirling.mjs` 通用代理：按 23 项清单白名单校验、补齐默认参数、映射导出扩展名。
- PDF 合并 / 拆分 / 水印 / 页码 / 压缩改为“Stirling 优先、失败自动回退本地引擎”，响应中标注实际引擎。
- 按路由维度做 5 分钟熔断，单个接口故障不会拖累其它接口。
- 首页新增“Stirling 专业套件”分类，23 项工具复用统一工具页与动态表单。

**前端**
- `app.js` 拆分为原生 ES 模块：`js/core/*`（dom/api/ui/store/files/fields/results）、`js/tools/catalog.mjs`、`js/views/*`（home/tool/watermark/idphoto/editor/extract/ocr）。
- 新增文件列表拖拽排序、单条移除、拖入上传。
- 首页工具卡片由服务端能力清单动态生成（自研 20 + Stirling 23）。
- 新增“最近处理”清空、Stirling 在线状态徽标、搜索结果计数。

**文档与工程**
- `scripts/smoke.mjs`：33 项接口冒烟测试，失败非 0 退出。
- 新增版本目录 `version/0.1.0_beta/`（VERSION.json + CHANGELOG.md）。
- README 全面重写（能力矩阵、7 套模板字段表、接口表、限制说明）。
- 启动脚本加入 Node 堆参数（`--max-old-space-size=1536 --max-semi-space-size=16`），并提示冒烟测试命令。

### 变更

- 版本号统一为 `0.1.0_beta`（`package.json`、`src/config.mjs`、界面、README）。
- `docbox/package.json` 改为 `type: module`，补登记 `tesseract.js`、`@tesseract.js-data/chi_sim`，移除未使用的 `pdfjs-dist`。
- Edge 渲染统一使用单一 profile `docbox/tmp/edge-profile`。
- 服务启动即清理残留临时文件，退出时清理 `tmp`。

### 移除

- 移除 miniPaint 4.14.3（`public/minipaint`、首页入口、README 说明）。
- 删除旧单文件前端 `public/app.js`。
- 删除旧水印实现 `docbox/watermark.mjs` 与 14 套旧模板。
- 清理 91 个孤儿文件：历史探针脚本（`_probe_*`、`_st_*`、`probe-*`）、调试截图、`chi_sim.traineddata`、`.edge-profile`、临时 JAR、`.npm-cache` 等。

### 修复

- 修复 Stirling 代理未传字段时参数为空导致的 5xx（现在按清单补默认值）。
- 修复 Stirling 单接口失败后全局熔断、拖累其它工具的问题（改为按路由）。
- 修复 OCR 在内存紧张时拖垮主进程的问题（子进程隔离 + 堆上限）。
- 修复水印模板字段名不一致导致表单不渲染的问题。
- 修复证件照排版文件名含 `×` 的问题。

### 已知问题

- Windows 下 Stirling 合并/拆分缺 jpdfium 原生库，始终回退本地引擎（功能可用，响应中会说明）。
- Stirling 的 OCR、PDF→Word/Excel、PDF/A、修复、自动脱敏不可用。
- PDF 中文水印依赖本机 simhei 字体。
- 离线 OCR 对倾斜、手写、低分辨率图片识别率有限。

### 验证

- `cd docbox && npm run smoke`：33/33 通过（Stirling 在线）。
- Playwright（Edge）走通：首页 43 张卡片、水印预览/切换/批量/持久化、OCR 图片识别、图片压缩、证件照、图片编辑、PDF 拆解、Stirling 旋转。
- 控制台无报错。
