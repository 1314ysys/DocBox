# 0.1.1 · 2026-10-20

> 主题：**去掉独立后台端口，把音视频 / 网络安全 / 原生 PDF 全部融进 DocBox 单进程。**

## 新增

### 音视频（18 项，`/api/suite/media/*`）
转码、压缩、提取音轨、音频转码、截取、合并、生成 GIF、抽取画面、缩放、变速、音量标准化、静音、旋转、文字水印、图片轮播视频、淡入淡出、探明媒体信息、清除元数据。
实现：`src/lib/media.mjs`，ffmpeg/ffprobe 由 npm 包提供，20 分钟超时终止，`drawtext` 中文自动转义。

### 网络安全（16 项，`/api/suite/net/*`）
端口扫描（TCP connect，64 并发，顶 1000 端口 / web / top100 预设）、DNS 查询、ping、traceroute、安全响应头审计（A–E 评级）、TLS 证书、RDAP、跳转链、耗时分解、目录探测、HTTP 方法探测、服务指纹、本机网络、子域枚举（crt.sh）、安全配置生成（Nginx/Apache/Express）、IP 归属。
实现：`src/lib/netprobe.mjs`，全部本地实现，无第三方扫描服务；所有结果附 `warning: 仅限自有或已获授权的资产`。

### 原生 PDF 套件（21 项，`/api/suite/pdf/*`）
旋转、删除页面、重排、裁剪（含自动裁白边）、缩放纸张、多页合一、小册子、按份拆分、页面叠加、长页拼接、解压对象流、扁平化、去空白页、加密（AES-256/128、RC4-128/40 + 权限位）、解密、清理脚本附件、读元数据、写元数据、PDF→图片（pdfjs + canvas）、PDF→文字、图片提取、图片转 PDF、书签读取。
实现：`src/lib/pdfops.mjs` + `src/lib/pdf-render.mjs`。

### 本地数据库
`src/lib/db.mjs`：mysql2 连接池，启动自动建库 `docbox` 与 4 张表（`jobs` / `templates` / `net_reports` / `settings`）；密码按 `root/空/root/123456/mysql/password` 探测；不可用时静默降级。
接口：`/api/history`（列表 / 清空）、`/api/templates`（水印模板 CRUD）、`/api/net/reports`、`/api/settings/:key`。

### 前端
- 新增「音视频」「网络安全」分类页与 `#/history` 处理历史页（分类筛选、清空）
- 工具页支持无文件工具（网络类）与 JSON 结果面板（复制 / 下载）
- 首页统计改为 全部工具 / 本地自研 / 本地数据库；顶栏状态显示 MySQL 连接状态与工具数
- 水印模板保存时同步写入数据库

## 变更

- 工具总数 20 → **75**（含套件），路由改为统一的 `/api/suite/<suite>/<action>`
- `/api/pdf/*` 原生路由全部去掉 Stirling 回退，改为纯 pdf-lib 实现并记录任务
- `/api/app` 返回 `suites`（57 条套件元数据）、`tools`、`db`、`media` 状态
- `/api/health` 返回 `db`（可用性/版本/库名）与 `media`（ffmpeg 可用性/版本）
- 依赖新增：`mysql2`、`pdfjs-dist`、`@cantoo/pdf-lib`、`@napi-rs/canvas`、`@ffmpeg-installer/ffmpeg`、`@ffprobe-installer/ffprobe`

## 移除

- Stirling-PDF 3.2.0 及其 8090 端口、启动/停止逻辑、代理路由、工具清单（`stirling/` 807 MB 已删除）
- JDK 25 运行时（`runtime/` 948 MB 已删除），服务不再需要 Java
- `src/lib/stirling.mjs`、`src/routes/stirling.mjs`、`src/stirling-tools.mjs`
- `start-all.ps1` 的 Stirling 启动段与健康检查

## 修复

- 套件路由与原生 `/api/pdf/*` 的字段冲突（统一改用 `/api/suite/...` 与 `files` 字段）
- 小册子对空槽位嵌入空白页导致 `Can't embed page with missing Contents` → 直接跳过空槽
- 书签/清理工具对 `PDFDict` 直接 lookup undefined 抛错 → 改为安全解引用
- 图片提取在非图片 XObject 上误判 → 按 `/Subtype /Image` 与流类型双重判断
- Windows 命令输出 GBK 乱码导致本机网卡解析为 0 → 统一 `chcp 65001` 后执行
- 图片轮播视频 scale+pad 过滤器对奇数高度报错 → 去掉 pad，仅等比缩放

## 验证

- `npm run smoke`：**86 / 86 通过**（基础 8、图片/证件照 5、PDF 基础 7、PDF 套件 22、音视频 16、网络 15、数据库 9、其它 4）
- 浏览器实测（Edge + Playwright）：首页 75 卡、音视频 18 卡、网络 16 卡、历史 100 行、工具执行与 JSON 面板均正常，控制台 0 报错
- MySQL 8.4.3 `root/root` 连接验证，jobs 记录 278 条、net_reports、templates、settings 读写通过

## 已知问题

- 本机 DNS 对 example.com 解析失败（运营商/系统 DNS 限制），DNS 工具会返回失败提示
- rdap.org 对部分 IP 返回 403，已降级
- PDF 压缩对已优化文件不再减小体积（会明确提示）
