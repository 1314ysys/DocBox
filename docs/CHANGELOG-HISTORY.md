# DocBox 历史变更日志（0.1.1 ～ 0.3.2）

> 本文件收录 0.3.2 及更早版本的详细变更，README 只保留 0.4.x 近期变更。
> 更早的逐版本明细见 `version/0.4.4/CHANGELOG.md` 与各版本 tag（`git tag -l`）。

## 0.3.2 有什么变化

> 主题：**「链接解析不了」修好了——站点内置解析 + yt-dlp 一键安装 + 解析过程看得见。**

### 站点内置解析（不依赖 yt-dlp）

- 新增 `src/lib/sites.mjs`，首个支持**哔哩哔哩**：`view` 接口拿标题封面 → `playurl` 拿流，**DASH 优先**（视频+音频分开，ffmpeg 合成），拿不到再退回 `platform=html5` 的 MP4 直链（免登录常见 720P）；
- 支持 `BV` / `av` / `b23.tv` 短链；画质码转人话（`64→720P`、`80→1080P`、`116→1080P60`、`120→4K`）；贴 Cookie 到 `DOCBOX_BILI_COOKIE` 可解锁更高画质；
- 解析顺序变成：**站点内置 → yt-dlp → 网页抓取**，任一步成功即返回。

### yt-dlp：自动发现 + 一键安装

- 检测 `DOCBOX_YTDLP` → `docbox/bin/yt-dlp` → PATH → `python -m yt_dlp`；
- 页面右上角显示引擎状态，没有 yt-dlp 时出现 **「一键安装 yt-dlp」** 按钮（`POST /api/video/ytdlp/install`，先 pip、失败再下官方单文件）；
- 命令行也可以用 `node scripts/fetch-ytdlp.mjs`。

### 解析过程看得见 + 不再空转

- 结果里新增「解析过程」折叠块，逐步显示站点内置 / yt-dlp / 抓网页（HTTP 状态、大小、命中数）/ iframe / m3u8 解析，每步 ✓ 或 ✗ 带原因；
- yt-dlp 探测加 60 秒进程级超时与 `--retries` 限制，站点不可达时一分钟内明确报错；错误行过滤掉 Python 弃用噪音；
- 失败提示改为可操作文案（未装 yt-dlp / yt-dlp 报错原因 / 网页里确实没有 m3u8）。

### 下载链路补全

- `download()` 改为接收**格式对象**：`dash`（视频+音频+ffmpeg 合成）/ `hls` / `file`（带 Referer/Cookie）/ `ytdlp` 四种；HLS 分片支持自定义请求头；批量任务同样走这套。

---

## 0.3.1 有什么变化

> 主题：**网页 → m3u8 → 下载，一条链路；多条链接丢进队列，后台自己跑完。**

### m3u8 解析改成「跟原始视频网站一致」的方式

以前只认「链接本身就是 m3u8」，站点页面得自己先找 m3u8。现在 `resolveSource` 统一成一条链路：

1. 链接本身是 m3u8 → 解析 master/meida，枚举码率；
2. yt-dlp 可用 → `-J` 拿站点信息，**优先取其中的 m3u8 流**，交给自带 HLS 下载器；
3. 普通网页 → 抓 HTML 与内嵌 JS（兼容 `\/`、`\u002F` 转义、`"url":"…m3u8"` 这类字段）找出 m3u8 / 直链，找到 m3u8 再解析码率；
4. 页面里是 iframe 播放器 → 自动跟进去（最多 2 层）再抓。

### 批量下载 + 任务列表

- 一次贴多条 URL（一行一条，最多 50 条/次）→ 后台任务队列自动解析 + 下载，**关掉页面也继续跑**；
- 并发 2（`DOCBOX_VIDEO_PARALLEL` 可调），状态 `queued → resolving → downloading → done/failed/canceled`；
- 进度：HLS 按分片计数、直链按字节；可取消 / 重试 / 删除；任务落库 `video_tasks`，重启后历史还在（中断的会标记失败，可重试）；
- 下载页面下半部分就是任务列表，3 秒自动刷新，离开页面自动停轮询；
- 新增接口：`POST /api/video/batch`、`GET /api/video/tasks`、`POST /api/video/tasks/:id/{cancel,retry}`、`DELETE /api/video/tasks/:id`。

### 其它

- `hls.mjs` 分片/密钥请求补 `AbortSignal`（可取消）与统一 UA / Referer；
- 冒烟断言 186 → **188**（批量任务列表、批量接口非法链接校验）；
- 镜像与归档版本号 `0.3.1`。

---

## 0.3.0 有什么变化

> 主题：**服务器不再是「肉机」，网络体检回到你自己的电脑上跑。**

### 网络安全 16 项：全部改由登录用户的浏览器发起

- 新增前端引擎 `public/js/core/netclient.mjs`：DNS（DoH）、连通性、端口、HTTP 头、重定向、性能拆解、子域名、RDAP、IP 归属、本机信息、安全头生成等全部在**用户自己的电脑/浏览器里执行**，服务器只托管页面，不再代替用户去探测目标；
- 结果面板标注「本机发起」，每条记录带 `origin: 浏览器本机`；
- 浏览器沙箱做不到的三项（路由追踪 ICMP、TLS 证书读取、裸 TCP Banner）会明确返回「浏览器受限 + 建议用系统命令」，而不是偷偷让服务器代跑；
- 后端 `/api/suite/net/*` 保留，仅用于自检脚本与命令行排障，界面不再调用。

### OCR：中英混排 + 条码/二维码

- 语言包升级为 `chi_sim + eng` 混合识别（`models/tessdata` 内同时装两种 traineddata），中英混排一屏可同时识别；
- 新增条码识别（`zxing-wasm`）：QR / MicroQR / Code128 / Code39 / Code93 / EAN-8/13 / UPC-A/E / ITF / Codabar / DataMatrix / PDF417 / Aztec 等 20+ 种，结果与文字一起返回；
- 识别内容可选「中英混排 + 条码 / 仅文字 / 仅条码」；PDF 整本 OCR 每页都会附带该页的条码结果。

### 视频网站解析（不另建站点）

- 新增工具「视频网站解析」：贴一个视频页链接即可解析标题、封面、各清晰度直链；
- **内置 HLS 下载器**（`src/lib/hls.mjs`）：解析 master/meida 播放列表、按码率选流、并发下载分片、AES-128 解密、ffmpeg `-c copy` 合成 MP4；
- **yt-dlp 引擎**（镜像内已预装）：B 站 / YouTube / 爱奇艺 / 腾讯视频 / 优酷 / 抖音 等站点的解析与下载；
- 没有 yt-dlp 时自动降级为「页面里找 m3u8 / 直链」+ 自带 HLS 下载器，功能不中断；
- 参考了开源项目（如 parsedock 一类在线解析站）的思路，但**代码全部内嵌在本项目、不额外部署任何站点**。

### 网页终端（SSH / Telnet）实测

- 实测通过：Telnet 会话在浏览器 WebSocket 里双向收发正常（握手问候 → 输入 → 回显），SSH 走 ssh2 同一会话管线；
- 说明：浏览器无法直接开裸 TCP，网页终端必须由服务端中继连接；这与「网络体检改本机发起」不同，终端是**连到目标服务器**，中继是协议决定的，不在服务器上执行目标侧命令。

## 0.2.0 有什么变化

> 主题：**全工具自检 + 容器化交付。**

### 全工具自检（93/94，含 57 个套件工具 + 33 个原生工具）

- 新增 `npm run tools:check`：自动生成测试夹具（PDF/图片/音视频/Word/Excel/PPTX/Markdown），逐个真实调用 57 个套件工具与 33 个原生接口，下载产物校验大小；
- **修掉 7 个真实缺陷**：图片轮播输出高度非偶数导致 libx264 失败；RDAP 补 User-Agent 与超时；语音模型被 tmp 清理误删（每次重启都要重下 420MB）；无浏览器环境文档转 PDF 直接失败；PDF 中文水印 WinAnsi 编码报错；容器里 ffprobe 缺执行权限；Linux 下「路由追踪」还在调 Windows 的 tracert；
- 宿主机 93/94（唯一失败 crt.sh 502）；容器内 91/94，剩下 3 项都是需要外网的探测，容器无外网属环境限制。

### 容器化交付

- 单镜像 `docbox:0.2.0`：Node 22 + MariaDB 10.11 + FFmpeg + 中文字体 + SenseVoice/zipformer/Silero 模型预置；
- 入口脚本首次启动自动初始化数据库、建库建号，之后直接起应用；
- `deploy/install-windows.ps1` / `deploy/install-linux.sh` 从 0 安装 podman → `podman load` 本地镜像 → 起容器 → 健康检查 → 打开浏览器；
- `DOCBOX_DATA_DIR` / `DOCBOX_TMP_DIR` / `DOCBOX_MODELS_DIR` / `DOCBOX_FONT` 环境变量支持，配置无需改代码；
- 模型目录改为 `models/`（不再被 tmp 清理误删）；无浏览器环境下文档转 PDF 走纯文本兜底渲染。

## 0.1.10 有什么变化

> 主题：**账户列表行高从 458px 压到 64px。**

### 问题

账户页用 `.workspace` 的两栏网格（`1.35fr / .65fr`），6 列的账户表被塞进 345px 宽的窄栏，**授权模块**列只剩 52px，8 个模块标签竖着排成 8 行 —— 每行账户高 458px，看起来像"账户之间间隔很长"。

### 修法

- 账户页改用整行布局（`.workspace-accounts { grid-template-columns: minmax(0, 1fr) }`），表格拿到 1166px 全宽；
- 授权模块标签收紧：`gap 4px 5px`、`padding 2px 7px`、`font-size 10.8px`，`max-width 560px` → 一行放 4~5 个、两行放完；
- 单元格 `padding 10px 12px → 8px 10px`，`line-height 1.45`；列宽给出下限（账号 150 / 角色 108 / 状态 84 / 最近登录 132 / 操作 196）；
- 新建账户表单字段限制 `max-width 240px`，不再被拉满整行。

### 实测

| 指标 | 修前 | 修后 |
| --- | --- | --- |
| 单行账户高度 | 458px | **64px** |
| 授权模块列宽 | 52px（8 标签竖排） | 474px（两行） |
| 表格横向滚动 | 有（1040px 表塞 345px 栏） | 无 |

smoke **178/178**（新增 1 项：账户页整行布局已生效）。

## 0.1.9 有什么变化

> 主题：**修实时转写结果框的两个交互 Bug——删不掉字、每句话闪一下再被改。**

### 问题原因

0.1.8 的实时渲染在每次 partial（每 180ms 一次）都执行 `ta.value = finalText + '\n' + partial`，于是：

1. **删不掉**：用户在结果框里删掉的字符，下一个 partial 立刻把整段文本写回，看起来像"无法删除"；
2. **闪烁 + 先多后少**：未定稿的 partial 被当成新的一行塞进结果框，下一次 partial 整行替换，视觉上就是"闪一行出来，再把多余的字删掉"；
3. 写 `.value` 还会重置光标与滚动条，编辑时不断被打断。

### 修法："定稿区 + 实时行"分离

- 结果框（`#ocrText`）**只放定稿文本**，用 `setRangeText` 在末尾插入，不再整段重写，用户随时可以删改；
- 新增 `#ocrLive` 预览行（虚线蓝框）显示"正在识别"的 partial，每次只更新 `textContent`，原地变化不闪烁；
- `final` 事件把该句追加进结果框并清空预览行；`done` 不再用整段文本覆盖（避免冲掉用户编辑，也避免重复）；
- 实测：识别中预览行只增不减（0 次回退），删除后 3 秒不被写回，停止后文本完整保留。

### 其它

- 版本 0.1.9，smoke **177/177**（新增 3 项：页面含预览行、样式存在、渲染函数不再覆写结果框）。

## 0.1.8 有什么变化

> 主题：**把"能听清"变成"又快又准"——换掉 whisper，接上 WebRTC 和本地音频前处理。**

### 1. 识别引擎换成 sherpa-onnx（离线 SenseVoice + 流式 Zipformer）

| 同一段 7.78s 中文（speech-zh.wav） | 用时 | 实时倍率 | 输出 |
| --- | --- | --- | --- |
| whisper-small（0.1.7 文件） | ~17.4s（含两段解码） | 0.45× | 你好,這是語音轉寫功能的測試。 Dockbox 支持中文和 English 識別 |
| whisper-base（0.1.7 实时） | ~2.6s/次 | 3× | 你好,这是语音转写功能的测试.box.se |
| **SenseVoiceSmall int8（0.1.8 文件）** | **0.92s** | **8.5×** | 你好，这是语音转写功能的测试。dog box支持中文和english识别。 |
| **流式 Zipformer int8（0.1.8 实时）** | **0.88s 全程** | **8.8×** | 逐帧出字：你好 → 你好这是 → ... → 你好这是语音转写功能的测试中文和识别 |

- 离线：`SenseVoiceSmall`（阿里 FunAudioLLM，int8 约 230MB）——非自回归，自带标点，中英混说稳，VAD 切段后逐段识别；
- 实时：`sherpa-onnx-streaming-zipformer-bilingual-zh-en`（int8 约 100MB）——真正的流式编码，每 0.2s 推进一次 partial，静音 450ms 定稿；
- 模型走 hf-mirror 下载到 `tmp/models/sherpa/`，首次自动拉取；whisper 仍保留为兜底（`DOCBOX_STT_BACKEND=whisper`、`DOCBOX_STT_STREAM_ENGINE=whisper`）。

### 2. faster-whisper / Qwen 评估（为什么没选）

- **faster-whisper**（CTranslate2）：CPU int8 比 transformers.js 快 3~4 倍，但仍是自回归解码，7.78s 音频约 4~6s，且需要常驻 Python + CTranslate2（~100MB）。与 SenseVoice 对比不占优，暂不进主链路。
- **Qwen ASR**：开源权重以 LLM 解码为主（更大、更慢），CPU 上单句数秒起步，本机无 GPU 不适合实时；官方 API 版需要联网，与"数据不出本机"冲突。
- **SenseVoice**：国产、非自回归、int8 量化、CPU 8.5× 实时，于是选定。

### 3. 本地 WebRTC 采集（`@roamhq/wrtc`）

- `src/lib/webrtc.mjs`：服务端 `RTCPeerConnection` 应答浏览器 offer，`RTCAudioSink` 直接取 PCM（浏览器已协商 16kHz 单声道），线性重采样后复用 `stt-stream`；
- 信令复用 `/ws/stt`：`{type:'offer', sdp}` → `{type:'answer', sdp}`，ICE 只收集回环候选，无需 STUN/TURN；
- 前端实时页新增「传输」下拉：`WebSocket PCM`（默认，兼容性最好）/ `WebRTC（本地回环）`（Opus、抗丢包、自带 jitter buffer）。

### 4. 本地音频前处理（Python 侧车 + webrtc-audio-processing）

- `python/apm_service.py`：stdin/stdout 二进制协议（10ms 帧），优先 `webrtc_audio_processing`（AEC/NS/AGC）；
- 该包在 Windows 上**只有源码**（无 wheel，需要 MSVC + meson；本机 VS 2022 未装 C++ 工具链），所以默认走**等价 numpy DSP 链路**：去直流 → 80Hz 高通 → 谱减降噪 → AGC 软限幅，`/api/apm/status` 会如实报告 `backend`；
- 前端实时页新增「前处理」下拉，选中后 `POST /api/stt/stream {apm:true}` 打开；侧车失败会自动降级并提示，不阻塞转写；
- 新增接口：`GET /api/apm/status`（APM + WebRTC 可用性）、`POST /api/apm/test`（3200 采样回环自测）。

### 5. 其它

- `npm install` 后新增两个原生依赖：`sherpa-onnx-node`（win-x64 预编译）、`@roamhq/wrtc`（win-x64 预编译），均无需编译器；
- Python 侧车环境：`python -m venv python/.venv` + `numpy`（`python/requirements.txt`），仅前处理用；不装也能用，只是「本地降噪」不可选；
- 实时提示文案改为显示真实引擎（sherpa Zipformer / SenseVoice）。

## 0.1.7 有什么变化

- **转写模型升级到 Whisper small**（`Xenova/whisper-small`，量化版约 250 MB，走 hf-mirror 首次下载）：中文识别明显更准，仍在本机推理、不上传任何音频。
- **接入 Silero VAD 神经网络**检测人声（`onnx-community/silero-vad`，约 2 MB）：文件转写先切出真正有人说话的区间再逐段识别，长静音不再浪费时间也不易幻觉；实时转写用逐帧 VAD 判断「在说话 / 说完了」，按句出字。
  - VAD 推理跑在独立子进程（`vad-runtime/`，自带 onnxruntime-node 1.22），与 Whisper 的 ORT 1.14 隔离，避免同进程双版本冲突。
- **实时转写改为真正的流式输出**：浏览器采集 16 kHz 单声道 PCM，通过 WebSocket（`/ws/stt`）持续推给服务端，边收边出「中间结果（partial）」，一句说完立刻定稿（final）并带上时间轴，可继续导出 TXT / SRT。实时用 Whisper base 保证低延迟，文件转写用 small 保证精度（均可用环境变量覆盖）。
- 服务端堆内存上调到 8 GB（`package.json` 的 start/dev 与 `start-all.ps1`），whisper-small 常驻后不会 OOM。
- 新增 `scripts/fix-sharp.mjs`：启动前自动移除 `@xenova/transformers` 里坏掉的嵌套 `sharp`，避免 `npm install` 后转写模块加载失败。

## 0.1.6 有什么变化

- **网络安全模块接入网页终端**：新增 `#/terminal`「SSH / Telnet 终端」，在浏览器里直接连服务器 —— xterm.js 渲染、多会话标签、窗口自适应（列行数同步给远端）、断线自动回收；后端用 `ssh2`（SSH）与原生 `net` + IAC 协商（Telnet）在本机进程内转发，密码只在内存中用于本次握手，不落库。
- **OCR 模块改名「OCR 与转写」**（模块键仍是 `ocr`，接口 `/api/stt/*` 同属该模块权限）：一个页面四个标签 —— 图片 OCR / PDF 整本 OCR / 音视频转写 / 实时转写。
- **音视频转写**：本机跑 Whisper tiny（`@xenova/transformers` + ONNX Runtime，模型 ~40 MB，中英多语），ffmpeg 解码任意音视频 → 16 kHz 单声道 → 12 秒窗口逐段识别，输出文本与 SRT 字幕。
  - **离线转写**：提交即入后台队列（单并发，进度 0-100%，任务与文本落 `stt_jobs` 表），可以关页面去做别的，回来在「处理历史 → 语音转写任务」里下载 TXT。
  - **在线转写**：≤15 分钟音频同步返回，适合随手一段。
- **实时转写**：麦克风每 5 秒切片送本机 Whisper，边说边出字，可复制 / 导出 TXT / 导出 SRT。
- 模型下载走 `hf-mirror.com` 镜像（`huggingface.co` 直连受限时也可用），缓存在 `tmp/models`。
- 修复/兼容：`@xenova/transformers` 自带的旧版 `sharp` 在 Windows 上装不上二进制，安装时用 `--ignore-scripts` 并删除其嵌套 `sharp`，改用项目根目录的 `sharp@0.35`。

## 0.1.5 有什么变化

- **左侧导航独立滚动**：鼠标停在左侧菜单上滚动只滚菜单（矮窗口时菜单自己有滚动条），滚到头也不会把右侧页面带走；滚轮在右侧内容区才滚页面。
- **返回记住板块位置**：工具页的返回按钮改为「← 返回文档 / 图片 / PDF …」，回到进入前的分类页，并恢复该分类页的滚动位置（不再回到第一个板块的顶部）。
- **位置持久化**：分类页滚动位置按 `#/cat/<分类>` 记录在 sessionStorage，刷新页面、浏览器后退、跨分类来回切换都能回到原位；新打开标签页时从头开始。

## 0.1.4 有什么变化

- **全类型预览**：所有带文件的工具，选完文件立刻预览 —— 图片缩略图、PDF 首页缩略图（pdf.js 客户端渲染）、Word 文本、Excel 表格、PPT 分页要点、Markdown/TXT/HTML 文本、音频/视频播放器，浏览器不支持的媒体容器给出转码提示。
- **结果也能预览**：处理完成后结果卡片里直接看 —— PDF 首页缩略图、转出的 Word 文本、Excel 表格、TXT/MD 文本，图片与音视频保持原来的缩略图与播放器。
- **预览接口**：`/api/preview/document`（上传文件解析为 text / table / slides）与 `/api/preview/output`（按 `/files/...` 地址预览已生成文件），只允许本系统输出目录，越界地址直接 400。
- **OCR 页加预览**：选图后先看缩略图再识别。
- 新增 [preview.mjs](docbox/public/js/core/preview.mjs)（前端预览调度）与 [preview.mjs](docbox/src/routes/preview.mjs)（后端解析）。

## 0.1.3 有什么变化

- **文档模块扩到 15 项**（对齐 gongjuheji.com/document 的全部能力）：Word / Excel / PowerPoint / Markdown / 文本 → PDF，HTML ⇄ Word，Word → TXT / HTML / Markdown，Markdown → HTML，HTML → Markdown，Word 批量格式转换，公文一键排版，Markdown 编辑器，Markdown 表格生成器。
- **PDF 转换全部本地完成**：DOCX 用 OOXML 直写、PPTX 逐页解析（文字 + 图片）后用本机 Edge 打印，不装 Office / LibreOffice。
- **公文一键排版**：A4 版式（上 37 / 下 35 / 左 28 / 右 26 mm）、标题小标宋二号、一级标题黑体、二级楷体、正文仿宋三号、首行缩进两字、28 磅行距、页码（— 1 —）、附件另起一页，同时输出 Word + PDF。
- **Markdown 编辑器** `#/md-editor`：左侧编辑、右侧实时预览（服务端渲染 + 消毒）、字数行数统计、草稿自动存 localStorage，可导出 HTML / PDF / .md。
- **Markdown 表格生成器** `#/md-table`：按行列生成标准表格，支持表头与列对齐，一键复制 / 下载 / 送入编辑器。
- **音视频预览**：音视频工具选文件后立即内嵌播放器（显示格式、体积、时长、分辨率），处理结果卡片同样内嵌播放器；浏览器不支持的容器会提示先转码。
- 修复：单文件工具（PDF 拆分 / 页面管理 / 水印 / 文档类工具）上传字段名写死 `files` 导致 400 的问题。
- 修复：`/api/app` 的工具计数改为按实际目录计算（不再写死 75）。

## 0.1.2 有什么变化

- **账户与角色**：登录后才能使用，密码用 scrypt 加盐存储，会话落库（HttpOnly Cookie，7 天）。默认管理员 **root / root**。
- **模块级权限**：管理员可见 9 个模块（7 个工具模块 + 处理历史 + 账户管理）；普通用户只能看到被勾选的模块，左侧导航、工具卡片、路由**和接口**四处同时拦截，越权请求直接 403。
- **账户管理页** `#/accounts`：新建账户、切换角色、启停用、重置密码、逐账户勾选模块授权；内置 root 保护（不可删除/停用/降级）、至少保留一名启用的管理员。
- **展示卡片与模块对应**：右侧 hero 卡片随左侧所选模块变化（PDF 显示合并/加密/页面组织，音视频显示转码/GIF/音轨，网络安全显示端口/证书/响应头审计…），不再是一张通用展示图。
- 清理残留的 Stirling 入口（顶栏按钮、首页横幅、页脚链接）。

## 0.1.1 有什么变化

- **彻底移除 Stirling-PDF**：不再有 8090 端口、不再需要 JDK 25、`stirling/` 与 `runtime/`（约 1.7 GB）已删除。原 Stirling 的能力全部改写为原生实现，直接跑在 DocBox 的 3000 端口上。
- **新增音视频套件（18 项）**：基于 ffmpeg 的转码、压缩、剪辑、合并、GIF、抽帧、提音、变速、音量、静音、旋转、水印、图片转视频、淡入淡出、元数据清除。
- **新增网络安全套件（16 项）**：端口扫描、DNS、ping/traceroute、响应头审计、TLS 证书、RDAP、跳转链、耗时分解、目录探测、方法探测、服务指纹、本机网络、子域枚举、安全配置生成、IP 归属。
- **新增 23 项原生 PDF 能力**：旋转、删页、重排、裁剪、缩放、多页合一、小册子、拆分、叠加、长页拼接、解压、扁平化、去空白页、加密、解密、清理、读写元数据、PDF→图片/文字、图片提取、图片转 PDF、书签。
- **本地 MySQL 落库**：`jobs`（处理历史）、`templates`（水印模板）、`net_reports`（安全报告）、`settings`（偏好）；数据库不可用时自动降级，其余功能照常。
- **前端新增**：音视频 / 网络安全两个分类页、检测结果 JSON 面板（复制 / 下载）、`#/history` 处理历史页（筛选 / 清空）。
