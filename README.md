# DocBox · 本地文档工具箱

**单进程、单端口、数据不出本机**的文档 / 图片 / 音视频 / 网络安全工作台。  
所有处理都在本机 Node 进程内完成（ffmpeg 仅作为子进程调用），任务记录写入本地 MySQL。

`v0.2.0` · 88 个可用工具 · SSH/Telnet 网页终端 · SenseVoice + sherpa-onnx 流式识别（WebRTC 采集 · 本地 APM 前处理 · 实时预览不抢编辑） · 全类型文件预览 · 账户角色与模块授权 · 181 项冒烟断言全通过

---

## 一键部署（Podman 容器，推荐）

不想装 Node / MySQL / FFmpeg，就用容器：一个镜像自带 Node 22、MariaDB、FFmpeg、中文字体、中文 OCR 与 SenseVoice/zipformer 语音模型，数据全部留在数据卷里。

```powershell
# Windows：右键「使用 PowerShell 运行」
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1
```

```bash
# Linux：自动装 podman → 载入镜像 → 起容器 → 等健康检查
sudo bash deploy/install-linux.sh --port 3000
```

- 镜像包 `docbox-0.2.0-image.tar`（`podman save` 导出，约 1.7GB），脚本里 `podman load` 从本地载入，不依赖镜像仓库；
- 数据卷 `docbox-data` → `/data`（MariaDB、上传、产物），删容器不丢数据；
- 默认账号 `root / root`，端口 3000，`/api/health` 用于健康检查。

细节、参数与常见问题见 **[deploy/README.md](deploy/README.md)**。

---

## 0.2.0 有什么变化

> 主题：**全工具自检 + 容器化交付。**

### 全工具自检（93/94，含 57 个套件工具 + 33 个原生工具）

- 新增 `npm run tools:check`：自动生成测试夹具（PDF/图片/音视频/Word/Excel/PPTX/Markdown），逐个真实调用 57 个套件工具与 33 个原生接口，下载产物校验大小；
- **修掉 2 个真实缺陷**：图片轮播（slideshow）输出高度不是偶数导致 libx264 失败；RDAP 查询补 User-Agent 与超时；
- 2 项失败为外部服务不可用（rdap.org 403、crt.sh 502），代码路径已验证。

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

## 账户与权限

首次启动会自动在 MySQL 里创建内置管理员：**root / root**（角色 `admin`，拥有全部模块）。

| 能力 | 管理员 | 普通用户 |
| --- | --- | --- |
| 可见模块 | 全部 9 个 | 仅被勾选的模块 |
| 账户管理 `#/accounts` | 可见可用 | 导航隐藏，接口 403 |
| 其他模块工具 | 全部可用 | 仅授权模块；未授权模块导航隐藏、卡片过滤、路由跳回首页、接口 403 |

模块键：`image`（图片）`pdf`（PDF）`doc`（文档）`sheet`（表格）`ocr`（OCR 与转写）`media`（音视频）`net`（网络安全）`history`（处理历史）`accounts`（账户管理，仅管理员）。

安全细节：

- 密码 `scrypt(N=16384, r=8, p=1)` + 16 字节随机盐，比较用 `timingSafeEqual`；
- 会话是 24 字节随机 sid，存在 `sessions` 表，Cookie 带 `HttpOnly; SameSite=Lax`；
- 同一账号 5 分钟内登录失败超过 8 次会被限流；
- 改密码 / 停用 / 删除账户会立刻注销该账户的会话；
- **数据库不可用时进入「免登录模式」**：本地工具照常可用（不会把自己锁在门外），登录页会提示数据库不可用。

## 快速开始

前置：Windows 10/11、**Node.js ≥ 20**（已验证 v24.20）、本机装有 Edge（文档转 PDF 用）。  
MySQL 8.x 可选：没有也能用，只是「处理历史」不可用。

```powershell
cd docbox
npm install --ignore-scripts   # 首次
cd vad-runtime && npm install && cd ..   # Silero VAD 独立运行时（约 40MB native）
cd ..
python -m venv python\.venv               # 可选：本地音频前处理（numpy 降噪/AGC）
python\.venv\Scripts\python -m pip install -r python\requirements.txt
.\start-all.ps1      # 启动（会顺带拉起 MySQL 服务并打开浏览器）
```

> `vad-runtime/` 是**刻意**与主依赖树隔离的独立包：主树的 Whisper 用 onnxruntime-node 1.14，
> VAD 用 1.22，同进程双版本会崩。`start-all.ps1` / `npm start` 会自动清理 transformers 里坏掉的嵌套 sharp。

打开 <http://127.0.0.1:3000/>，停止用 `.\stop-all.ps1`。

也可以手动跑：

```powershell
cd docbox
npm start            # node --max-old-space-size=8192 server.mjs
npm run smoke        # 167 项冒烟检查（需服务已启动）
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
- `users(id, username, password_hash, role, status, display_name, last_login_at)` — 账户（scrypt 哈希，默认 root/root）
- `user_modules(user_id, module)` — 普通用户的模块授权
- `sessions(sid, user_id, ip, ua, expires_at)` — 登录会话

> 想换库名/密码，改 `docbox/src/config.mjs` 的 `DB` 或设环境变量即可。

## 文档工具（15 项）

对标 <https://gongjuheji.com/document> 的全部能力，全部本机实现：

| 工具 | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| Word 转 PDF | .docx | PDF | 保留标题 / 列表 / 表格 / 图片（mammoth + Edge 打印） |
| Excel 转 PDF | .xlsx / .xls / .csv | PDF | 多工作表自动分页 |
| PowerPoint 转 PDF | .pptx | 横向 PDF | 逐页解析文字与图片，A4 横向打印 |
| Markdown 转 PDF | .md | PDF | 支持表格、代码块、引用 |
| 文本转 PDF | .txt | PDF | 等宽保留换行 |
| Markdown 编辑器 | 手动输入 | HTML / PDF / .md | 实时预览、草稿保存 |
| HTML 转 Word | .html | .docx | 标题 / 列表 / 加粗转成 Word 段落 |
| Word 转 HTML | .docx | .html | 带样式的独立文件 |
| Word 转 TXT | .docx | .txt | 纯文本提取 |
| Word 格式转换（批量） | 多文件 | TXT / HTML / MD / PDF | 一次转多个，自动打包 |
| Word 转 Markdown | .docx | .md | ATX 标题 + 列表 |
| Markdown 转 HTML | .md | .html | 独立 HTML（自带样式） |
| HTML 转 Markdown | .html | .md | turndown 转换 |
| 公文一键排版 | .docx / .txt / .md | Word + PDF | A4、仿宋三号、缩进、页码、附件换页 |
| Markdown 表格生成器 | 行列数 | Markdown 表格 | 表头 + 列对齐 |

> 图片转 PDF 在「图片」模块（图片合成 PDF），同样属于文档流水线。

## 工具清单（88 项可用）

| 分类 | 数量 | 代表能力 |
| --- | --- | --- |
| 图片 | 7 | 压缩、格式转换（含 AVIF）、尺寸调整、7 套水印、图片编辑、证件照 A4 排版、图片合成 PDF |
| PDF（自研基础） | 7 | 合并、拆分、页面管理、PDF 水印、页码、压缩、拆解导出 |
| PDF（原生套件） | 21 | 旋转 / 删页 / 重排 / 裁剪 / 缩放 / 多页合一 / 小册子 / 叠加 / 长页 / 解压 / 扁平化 / 去空白 / 加密(AES-256) / 解密 / 清理 / 元数据读写 / PDF→图片 / PDF→文字 / 图片提取 / 图片转 PDF / 书签 |
| 文档 | 15 | Word / Excel / PPT / Markdown / 文本 → PDF，HTML ⇄ Word，Word → TXT / HTML / MD，Markdown → HTML，批量转换，公文排版，Markdown 编辑器，表格生成器 |
| 表格 | 2 | Excel ⇄ CSV ⇄ JSON、多工作表拆分 |
| OCR 与转写 | 2 | 图片 + 整本 PDF 的离线中文 OCR（tesseract.js v7 + chi_sim）；音视频 SenseVoice 转写（Silero VAD 分段，离线后台任务 / 在线同步）+ 麦克风 Zipformer 流式实时转写（WebRTC / WS PCM，可选本地 APM 降噪）+ SRT 导出 |
| 账户管理 | 1 | 创建账户、角色（管理员/普通用户）、按模块授权、启停用、重置密码 |
| 音视频 | 18 | 转码、压缩、提取音轨、音频转码、截取、合并、GIF、抽帧、缩放、变速、响度、静音、旋转、水印、图片轮播、淡入淡出、探明信息、清元数据 |
| 网络安全 | 17 | 端口扫描（64 并发/顶 1000 端口）、DNS、ping、traceroute、响应头评级、TLS 证书、RDAP、跳转链、耗时、目录探测、方法探测、服务指纹、本机网络、子域枚举、安全配置生成、IP 归属、SSH/Telnet 网页终端 |

## 目录结构

```
docbox/
  server.mjs               # Express 5 入口（唯一进程、唯一端口 3000）
  src/
    config.mjs             # 端口/路径/DB/ffmpeg 路径/版本号
    tool-catalog.mjs       # 57 条套件工具元数据（PDF 23 / 音视频 18 / 网络 16）
    lib/
      db.mjs               # mysql2 连接池 + 建表 + jobs/templates/reports/settings/users/sessions/user_modules
      auth.mjs             # scrypt 密码、Cookie 会话、模块权限中间件
      pdfops.mjs           # 23 项原生 PDF 实现
      pdf-render.mjs       # pdfjs + @napi-rs/canvas 渲染
      media.mjs            # ffmpeg/ffprobe 封装（18 项）
      docops.mjs           # DOCX 直写 / PPTX 解析 / 公文排版 / Markdown 工具
      netprobe.mjs         # 网络探测（16 项，纯 Node 实现）
      track.mjs            # 处理记录写入
    routes/                # auth / accounts / preview / image / idphoto / pdf / suite / history / doc / sheet / ocr / stt / terminal / meta
  public/                  # 原生 ES 模块前端（core / tools / views），含登录页、账户管理、Markdown 编辑器、音视频预览
  scripts/smoke.mjs        # 159 项冒烟测试
  testdata/                # 冒烟用样例（PDF / 图片 / 音视频 / 表格 / Word / PPTX / Markdown / HTML）
version/                   # 版本基线（VERSION.json + CHANGELOG.md + 源码快照）
```

## 安全声明

网络安全分类**只面向自有或已获授权的资产**：没有口令爆破、漏洞利用或第三方扫描服务，全部为连通性、指纹与配置审计的本地实现，每条结果都带 `warning: 仅限自有或已获授权的资产`。请勿用于未授权目标。

## 验证

- `npm run smoke`：**181/181 通过**（登录/权限 16 · 图片/证件照 5 · PDF 基础 7 · PDF 套件 22 · 文档 16 · 预览 11 · 音视频 16 · 网络安全 15 · 终端 4 · 转写 26 · 数据库 10 · 其它 29）
- 浏览器（Edge/Chromium）实测：首页 88 张卡片、文档 15 项、图片/PDF/Word/Excel/PPT/Markdown/TXT 七类预览、结果 PDF 与 Word 预览、OCR 缩略图、音视频播放器、Markdown 编辑器导出、公文排版、账户权限，均无控制台报错。

## 版本历史

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 0.1.5 | 2026-10-20 | 左侧导航独立滚动条；工具返回改为回到所属分类并恢复滚动位置（含刷新/后退） |
| 0.1.4 | 2026-10-20 | 全类型文件预览：图片 / PDF 首页 / Word 文本 / Excel 表格 / PPT 分页 / Markdown-TXT 文本 / 音视频播放器，结果卡片同样可预览 |
| 0.1.3 | 2026-10-20 | 文档模块扩到 15 项（对齐 gongjuheji.com/document：PPT/Html↔Word/TXT/批量/公文排版/MD 编辑器/表格生成器），音视频预览播放器 |
| 0.1.2 | 2026-10-20 | 登录 + 角色 + 模块授权（导航/路由/接口三重拦截）、账户管理页、展示卡片与模块一一对应 |
| 0.1.7 | 2026-10-20 | 转写模型升级 Whisper small、接入 Silero VAD 神经网络检测人声（独立进程隔离 onnxruntime），实时转写改为 WebSocket PCM 流式输出（Whisper base 低延迟、按句定稿） |
| 0.1.6 | 2026-10-20 | 网络安全接入 SSH/Telnet 网页终端（xterm.js + WebSocket，多会话）；OCR 改名「OCR 与转写」，新增 Whisper tiny 音视频转写（离线后台任务 / 在线同步）与麦克风实时转写，支持 SRT 导出 |
| 0.1.1 | 2026-10-20 | 移除 Stirling-PDF 端口与 JDK；新增音视频 18 项、网络安全 16 项、原生 PDF 21 项；接入本地 MySQL；新增历史页 |
| 0.1.0_beta | 2026-10-20 | 首个基线：Stirling 融合 + 7 套水印 + 离线 OCR + 前端模块化 |

详见 `version/<版本>/CHANGELOG.md`。

## License

MIT
