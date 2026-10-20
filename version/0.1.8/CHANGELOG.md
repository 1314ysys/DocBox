# 0.1.8 · 2026-10-20

> 主题：**换掉 whisper：sherpa-onnx（SenseVoice + 流式 Zipformer）、本地 WebRTC 采集、Python 音频前处理。**

## 背景

用户问："实时转写可否用 faster-whisper 或其他高精度低资源占用的模型（国产 Qwen / SenseVoice 量化）？再增加本地 WebRTC 服务和 webrtc-audio-processing Python。"

实测结论（同一段 7.78s 中文 testdata/speech-zh.wav）：

| 方案 | 用时 | 实时倍率 | 备注 |
| --- | --- | --- | --- |
| whisper-small（0.1.7 文件） | ~17.4s | 0.45× | 自回归解码，30s 窗口 padding |
| whisper-base（0.1.7 实时） | ~2.6s/次 | 3× | 只有句末定稿，partial 要等 |
| **SenseVoiceSmall int8** | **0.92s** | **8.5×** | 非自回归，自带标点 |
| **流式 Zipformer int8** | **0.88s 全程** | **8.8×** | 真流式，0.3s 一个 partial |
| faster-whisper（评估） | 估 4~6s | 1.5~2× | 仍需 Python + CTranslate2，不如 SenseVoice |
| Qwen ASR（评估） | 数秒/句 | CPU 不适合 | LLM 解码，无 GPU 时太慢；API 版需联网 |

## 变更

### 1. 新增 sherpa-onnx 识别后端（`src/lib/asr-sherpa.mjs`）

- 离线：`csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`（`model.int8.onnx`，约 230MB）；
- 实时：`sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`（encoder/joiner int8 + decoder fp32，约 100MB）；
- 模型自动从 hf-mirror 下载到 `tmp/models/sherpa/`，首次约 330MB；
- `stt.mjs` 文件转写改为 VAD 切段 → SenseVoice 逐段识别（`DOCBOX_STT_BACKEND=whisper` 可退回旧链路）；
- `stt-stream.mjs` 实时改为流式识别器直接出 partial（每 180ms 节流），VAD 只负责断句；`DOCBOX_STT_STREAM_ENGINE=whisper` 可退回。

### 2. 本地 WebRTC 采集（`src/lib/webrtc.mjs` + `@roamhq/wrtc`）

- `/ws/stt` 支持 `{type:'offer', sdp}` → 服务端 `RTCPeerConnection` 应答 → `RTCAudioSink` 取 16k PCM；
- 非 trickle：前端等 `iceGatheringState==='complete'` 再发 offer（否则回环候选缺失，连接建立但无声）；实际浏览器协商到 16kHz 单声道；
- 前端实时页新增「传输」选择：WebSocket PCM / WebRTC；WebRTC 失败自动回退提示。

### 3. Python 音频前处理侧车（`python/apm_service.py`）

- 协议：stdin/stdout，`{"len":N,"id":K}\n` + float32；
- 优先 `webrtc_audio_processing`（WebRTC APM：NS/AGC/AEC）——但该包在 Windows 无 wheel、需要 MSVC + meson，本机 VS 2022 未装 C++ 工具链，故实际运行 numpy DSP：去直流 → 80Hz 高通 → 谱减降噪 → AGC 软限幅；
- `/api/apm/status` 报告 backend（`webrtc-apm` / `numpy-dsp`）、python 路径、可用性；`/api/apm/test` 做 3200 采样回环自测；
- `POST /api/stt/stream {apm:true}` 启用；侧车异常自动降级（`apmBroken`）并推 warn，不影响转写。

### 4. 依赖与工程

- 新增 npm：`sherpa-onnx-node@1.13.8`（win-x64 预编译）、`@roamhq/wrtc`（win-x64 预编译）；均无编译步骤；
- 新增 Python：`python/requirements.txt`（numpy），venv 在 `python/.venv`（不装则前处理不可选）；
- 实测：PyPI 直连偏慢，numpy 用清华镜像 wheel 离线安装完成。

## 验证

- `npm run smoke`：**174/174 通过**（新增 识别后端 SenseVoice、sherpa 模型路径、本地 APM 侧车、本地 WebRTC 可用、APM 处理长度守恒）；
- 文件转写（speech-silence.wav 17s，VAD 切 3 段）→ SenseVoice 全部正确、带标点；
- 流式（Node 侧 RTCAudioSource 合成轨道）：`partial` 逐字推进 → `final`；
- 浏览器（Edge headless + fake mic）：WebSocket PCM 与 WebRTC 两条链路都能出字（WebRTC 端实测 `ontrack audio` + 16k 帧），APM 开启后无 console 错误。

## 文件

- 新增：`src/lib/asr-sherpa.mjs`、`src/lib/webrtc.mjs`、`src/lib/apm.mjs`、`python/apm_service.py`、`python/requirements.txt`
- 修改：`src/lib/stt.mjs`、`src/lib/stt-stream.mjs`、`src/routes/stt.mjs`、`server.mjs`、`public/index.html`、`public/js/views/ocr.mjs`、`scripts/smoke.mjs`、`README.md`
