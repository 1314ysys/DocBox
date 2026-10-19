# DocBox · 本地文档工具箱

**单进程、单端口、数据不出本机**的文档 / 图片 / 音视频 / 网络安全工作台。  
所有处理都在本机 Node 进程内完成（ffmpeg 仅作为子进程调用），任务记录写入本地 MySQL。

`v0.1.1` · 75 个工具 · 7 大分类 · 86 项冒烟断言全通过

---

## 0.1.1 有什么变化

- **彻底移除 Stirling-PDF**：不再有 8090 端口、不再需要 JDK 25、`stirling/` 与 `runtime/`（约 1.7 GB）已删除。原 Stirling 的能力全部改写为原生实现，直接跑在 DocBox 的 3000 端口上。
- **新增音视频套件（18 项）**：基于 ffmpeg 的转码、压缩、剪辑、合并、GIF、抽帧、提音、变速、音量、静音、旋转、水印、图片转视频、淡入淡出、元数据清除。
- **新增网络安全套件（16 项）**：端口扫描、DNS、ping/traceroute、响应头审计、TLS 证书、RDAP、跳转链、耗时分解、目录探测、方法探测、服务指纹、本机网络、子域枚举、安全配置生成、IP 归属。
- **新增 23 项原生 PDF 能力**：旋转、删页、重排、裁剪、缩放、多页合一、小册子、拆分、叠加、长页拼接、解压、扁平化、去空白页、加密、解密、清理、读写元数据、PDF→图片/文字、图片提取、图片转 PDF、书签。
- **本地 MySQL 落库**：`jobs`（处理历史）、`templates`（水印模板）、`net_reports`（安全报告）、`settings`（偏好）；数据库不可用时自动降级，其余功能照常。
- **前端新增**：音视频 / 网络安全两个分类页、检测结果 JSON 面板（复制 / 下载）、`#/history` 处理历史页（筛选 / 清空）。

## 快速开始

前置：Windows 10/11、**Node.js ≥ 20**（已验证 v24.20）、本机装有 Edge（文档转 PDF 用）。  
MySQL 8.x 可选：没有也能用，只是「处理历史」不可用。

```powershell
cd docbox
npm install          # 首次
cd ..
.\start-all.ps1      # 启动（会顺带拉起 MySQL 服务并打开浏览器）
```

打开 <http://127.0.0.1:3000/>，停止用 `.\stop-all.ps1`。

也可以手动跑：

```powershell
cd docbox
npm start            # node --max-old-space-size=1536 server.mjs
npm run smoke        # 86 项冒烟检查（需服务已启动）
```

## 本地数据库

服务启动时自动连接并建库建表，**无需手动执行 SQL**：

| 项 | 值 |
| --- | --- |
| 地址 | `127.0.0.1:3306` |
| 数据库 | `docbox`（不存在会自动创建） |
| 账号 / 密码 | `root` / `root`（本机实测：MySQL 8.4.3，`root@localhost`） |
| 字符集 | `utf8mb4` / `utf8mb4_0900_ai_ci` |

密码按 `DB_PASSWORD` → 空 → `root` → `123456` → `mysql` → `password` 依次尝试，成功后写回配置状态；全部失败时服务仍正常启动，只是历史相关接口返回「数据库不可用」。

可通过环境变量覆盖：`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。

表结构：

- `jobs(id, suite, tool, status, duration_ms, input, output, note, error, created_at)` — 每次处理一行
- `templates(template_id, name, spec JSON, updated_at)` — 水印模板（前端保存时同步）
- `net_reports(id, tool, target, summary JSON, created_at)` — 网络体检结论
- `settings(k, v, updated_at)` — 偏好键值

> 想换库名/密码，改 `docbox/src/config.mjs` 的 `DB` 或设环境变量即可。

## 工具清单（75 项）

| 分类 | 数量 | 代表能力 |
| --- | --- | --- |
| 图片 | 7 | 压缩、格式转换（含 AVIF）、尺寸调整、7 套水印、图片编辑、证件照 A4 排版、图片合成 PDF |
| PDF（自研基础） | 7 | 合并、拆分、页面管理、PDF 水印、页码、压缩、拆解导出 |
| PDF（原生套件） | 21 | 旋转 / 删页 / 重排 / 裁剪 / 缩放 / 多页合一 / 小册子 / 叠加 / 长页 / 解压 / 扁平化 / 去空白 / 加密(AES-256) / 解密 / 清理 / 元数据读写 / PDF→图片 / PDF→文字 / 图片提取 / 图片转 PDF / 书签 |
| 文档 | 3 | Word / Markdown / HTML / Excel / CSV → PDF，`.docx` → HTML / Markdown |
| 表格 | 2 | Excel ⇄ CSV ⇄ JSON、多工作表拆分 |
| 文字识别 | 1 | 图片 + 整本 PDF 的离线中文 OCR（tesseract.js v7 + chi_sim） |
| 音视频 | 18 | 转码、压缩、提取音轨、音频转码、截取、合并、GIF、抽帧、缩放、变速、响度、静音、旋转、水印、图片轮播、淡入淡出、探明信息、清元数据 |
| 网络安全 | 16 | 端口扫描（64 并发/顶 1000 端口）、DNS、ping、traceroute、响应头评级、TLS 证书、RDAP、跳转链、耗时、目录探测、方法探测、服务指纹、本机网络、子域枚举、安全配置生成、IP 归属 |

## 目录结构

```
docbox/
  server.mjs               # Express 5 入口（唯一进程、唯一端口 3000）
  src/
    config.mjs             # 端口/路径/DB/ffmpeg 路径/版本号
    tool-catalog.mjs       # 57 条套件工具元数据（PDF 23 / 音视频 18 / 网络 16）
    lib/
      db.mjs               # mysql2 连接池 + 建表 + jobs/templates/reports/settings
      pdfops.mjs           # 23 项原生 PDF 实现
      pdf-render.mjs       # pdfjs + @napi-rs/canvas 渲染
      media.mjs            # ffmpeg/ffprobe 封装（18 项）
      netprobe.mjs         # 网络探测（16 项，纯 Node 实现）
      track.mjs            # 处理记录写入
    routes/                # image / idphoto / pdf / suite / history / doc / sheet / ocr / meta
  public/                  # 原生 ES 模块前端（core / tools / views），无构建步骤
  scripts/smoke.mjs        # 86 项冒烟测试
  testdata/                # 冒烟用样例（PDF/图片/音视频/表格/文档）
version/                   # 版本基线（VERSION.json + CHANGELOG.md + 源码快照）
```

## 安全声明

网络安全分类**只面向自有或已获授权的资产**：没有口令爆破、漏洞利用或第三方扫描服务，全部为连通性、指纹与配置审计的本地实现，每条结果都带 `warning: 仅限自有或已获授权的资产`。请勿用于未授权目标。

## 验证

- `npm run smoke`：**86/86 通过**（基础 8 · 图片/证件照 5 · PDF 基础 7 · PDF 套件 22 · 音视频 16 · 网络安全 15 · 数据库 9 · 其它 4）
- 浏览器（Edge/Chromium）实测：首页 75 张卡片、音视频/网络安全/历史页面、文件工具、JSON 结果面板均无控制台报错。

## 版本历史

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 0.1.1 | 2026-10-20 | 移除 Stirling-PDF 端口与 JDK；新增音视频 18 项、网络安全 16 项、原生 PDF 21 项；接入本地 MySQL；新增历史页 |
| 0.1.0_beta | 2026-10-20 | 首个基线：Stirling 融合 + 7 套水印 + 离线 OCR + 前端模块化 |

详见 `version/<版本>/CHANGELOG.md`。

## License

MIT
