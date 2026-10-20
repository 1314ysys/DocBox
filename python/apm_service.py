#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
DocBox 本地音频前处理服务（Python 侧车）

优先使用 webrtc-audio-processing（WebRTC APM：噪声抑制 + 自动增益 + 高通/回声消除），
如果没有安装（Windows 上该包只有源码，需要 MSVC + meson 编译），退回到等价的
numpy DSP 链路：DC 去直流 → 80Hz 高通 → 谱减降噪 → AGC 软限幅。

协议（stdin/stdout，二进制小端）：
  请求：  {"len": N}\n + N * float32    (16kHz 单声道)
  响应：  {"len": M}\n + M * float32
启动时先输出一行： {"backend": "webrtc-apm"|"numpy-dsp", "sr": 16000}
"""
import sys
import json
import struct
import numpy as np

SR = 16000
FRAME = 160  # 10ms，APM 要求

backend = "numpy-dsp"
apm = None
try:
    from webrtc_audio_processing import AudioProcessing  # type: ignore
    apm = AudioProcessing()
    apm.set_stream_format(SR, 1, 1)
    apm.set_config(aec=False, ns=True, agc=True)
    backend = "webrtc-apm"
except Exception:
    apm = None


class NumpyApm:
    """无编译依赖的降噪 + AGC 兜底实现"""

    def __init__(self):
        self.prev_x = 0.0
        self.prev_y = 0.0
        self.noise = None
        self.gain = 1.0

    def _highpass(self, x):
        # 一阶高通，截止 ~80Hz
        r = 0.969
        y = np.empty_like(x)
        px, py = self.prev_x, self.prev_y
        for i in range(len(x)):
            py = r * (py + x[i] - px)
            px = x[i]
            y[i] = py
        self.prev_x, self.prev_y = px, py
        return y

    def _denoise(self, x):
        n = len(x)
        if n < 256:
            return x
        win = np.hanning(n)
        spec = np.fft.rfft(x * win)
        mag = np.abs(spec)
        if self.noise is None or len(self.noise) != len(mag):
            self.noise = mag.copy()
        else:
            self.noise = 0.92 * self.noise + 0.08 * np.minimum(mag, self.noise * 1.6)
        clean = np.maximum(mag - 1.8 * self.noise, 0.08 * mag)
        phase = np.exp(1j * np.angle(spec))
        out = np.fft.irfft(clean * phase, n)
        return out

    def _agc(self, x):
        rms = float(np.sqrt(np.mean(x * x)) + 1e-9)
        target = 0.06
        want = min(4.0, max(0.5, target / rms))
        self.gain = 0.9 * self.gain + 0.1 * want
        y = x * self.gain
        peak = float(np.max(np.abs(y)) + 1e-9)
        if peak > 0.98:
            y = y * (0.98 / peak)
        return y

    def process(self, x):
        y = self._highpass(x)
        y = self._denoise(y)
        y = self._agc(y)
        return y.astype(np.float32)


fallback = NumpyApm()


def process_block(x):
    if apm is not None:
        out = np.empty_like(x)
        for i in range(0, len(x), FRAME):
            chunk = x[i:i + FRAME]
            if len(chunk) < FRAME:
                chunk = np.pad(chunk, (0, FRAME - len(chunk)))
            arr = chunk.astype(np.int16, copy=False)
            res = apm.process_stream(arr.tobytes(), stream_delay_ms=0)
            if isinstance(res, (bytes, bytearray)) and len(res) >= FRAME * 2:
                out[i:i + FRAME] = np.frombuffer(res[:FRAME * 2], dtype=np.int16).astype(np.float32) / 32768.0
            else:
                out[i:i + FRAME] = arr.astype(np.float32) / 32768.0
        return out
    return fallback.process(x)


def read_exact(n):
    buf = b""
    while len(buf) < n:
        part = sys.stdin.buffer.read(n - len(buf))
        if not part:
            return None
        buf += part
    return buf


def main():
    sys.stdout.write(json.dumps({"backend": backend, "sr": SR, "frame": FRAME}) + "\n")
    sys.stdout.flush()
    inp = sys.stdin.buffer
    out = sys.stdout.buffer
    while True:
        header = inp.readline()
        if not header:
            break
        try:
            meta = json.loads(header.decode("utf-8"))
            n = int(meta.get("len", 0))
            rid = int(meta.get("id", 0))
        except Exception:
            continue
        if n <= 0:
            out.write(json.dumps({"len": 0, "id": rid}).encode("utf-8") + b"\n")
            out.flush()
            continue
        raw = read_exact(n * 4)
        if raw is None:
            break
        x = np.frombuffer(raw, dtype=np.float32)
        y = process_block(x) if len(x) else x
        payload = np.ascontiguousarray(y, dtype=np.float32).tobytes()
        out.write(json.dumps({"len": len(y), "id": rid}).encode("utf-8") + b"\n")
        out.write(payload)
        out.flush()


if __name__ == "__main__":
    main()
