/**
 * 构建镜像时预下载语音模型（SenseVoiceSmall / 流式 zipformer / Silero VAD）。
 * 模型落到 tmp/models，运行时无需联网。
 */
process.env.DOCBOX_STT_BACKEND = process.env.DOCBOX_STT_BACKEND || 'sherpa';
const { ensureSherpaModels } = await import('../src/lib/asr-sherpa.mjs');
const { ensureVad } = await import('../src/lib/vad.mjs');

console.log('[prefetch] 下载 SenseVoiceSmall + 流式 zipformer ...');
await ensureSherpaModels();
console.log('[prefetch] 下载 Silero VAD ...');
await ensureVad();
console.log('[prefetch] 模型准备完成');
