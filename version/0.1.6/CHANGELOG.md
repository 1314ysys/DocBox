# 0.1.6 · 2026-10-20

> 主题：**网络安全长出网页终端，OCR 长出语音转写。**

## 新增

### 1. 网络安全 · SSH / Telnet 网页终端（`#/terminal`）

- 参照 WebTerminalTool（FastAPI + paramiko + xterm.js + WebSocket）的思路，用 Node 原生实现，融进 DocBox 单进程：
  - `src/lib/terminal.mjs`：会话管理（最多 12 个、未接管 90 秒回收、定时清理）；SSH 走 `ssh2`（`shell({ term: 'xterm-256color' })` + `setWindow`），Telnet 走 `net.Socket` + IAC 协商过滤 + 登录提示状态机（`login:/username:` → 送用户名，`password:` → 送密码）。
  - `src/routes/terminal.mjs`：`POST /api/terminal/connect`（返回会话 id 与 ws 地址，失败返回可读原因：认证失败 / 连接被拒 / 超时）、`GET /api/terminal/sessions`、`POST /api/terminal/close`。
  - `server.mjs`：`upgrade` 事件接管 `/ws/terminal?id=`，二进制双向转发；控制帧 `\u0000resize:cols,rows` 同步窗口尺寸；登录开启时校验会话 Cookie。
  - 前端 `views/terminal.mjs` + `#/terminal`：左侧连接表单与会话列表（连接状态灯：连接中 / 已连接 / 已断开），右侧多标签终端；xterm.js 3.14 的 `theme` 只接受字符串（传对象会抛 `xterm-theme-[object Object]`），已改为 `theme: 'dark'`；聚焦隐藏 textarea 会让祖先容器滚动，已用 `overflow: clip` + 复位 `scrollTop` 修掉「终端往上跑一屏」。
  - 会话数据在接管前先缓冲（最多 64 KB），WebSocket 连上后回放，不会丢掉服务器横幅。
- 权限：`/api/terminal/*` 归 `net` 模块（`auth.mjs` PATH_RULES）；工具目录新增 `net-terminal`（网络安全第 17 项、总计第 88 项）。

### 2. OCR 模块改名「OCR 与转写」并加转写

- 模块名（左侧导航、分类页标题、权限勾选框）改为 **OCR 与转写**，模块键仍是 `ocr`；`/api/stt/*` 归同一模块。
- 本地语音模型：**Whisper tiny**（`Xenova/whisper-tiny`，ONNX，约 40 MB，中英多语），`@xenova/transformers` 推理，模型走 `hf-mirror.com` 镜像，缓存到 `docbox/tmp/models`。
- `src/lib/stt.mjs`：ffmpeg 解码任意音视频 → 16 kHz 单声道 f32 → 12 秒窗口逐段识别（`transformers.js` 在多语言 + `return_timestamps` 同时开启时会返回空文本，改为窗口切分自带时间轴）；单并发队列 + 进度回调 + DB 落库（`stt_jobs` 表：状态 / 进度 / 文本 / 片段 / 时长 / 错误），DB 不可用时退化为内存任务。
- `src/routes/stt.mjs`：`GET /api/stt/status`、`POST /api/stt/job`（离线后台任务）、`GET /api/stt/jobs`、`GET /api/stt/job/:id`、`DELETE /api/stt/job/:id`、`POST /api/stt/quick`（≤15 分钟同步）、`POST /api/stt/chunk`（实时片段）。
- 前端 `views/ocr.mjs` 重写为四个标签：
  - **图片 OCR** / **PDF 整本 OCR**（保留原能力，选择/拖动、缩略图预览、置信度）；
  - **音视频转写**：语言（中文 / English / 自动）+ 方式（离线后台任务 / 在线同步），离线模式显示任务 ID 与进度条，轮询到完成后填入文本；
  - **实时转写**：麦克风 `MediaRecorder` 每 5 秒切片送 `/api/stt/chunk`，边说边出字；
  - 结果区支持复制、下载 TXT，有片段时还能下载 SRT（`hh:mm:ss,mmm` 时间轴）。
- 处理历史页新增「语音转写任务」面板：状态 / 进度 / 摘要 / 查看（下载 TXT）/ 删除。

## 兼容与修复

- `@xenova/transformers@2.17.2` 依赖的 `sharp@0.32` 在 Windows 上无法构建二进制，`npm install` 直接失败；改为 `npm install @xenova/transformers --ignore-scripts` 并删除其嵌套 `sharp`，复用根目录 `sharp@0.35.5`（转写只用音频管线，不受影响）。
- 模型下载在 `huggingface.co` 不可达的环境下自动走镜像。
- 工具目录新增 `terminal` 图标；首页 hero 卡片：网络安全换成「SSH / Telnet」，历史换成「转写任务」。

## 测试

- `npm run smoke`：**159 / 159 通过**（新增：终端连接失败提示、终端会话列表、关闭不存在的会话、转写状态、在线转写、离线任务创建/完成/入库、实时片段、删除任务；工具总数断言 88）。
- 浏览器实测（Edge/Chromium，1440×980）：
  - 终端：连本机 telnet 演示服，卡片显示「已连接」，xterm 出现横幅，键盘输入逐字符送达并被回显；窗口尺寸变化后列行数同步；
  - OCR 与转写：在线转写 7.8 秒中文样本得到「你好,这是语音专系功能的课事…」，离线任务进度从 3% 到完成并自动填入，SRT 按钮出现；历史页看到 speech-zh.wav 任务行；
  - 控制台 0 报错。
