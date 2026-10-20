/**
 * 本地 WebRTC 接收端（@roamhq/wrtc）
 * 浏览器推 mic 轨道 → 服务端 RTCPeerConnection 应答 → RTCAudioSink 取 PCM(48k, Int16)
 * → 线性重采样到 16k Float32 → 复用现有 stt-stream 管线。
 * 只做音频、本地无 STUN（127.0.0.1 回环），不需要公网。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let wrtc = null;
let loadError = null;
try { wrtc = require('@roamhq/wrtc'); } catch (err) { loadError = String(err.message || err); }

export function webrtcStatus() {
  return { available: Boolean(wrtc), error: loadError };
}

/** Int16 交织 → Float32 单声道 16k */
function toFloat16k(samples, sampleRate, channels = 1) {
  const frames = Math.floor(samples.length / channels);
  const mono = new Float32Array(frames);
  if (channels === 1) {
    for (let i = 0; i < frames; i++) mono[i] = samples[i] / 32768;
  } else {
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += samples[i * channels + c];
      mono[i] = sum / channels / 32768;
    }
  }
  if (sampleRate === 16000) return mono;
  const ratio = sampleRate / 16000;
  const out = new Float32Array(Math.floor(frames / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(frames - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }
  return out;
}

function waitIce(pc, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { try { pc.removeEventListener('icegatheringstatechange', check); } catch { /* 忽略 */ } resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeoutMs);
  });
}

/**
 * 处理浏览器的 offer，返回 answer SDP。
 * onPcm(Float32Array 16k) 每 ~20ms 回调一次；onState(state) 报告连接状态。
 */
export async function answerOffer(offerSdp, { onPcm, onState } = {}) {
  if (!wrtc) throw new Error('WebRTC 不可用：' + (loadError || '@roamhq/wrtc 未安装'));
  const pc = new wrtc.RTCPeerConnection({ iceServers: [] });
  const sinks = [];
  const report = (s) => { try { onState?.(s); } catch { /* 忽略 */ } };

  pc.onconnectionstatechange = () => report(pc.connectionState);
  pc.ontrack = (event) => {
    const track = event.track;
    if (track.kind !== 'audio') return;
    const sink = new wrtc.nonstandard.RTCAudioSink(track);
    sink.ondata = ({ samples, sampleRate, channelCount }) => {
      try { onPcm?.(toFloat16k(samples, sampleRate || 48000, channelCount || 1)); } catch { /* 忽略 */ }
    };
    sinks.push(sink);
    report('track');
  };

  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIce(pc);

  return {
    sdp: pc.localDescription ? pc.localDescription.sdp : answer.sdp,
    close() {
      for (const s of sinks) { try { s.stop(); } catch { /* 忽略 */ } }
      try { pc.close(); } catch { /* 忽略 */ }
    },
    get state() { return pc.connectionState; },
  };
}
