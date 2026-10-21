# DocBox 容器部署（Podman 单镜像）

一个镜像 = Node 应用 + MariaDB + FFmpeg + 中文字体 + 中文 OCR/语音模型 + yt-dlp（视频网站解析）。
数据都在容器内 `/data` 卷里，删容器不丢数据；对外只暴露一个端口（默认 3000）。

| 内容 | 说明 |
| --- | --- |
| 镜像 | `docbox:0.4.0`（加载自 `docbox-0.4.0-image.tar`，约 3.4 GB） |
| 端口 | 宿主机 `3000` → 容器 `3000` |
| 数据卷 | 默认命名卷 `docbox-data` → `/data`（MariaDB 数据、上传、产物、缓存） |
| 默认账号 | `root / root`（首次登录后请到「账户管理」改密码） |
| 内存 | 建议 ≥ 4 GB（podman 虚拟机建议 6 GB） |

## 文件清单

```
deploy/
├── install-windows.ps1        # Windows 一键部署（自动装 podman / 初始化虚拟机 / 载入镜像 / 起容器）
├── install-linux.sh           # Linux 一键部署（apt/dnf/zypper/pacman 自动装 podman）
├── docker-entrypoint.sh       # 容器入口（初始化 MariaDB → 建库建号 → 启动应用）
└── docbox-0.4.0-image.tar     # 由发行包提供：podman save 导出的镜像（也支持 .tar.gz）
```

## Windows 一键部署

前置：Windows 10/11（x64），有网络（首次安装 Podman 和初始化虚拟机）。

1. 把 `docbox-0.4.0-image.tar` 放到 `deploy\` 目录（或留在一键脚本同级）。
2. 右键 `install-windows.ps1` → **使用 PowerShell 运行**；或：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1
   ```

3. 脚本会自动：
   - 检测 podman，缺失则 `winget install RedHat.Podman`；
   - `podman machine init/start`（首次自动创建 4 核 / 6 GB / 80 GB 的虚拟机）；
   - `podman load -i docbox-0.4.0-image.tar`；
   - 创建数据卷并以 `--restart=always` 启动容器；
   - 轮询 `/api/health`，就绪后打开浏览器。

常用参数：

```powershell
.\install-windows.ps1 -Port 8080 -Volume docbox-data2 -NoBrowser
```

## Linux 一键部署

前置：任意主流发行版（Debian/Ubuntu、RHEL/Fedora、openSUSE、Arch），有网络（首次装 podman）。

```bash
sudo bash deploy/install-linux.sh                # 默认 3000 端口 + 命名卷
sudo bash deploy/install-linux.sh --port 8080 --data-dir /srv/docbox
sudo bash deploy/install-linux.sh --boot         # 额外生成 systemd 用户服务，开机自启
```

脚本会按包管理器安装 podman（apt/dnf/zypper/pacman），载入镜像、建卷、启动容器并等待健康检查。
`--boot` 会在 `~/.config/containers/systemd/docbox.container` 生成 quadlet 单元并启用（含 `enable-linger`）。

## 验证

```bash
curl http://127.0.0.1:3000/api/health
# {"ok":true,"version":"0.4.0", ...}
podman logs -f docbox      # 查看启动日志
```

浏览器打开 <http://127.0.0.1:3000>，用 `root / root` 登录；88 个工具全部在本机运行，不上传云端。

## 数据与备份

- 命名卷：`podman volume inspect docbox-data` 查看挂载点；备份卷目录即备份全部数据。
- 绑定目录：用 `--data-dir /srv/docbox` 时数据直接落盘，备份该目录即可。
- 升级：载入新镜像后重跑脚本（会自动重建容器、保留数据卷）。
- 完全卸载：`podman rm -f docbox && podman volume rm docbox-data`。

## 常见问题

**端口被占用**：`--port 8080` 换端口；Windows 上查 `netstat -ano | findstr :3000`。

**首次启动比较慢**：入口要先初始化 MariaDB（约 20~60 秒），之后每次启动 5 秒左右。

**容器起来但页面打不开**：`podman logs docbox` 看日志；Windows 确认 `podman machine list` 里虚拟机是 Running。

**网络类工具（测速/DNS/WHOIS）失败**：这些工具需要宿主机能出网；容器内 DNS 与宿主机一致，代理环境请给 podman 虚拟机配同样的代理。

**镜像多大**：`podman images docbox` 约 1.5~2 GB（含 Node 依赖、FFmpeg、MariaDB、SenseVoice/zipformer 语音模型）。

## 已验证

- 镜像可正常启动：MariaDB 10.11 初始化 + 建库建号 + 应用监听 3000，`/api/health` 返回 200；
- 容器内实测通过：中文 PDF 水印、文档转 PDF（无浏览器时走纯文本兜底排版）、公文排版、SenseVoice 快速转写（模型已打包在镜像里，无需联网）、APM 降噪（python3 + numpy）；
- 实测 `scripts/tools-check.mjs`：宿主机 **93/94**（唯一失败是 crt.sh 外部接口 502）；容器内 **91/94**，剩下 3 项全是需要外网的目标探测（RDAP / HTTP 方法探测 / crt.sh），容器无外网属部署环境限制，不是工具缺陷。
