# DocBox 0.3.0 · 单镜像（Node 应用 + MariaDB + FFmpeg + 中文 OCR/语音模型 + yt-dlp）
# 构建：podman build -t docbox:0.3.0 -f Dockerfile .
# 运行：podman run -d --name docbox -p 3000:3000 -v docbox-data:/data docbox:0.3.0
FROM docker.m.daocloud.io/library/node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=Asia/Shanghai \
    NODE_ENV=production \
    DOCBOX_HOST=0.0.0.0 \
    DOCBOX_PORT=3000 \
    DOCBOX_DATA_DIR=/data \
    DOCBOX_DB_HOST=127.0.0.1 \
    DOCBOX_DB_PORT=3306 \
    DOCBOX_DB_USER=docbox \
    DOCBOX_DB_PASSWORD=docbox \
    DOCBOX_DB_NAME=docbox

# 系统依赖：FFmpeg、中文字体、Python（APM 降噪）、MariaDB、tini
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg traceroute iproute2 fonts-wqy-zenhei fontconfig \
      python3 python3-pip python3-numpy python3-fonttools python-is-python3 \
      mariadb-server mariadb-client \
      ca-certificates curl tini tzdata xz-utils \
    && fc-cache -f >/dev/null 2>&1 \
    && rm -rf /var/lib/apt/lists/*

# 视频网站解析：yt-dlp（B 站 / YouTube / 爱奇艺 / 腾讯 / 优酷 等，构建期装好，运行时不联网下载）
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
    && yt-dlp --version

# pdf-lib 不能直接嵌入 TTC 字体集合：构建期从文泉驿 TTC 抽出 TTF
RUN mkdir -p /usr/share/fonts/truetype/docbox \
    && (python3 -c "from fontTools.ttLib import TTCollection; c=TTCollection('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'); c.fonts[0].save('/usr/share/fonts/truetype/docbox/DocBoxCJK.ttf')" || true) \
    && fc-cache -f >/dev/null 2>&1

ENV DOCBOX_FONT=/usr/share/fonts/truetype/docbox/DocBoxCJK.ttf

WORKDIR /app

# 依赖层（先装依赖，改代码不重复下载）
COPY docbox/package.json ./package.json
# --ignore-scripts：@xenova/transformers 内嵌的 sharp 0.32 会去 GitHub 下载 libvips（国内不可达）；
# 根依赖 sharp 0.33 用 @img/sharp-linux-x64 预编译包，无需下载。装完立刻验证 sharp 可用。
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund \
    && node -e "const s=require('sharp'); console.log('sharp', s.versions.sharp)" \
    && chmod +x node_modules/@ffprobe-installer/linux-x64/ffprobe node_modules/@ffmpeg-installer/linux-x64/ffmpeg 2>/dev/null || true

# VAD 运行时（onnxruntime-node）单独一层
COPY docbox/vad-runtime/package.json ./vad-runtime/package.json
RUN cd vad-runtime && npm install --omit=dev --ignore-scripts --no-audit --no-fund

# 预置语音模型（SenseVoiceSmall + 流式 zipformer + Silero VAD，420MB，运行时无需联网）
COPY deploy/models/ ./models/

# 应用代码 + Python APM 边车
COPY python/ ./python/
COPY docbox/ ./
RUN mkdir -p uploads outputs tmp models .cache \
    && node scripts/fix-sharp.mjs || true

# 模型已在上面 COPY 进来，这里只校验（离线镜像，不再联网下载）
RUN test -f models/sherpa/sense-voice/model.int8.onnx \
    && test -f models/sherpa/streaming-zipformer-zh-en/encoder-epoch-99-avg-1.int8.onnx \
    && test -f models/silero-vad-fp32.onnx \
    && du -sh models

# 启动脚本
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
