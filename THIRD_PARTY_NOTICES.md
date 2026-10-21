# 第三方组件与许可（THIRD-PARTY NOTICES）

DocBox 本体以 **MIT License** 发布（见仓库根目录 [LICENSE](LICENSE)）。
下列第三方组件随仓库分发或在容器镜像中部署，各自遵循其原始许可：

- Stirling-PDF (https://github.com/Stirling-Tools/Stirling-PDF) — MIT License
  for the core; certain open-core directories have separate licenses.
- miniPaint (https://github.com/viliusle/miniPaint) — MIT License,
  Copyright (c) ViliusL; see docbox/public/minipaint/LICENSE.txt.
- PDF.js — Apache License 2.0
- pdf-lib — MIT License
- sharp — Apache License 2.0
- Express — MIT License
- Mammoth — BSD-2-Clause
- marked — MIT License
- SheetJS Community Edition — Apache License 2.0
- JSZip — MIT License
- Turndown — MIT License

## 说明

- 容器镜像内还安装了 Debian 包（Node.js、MariaDB、FFmpeg、chromium、字体等），各自遵循 Debian 打包的许可；
- 语音模型 SenseVoice / 流式 Zipformer（csukuangfj，Apache-2.0）与 Silero VAD（MIT）在构建时下载，不入仓库；
- 若你再分发镜像或修改后的代码，请保留本文件与对应组件的许可声明。
