## DocBox v0.4.1

本地文档 / 图片 / PDF / 表格 / OCR / 音视频 / 网络工具箱，89 个工具，192 项冒烟断言全通过。

### 这个版本有什么

- **0.4.1**：成品文件保留策略——默认 24 小时自动清理，root 在「账户管理」可改为「永久保存」或任意小时数（设置存库，重启不丢）；后台每 30 分钟清理成品 + 视频中间产物 + 过期任务记录。
- **0.4.0**：内置无头浏览器嗅探——贴网页链接即可让后台 Edge/Chrome/Chromium 打开页面、监听网络抓 `.m3u8`（带 Referer/Cookie），再自动解析下载；零新增依赖（原生 CDP）。
- **0.3.2**：链接解析失败的修复（B 站站点内置解析、yt-dlp 一键安装、解析过程可视化）。
- **0.3.1**：视频解析链路重构 + 批量下载任务队列。

### 从源码构建（推荐）

```bash
git clone https://github.com/1314ysys/DocBox.git && cd DocBox
sudo bash deploy/build-image.sh          # Linux/macOS
sudo bash deploy/install-linux.sh --skip-load
```

```powershell
git clone https://github.com/1314ysys/DocBox.git; cd DocBox
powershell -ExecutionPolicy Bypass -File .\deploy\build-image.ps1
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1 -SkipLoad
```

脚本自动装/检查 podman、起虚拟机、下载语音模型（约 420MB，可跳过）、`podman build` 出单镜像，再一键起容器（数据卷 `docbox-data`）。

### 成品镜像

镜像 `docbox:0.4.1` 约 **4.31 GB**（含 Node 22、MariaDB 10.11、FFmpeg、chromium、中文字体、SenseVoice/zipformer/Silero 语音模型、yt-dlp），超出 GitHub 单文件上限，**不在本仓库**。
- 想快：用源码构建（约 10~20 分钟，需要能拉取 Docker Hub 与模型）；
- 需要现成 tar：联络作者或自行 `podman save` 打包。

### 默认账号

`root / root`，登录后请到「账户管理」改密码。

### 说明

仅供个人/团队本地使用：视频解析只处理你有权访问的公开链接，请遵守各站点条款与当地法律。
