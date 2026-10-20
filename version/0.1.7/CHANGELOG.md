# 0.1.7 · 2026-10-20

> 主题：**转写从"能听清"到"听得准 + 说得快"——Whisper small、Silero VAD、真流式。**

## 变更

### 1. 转写模型 tiny → whisper-small

- `src/lib/stt.mjs`：默认模型改为 `Xenova/whisper-small`（量化 ONNX，约 250 MB），环境变量 `DOCBOX_STT_MODEL` 可覆盖。
- 实测同一段中文（testdata/speech-zh.wav）：
  - tiny：`你好,这是语音专系功能的课事.box支持中文和 english 食别`
  - small：`你好,这是语音转写功能的测试。Dockbox 支持中文和 English 识别`
- 仍走 hf-mirror 首次下载、本机推理，音频不出机器。

### 2. 接入 Silero VAD（神经网络人声检测）

- 新模块 `src/lib/vad.mjs` + `vad-runtime/`（独立子进程 + 自带 onnxruntime-node 1.22）：
  - 模型 `onnx-community/silero-vad`（`onnx/model.onnx`，约 2 MB，16 kHz / 512 采样一帧，带状态张量）。
  - 必须跑在独立进程：Whisper 用 ORT 1.14，同进程再加载 1.22 会 OOM / 崩溃（`STATUS_STACK_BUFFER_OVERRUN`、`BFCArena::AllocateRawInternal Failed`）。
  - 协议：stdin/stdout 逐行 JSON，`detect` 一次切段、`frames` 流式逐帧。
- 文件转写：先 VAD 切出人声区间再逐段识别（跳过长静音、减少幻觉），VAD 不可用时自动退化为 12 秒固定窗口。
- 实时转写：逐帧 VAD 判断「在说话 / 说完了」，静音 ≥450ms 即定稿。

### 3. 实时转写改为 WebSocket 流式输出

- `src/lib/stt-stream.mjs`：每会话缓冲 + VAD 状态机 + 串行解码队列（`session.chain`，避免并发改缓冲区）。
  - 说话中每 1.8 秒出一个 partial，一句说完出 final（带 start/end 时间轴），`stop` 时对未完成句子强制定稿。
  - 积压保护：解码落后 >0.8 秒就跳过中间结果，保证 final 不排队。
  - 实时用 `Xenova/whisper-base`（单次约 2.6s，低延迟），文件/离线用 whisper-small（单次约 5.8s，高精度），`DOCBOX_STT_STREAM_MODEL` 可覆盖。
- `src/routes/stt.mjs`：`POST /api/stt/stream`（返回 ws 地址）、`GET /api/stt/streams`、`POST /api/stt/stream/:id/stop`、`DELETE /api/stt/stream/:id`。
- `server.mjs`：`upgrade` 接管 `/ws/stt?id=`，二进制 → Float32 PCM 入队，JSON 控制帧 `{"type":"stop"}`。
- 前端 `views/ocr.mjs` 实时标签页重写：AudioContext（优先 16 kHz）+ ScriptProcessor 采集 → WebSocket 推 PCM；中间结果实时刷新，定稿后追加；可复制 / TXT / SRT。

### 4. 运行时与工程

- 服务端堆内存 `--max-old-space-size` 1536 → **8192**（`package.json` start/dev、`start-all.ps1`）：whisper-small 常驻约 2.5 GB，原参数会 `FATAL ERROR: v8::ArrayBuffer::New Allocation failed`。
- 新增 `scripts/fix-sharp.mjs` 并挂到 `prestart`/`predev`：删掉 `@xenova/transformers` 里坏掉的嵌套 `sharp`（npm install 会带回来），否则转写模块加载即失败。
- 新增 `vad-runtime/`（独立 package.json + node_modules，不进主依赖树）。
- `/api/stt/status` 增加 `streamModel`、`vad`（phase/percent/pid）、`modelsLoaded`。

## 测试

- `npm run smoke`：**167/167 通过**（新增 转写模型 whisper-small / 实时模型 whisper-base / Silero VAD 已接入 / 流式会话创建、计数、关闭 等断言）。
- 实测流式（1× 实时推 5 秒 PCM）：`[partial] 你好,這是語音專系` → `[final] 你好,這是語音轉寫功能的測試。`
- 文件转写（speech-silence.wav，17 秒 = 说话+1.5s 静音+说话）：VAD 切出 3 段（0–3.4s / 4.0–7.3s / 9.3–16.8s），逐段识别正确。

## 已知取舍

- whisper-small 单次解码约 5.8s（30s 窗口 + CPU INT8），不适合 1 秒级中间结果，因此实时默认 base；如需更高精度可设 `DOCBOX_STT_STREAM_MODEL=Xenova/whisper-small`，代价是出字变慢。
- 首次使用需下载 whisper-small（~250MB）与 Silero VAD（~2MB），均从 hf-mirror 拉取并缓存在 `tmp/models`。

## 文件

- 新增：`src/lib/vad.mjs`、`src/lib/stt-stream.mjs`、`vad-runtime/worker.mjs`、`vad-runtime/package.json`、`scripts/fix-sharp.mjs`、`testdata/speech-silence.wav`
- 修改：`src/lib/stt.mjs`、`src/routes/stt.mjs`、`server.mjs`、`public/js/views/ocr.mjs`、`public/index.html`、`package.json`、`scripts/smoke.mjs`、`../start-all.ps1`、`../README.md`
