# 文档百宝箱 · DocBox

**版本：0.1.0_beta** · 本地优先（local-first）的图片 / 文档 / PDF / OCR 工作台。
全部处理都在本机完成：浏览器只负责界面与预览，服务端用 Node + Sharp + pdf-lib + tesseract.js 落地，进阶 PDF 能力由本地部署的 **Stirling-PDF 3.2.0** 提供。

```
浏览器  http://127.0.0.1:3000        DocBox 界面（自研）
服务    http://127.0.0.1:3000/api/*  DocBox 接口
套件    http://127.0.0.1:8090        Stirling-PDF（本地 Spring Boot，可选）
```

---

## 1. 快速开始

```powershell
# 一次性启动 Stirling-PDF（可选）+ DocBox，并打开浏览器
.\start-all.ps1

# 只启动 DocBox
cd docbox
npm install          # 首次
npm start            # node --max-old-space-size=1536 --max-semi-space-size=16 server.mjs

# 停止
.\stop-all.ps1
```

- 需要 Node.js ≥ 20、Windows（文档转 PDF 依赖本机 Edge 的 `--print-to-pdf`）。
- Stirling-PDF 需要 `runtime/jdk-25*`（JAR 用 Java 25 编译）与 `stirling/Stirling-PDF.jar`；缺失时 DocBox 仍可独立工作，只是“Stirling 套件”分类不可用。
- 首次启动会自动清理：残留上传临时文件、渲染中间目录、超过 6 小时的输出。

---

## 2. 能力总览（43 项）

### 2.1 自研工具（20 项）

| 分类 | 工具 | 说明 |
| --- | --- | --- |
| 图片 | 图片压缩 | 批量压缩，质量 / 最大宽度可调，显示体积变化 |
| 图片 | 格式转换 | PNG / JPG / WebP / AVIF / TIFF 互转 |
| 图片 | 尺寸调整 | 等比适配、裁切填充、拉伸、留白 |
| 图片 | **工作水印 / 全图水印** | 7 套模板（见第 3 节），实时预览、批量套用、参数可保存 |
| 图片 | 图片编辑 | 裁剪、旋转、翻转、缩放、亮度/对比度/饱和度、文字水印、导出 PNG/JPG/WebP |
| 图片 | 证件照排版 | 10 种规格 + 户口本整页，A4 300dpi 排版、裁剪虚线、PDF/PNG 输出、相机拍照 |
| 图片 | 图片合成 PDF | 多图合成，A4/Letter/A3/跟随图片，自动方向 |
| PDF | 合并 / 拆分 / 页面管理 | 合并优先走 Stirling，失败自动回退本地；拆分支持范围、提取、每 N 页、逐页 |
| PDF | PDF 水印 / 添加页码 / PDF 压缩 | 优先 Stirling-PDF，失败自动回退本地引擎 |
| PDF | PDF 拆解导出 | 前端 PDF.js 渲染，逐页导出图片（ZIP）或提取文字（TXT） |
| 文档 | 文档转 PDF | .docx / .md / .html / .txt / .csv / .xlsx → PDF（本机 Edge 打印） |
| 文档 | Word 转 HTML / 转 Markdown | mammoth + turndown |
| 表格 | 表格格式转换 / 转 JSON | Excel ⇄ CSV ⇄ JSON，多工作表自动拆分 |
| 识别 | **OCR 文字识别** | 图片批量 + 整本 PDF，离线中文（chi_sim） |

### 2.2 Stirling-PDF 套件（23 项，本地 8090）

页面组织：旋转、删除页面、重排页面、裁剪、缩放/改纸、多页拼版(N-up)、小册子、按章节拆分
页面增强：叠加 PDF、单页化、解压（去重压缩流）、扁平化表单、移除空白页
安全：加密、解密、脱敏清理、元数据编辑、文档信息
转换：PDF → 图片、PDF → 文本、提取内嵌图片、图片 → PDF、提取书签

> 说明：Stirling 的合并 / 拆分（`merge-pdfs`、`split-pages`）依赖 jpdfium 原生库，官方 JAR 只带 linux-x64 二进制，Windows 下会抛 `NativeNotFoundException`，因此这两项在 DocBox 中始终自动回退本地 pdf-lib 引擎，界面会明确标注“已由本地引擎合并/拆分”。

---

## 3. 七套水印模板

前端模板、服务端渲染、字段定义共用同一份清单：`docbox/src/watermark-templates.mjs`，通过 `GET /api/watermark/templates` 下发。

| ID | 模板 | 主色 | 关键字段 | 典型场景 |
| --- | --- | --- | --- | --- |
| `construction` | 建筑施工 | `#0b64d6` | 企业/项目名、施工区域、施工内容、拍摄时间、地点、GPS、备注 | 工程现场留痕 |
| `sales` | 销售外勤 | `#f97316` | 打卡时间、日期星期、客户单位、拜访事项、地点、天气 | 外勤拜访打卡 |
| `property` | 物业管理 | `#2f7fa8` | 时段（自动/早晨/上午…）、项目小区、楼栋部位、巡检项 | 物业巡检 |
| `hotel` | 酒店餐饮 | `#3b82f6` | 打卡时间、门店包厢、餐次、地点 | 门店/餐饮打卡 |
| `logistics` | 快递物流 | `#2f9fd0` | 运单号、派件人、状态、地点 | 派件签收 |
| `sanitation` | 环境卫生 | `#f07850` | 责任区域、责任人、检查结果、地点 | 环卫/保洁检查 |
| `docfull` | 透明全图水印 | `#e11d48` | 多行文字、方向（-90°~90°）、透明度（4%~70%）、行间距、字号、颜色、平铺/单条 | 证件照、身份证复印件的防 misuse 水印 |

- 信息卡：深色渐变圆角卡（#0f172a→#020617）+ 左侧主色竖条，行式布局（品牌 / 大号时间 / 日期星期+天气 / 定位点 + 地点 / 键值行 / 备注）。
- 透明水印：按“行间距”把整块文字铺满全图（不是只铺一个瓦片），支持每行错位与任意角度旋转。
- 参数持久化：每个模板的填写内容自动存在 `localStorage`（`docbox.watermark.templates.v1`），“恢复到默认值”可清除。
- 证件水印提供 4 个常用预设：居住证 / 入职 / 贷款 / 身份证复印件。

---

## 4. 离线 OCR

- 引擎：`tesseract.js` v7 + `@tesseract.js-data/chi_sim`（本地语言包 `4.0.0/chi_sim.traineddata.gz`，**不联网**）。
- 架构：OCR 跑在**独立子进程**（`src/ocr-worker.mjs`），识别结束即退出，主服务不常驻 WASM 内存；请求串行排队，避免并发抢内存。
- 能力：图片批量识别（单次 ≤ 40 张）、整本 PDF 识别（前端渲染成图 → 分批提交）、置信度与字数、TXT 导出、自动合并中文字符间多余空格。
- 准确度参考：清晰截图 90%+；手写、倾斜、低分辨率会明显下降。

---

## 5. 目录结构

```
temp_file_edit/
├─ docbox/                     DocBox 主服务
│  ├─ server.mjs               Express 入口（静态资源 + 路由 + 启动清理 + 优雅退出）
│  ├─ src/
│  │  ├─ config.mjs            端口 / 路径 / 字体 / Edge / Stirling 地址 / 版本号
│  │  ├─ watermark-templates.mjs  7 套水印模板（前后端唯一事实来源）
│  │  ├─ stirling-tools.mjs    23 项 Stirling 工具清单（代理白名单）
│  │  ├─ ocr-worker.mjs        tesseract 子进程
│  │  ├─ lib/                  files / pdfkit / html2pdf / stirling / watermark / ocr / upload / async
│  │  └─ routes/               image / idphoto / pdf / stirling / doc / sheet / ocr / meta
│  ├─ public/
│  │  ├─ index.html            视图骨架（home / tool / watermark / idphoto / editor / extract / ocr）
│  │  ├─ styles.css
│  │  ├─ js/
│  │  │  ├─ main.mjs           哈希路由 + 启动
│  │  │  ├─ core/              dom / api / ui / store / files(拖拽排序) / fields / results
│  │  │  ├─ tools/catalog.mjs  自研 20 项 + Stirling 23 项，统一成同一套卡片与表单
│  │  │  └─ views/             home / tool / watermark / idphoto / editor / extract / ocr
│  │  └─ vendor/               pdf.js、jszip（前端本地依赖）
│  ├─ scripts/smoke.mjs        33 项接口冒烟测试
│  └─ testdata/                样例文件
├─ version/                    版本控制目录（0.1.0_beta 基线）
├─ stirling/                   Stirling-PDF JAR、配置、日志（不进 git）
├─ runtime/                    JDK 21 / 25（不进 git）
├─ fonts/                      CJK 字体回退（不进 git）
├─ start-all.ps1 / stop-all.ps1
└─ README.md
```

---

## 6. HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/app` | 一次性返回版本、Stirling 状态、7 套水印模板、23 项 Stirling 工具、证件照规格 |
| GET | `/api/health` | 健康检查（含 Stirling 在线状态、字体/Edge 能力） |
| GET | `/api/watermark/templates` | 水印模板清单 |
| POST | `/api/image/watermark-template` | 生成水印图（`?preview=1` 只处理首张） |
| POST | `/api/image/process` | 压缩 / 转换 / 缩放 |
| POST | `/api/image/info` | 读取图片尺寸与体积 |
| POST | `/api/idphoto/sheet` | 证件照 A4 排版（PDF / PNG） |
| GET | `/api/idphoto/presets` | 证件照规格 |
| POST | `/api/pdf/merge`、`/split`、`/pages`、`/watermark`、`/numbers`、`/compress`、`/images-to-pdf` | PDF 系列（能走 Stirling 的优先走 Stirling） |
| POST | `/api/doc/to-pdf`、`/docx-to-html`、`/to-markdown` | 文档转换 |
| POST | `/api/sheet/convert`、`/to-json` | 表格转换 |
| POST | `/api/ocr/image`、`/ocr/batch` | 图片 OCR |
| GET | `/api/stirling/tools`、`/status` | 套件清单与状态 |
| POST | `/api/stirling/:id` | Stirling 代理（按清单白名单校验，自动补默认参数、映射导出扩展名） |

响应约定：`{"ok":true,"files":[{name,size,url,kind}],"note":"..."}`；多文件时自动打包 ZIP；失败返回 `{"error":"..."}`。

---

## 7. 配置与数据

- 端口：DocBox `3000`，Stirling `8090`（`src/config.mjs`）。
- 单文件上限 200MB，单次最多 40 个文件。
- 输出目录 `docbox/outputs/<随机id>/`，6 小时后自动清理；上传中转文件 1 小时、渲染中间件 2 小时。
- 文档转 PDF 统一使用 `docbox/tmp/edge-profile`（单一 Edge profile，避免残留多份用户数据目录）。
- 隐私：不访问外网；OCR 语言包、PDF.js、JSZip 全部本地。

---

## 8. 测试

```powershell
cd docbox
npm run smoke        # 33 项：7 套水印 + OCR + 图片 + PDF + 证件照 + 文档 + 表格 + Stirling
```

冒烟测试覆盖每个接口的状态码与产物（样例在 `docbox/testdata`），失败会以非 0 退出码结束，可直接接 CI。

---

## 9. 已知限制

1. **Windows 下的 Stirling 合并/拆分**：jpdfium 缺少 windows-x64 原生库（`UnsatisfiedLinkError`），DocBox 已内置本地回退，功能不受影响，只是性能略低。
2. **Stirling 已禁用项**：OCR、PDF→Word/Excel、PDF/A、修复、自动脱敏、扫描件特效（依赖缺失或返回 5xx）。
3. **文档转 PDF 依赖 Edge**：没有 Edge 时该功能返回明确错误，其余功能不受影响。
4. **中文水印字体**：优先 `fonts/simhei.ttf`，回退系统 `C:/Windows/Fonts/simhei.ttf`；都没有时 PDF 中文水印会提示字体缺失（PNG 水印走系统字体，不受影响）。
5. OCR 对倾斜 / 手写 / 低分辨率图片的识别率有限。

---

## 10. 版本

- 当前基线：`0.1.0_beta`，详见 [version/0.1.0_beta/VERSION.json](version/0.1.0_beta/VERSION.json) 与 [CHANGELOG](version/0.1.0_beta/CHANGELOG.md)。
- 版本目录 `version/` 保存每个发布基线的元数据与变更说明；`git tag v0.1.0_beta` 对应本次基线提交。

## 11. 致谢与许可

- DocBox 自研代码：MIT。
- [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF)（MIT）提供进阶 PDF 能力；[pdf.js](https://mozilla.github.io/pdf.js/)（Apache-2.0）、[JSZip](https://stuk.github.io/jszip/)（MIT/GPLv3 双许可）、[pdf-lib](https://pdf-lib.js.org/)（MIT）、[Sharp](https://sharp.pixelplumbing.com/)（Apache-2.0）、[tesseract.js](https://github.com/naptha/tesseract.js)（Apache-2.0）。
