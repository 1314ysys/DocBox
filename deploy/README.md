# DocBox 容器部署（Podman 单镜像）

一个镜像 = Node 应用 + MariaDB + FFmpeg + 中文字体 + 中文 OCR/语音模型 + yt-dlp（视频网站解析）。
数据都在容器内 `/data` 卷里，删容器不丢数据；对外只暴露一个端口（默认 3000）。

| 内容 | 说明 |
| --- | --- |
| 镜像 | `docbox:0.4.4`（脚本默认从阿里云 ACR 自动拉取，约 4.3 GB；也可用离线 tar 或从源码构建） |
| 端口 | 宿主机 `3000` → 容器 `3000` |
| 数据卷 | 默认命名卷 `docbox-data` → `/data`（MariaDB 数据、上传、产物、缓存） |
| 默认账号 | `root / root`（首次登录后请到「账户管理」改密码） |
| 内存 | 建议 ≥ 4 GB（podman 虚拟机建议 6 GB） |

## 文件清单

```
deploy/
├── install-windows.ps1        # Windows 一键部署（自动装 podman / 初始化虚拟机 / 载入镜像 / 起容器）
├── install-linux.sh           # Linux 一键部署（apt/dnf/zypper/pacman 自动装 podman）
├── build-image.ps1            # Windows：从源码构建镜像（不用镜像包）
├── build-image.sh             # Linux/macOS：从源码构建镜像
├── fetch-models.mjs           # 下载语音模型到 deploy/models（约 420 MB，构建镜像用）
├── docker-entrypoint.sh       # 容器入口（初始化 MariaDB → 建库建号 → 启动应用）
├── models/                    # 语音模型目录（仓库不存模型，用 fetch-models.mjs 拉取）
└── docbox-0.4.4-image.tar     # 可选：podman save 导出的成品镜像（约 4.3 GB，仓库不含，按需自己导出/网盘取）
```

## 三种装法（脚本会自动按顺序回退，不用记）

| 方式 | 需要什么 | 命令 |
| --- | --- | --- |
| **0. 阿里云 ACR 自动拉取**（默认，最省事） | 能访问 `crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev`，约 4.3 GB 下载 | 直接跑脚本，一条命令 |
| **A. 离线镜像包** | `docbox-0.4.4-image.tar`（4.3 GB，仓库不含，网盘/内网取） | 把 tar 放 `deploy/` 或仓库根目录后跑同一命令；或 `--image-tar PATH` |
| **B. 从源码构建** | 源码 + 能上网（拉依赖/模型），约 10~20 分钟 | `bash deploy/build-image.sh` → `bash deploy/install-linux.sh --skip-load` |

脚本流程：**有 tar 就 load → 没有就看本地有没有镜像 → 都没有就自动 `podman pull` ACR**；三条路都不通时它会直接把上面三种办法打出来（不会静默失败）。完全离线可加 `--no-pull`。

### 默认用法（ACR，一条命令）

```bash
# Linux
sudo bash deploy/install-linux.sh

# Windows（PowerShell）
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1
```

脚本会：装 podman（没有的话）→ 起虚拟机 → 拉镜像 → 建数据卷 → 起容器 → 等健康检查 → 打印访问地址。

镜像位置：`crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev`，标签 `0.4.4` / `latest`（同一镜像）。

> 公开仓库，`podman pull` / `docker pull` **免登录**；若以后改成私有，先 `podman login crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com`（用户名/密码见阿里云控制台「访问凭证」）。
> 已发布 digest：`sha256:6a841d7a9dd9a1eefb9fdf22e2a1ff98d7c99108e2b179620b49353ef7bff476`（`0.4.4` 与 `latest` 同一镜像）。

```bash
# 想手动拉也行（docker 同）
podman pull crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev:0.4.4
podman run -d --name docbox --restart=always -p 3000:3000 -v docbox-data:/data \
  crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev:0.4.4
```

不想用脚本就手工起（数据全在 `docbox-data` 卷里，删容器不丢）：

```bash
podman volume create docbox-data
podman run -d --name docbox --restart=always -p 3000:3000 \
  -v docbox-data:/data --shm-size=1g \
  crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev:0.4.4
curl http://127.0.0.1:3000/api/health     # {"ok":true,"version":"0.4.4",...}
```

> 默认账号 `root / root`，登录后到「账户管理」改密码。`--shm-size=1g` 是给内置 chromium（视频嗅探）留共享内存，不给也能跑（启动参数已带 `--disable-dev-shm-usage`）。

### 方式 A：用离线镜像包

 | `docbox-0.4.4-image.tar`（4.3 GB，仓库里没有，从 Release/网盘单独取） | 只想跑起来，不想编译 |
| **B. 从源码构建** | 本仓库源码 + 能上网（拉依赖/模型） | 想自己改代码、或在服务器上直接构建 |

### 方式 B：从源码构建（不要现成镜像包）

```powershell
# Windows：先克隆仓库，再执行（首次约 10~20 分钟）
git clone https://github.com/1314ysys/DocBox.git
cd DocBox
powershell -ExecutionPolicy Bypass -File .\deploy\build-image.ps1
# 构建完成后直接起容器（跳过载入镜像包）
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1 -SkipLoad
```

```bash
# Linux / macOS
git clone https://github.com/1314ysys/DocBox.git && cd DocBox
sudo bash deploy/build-image.sh
sudo bash deploy/install-linux.sh --skip-load
```

构建脚本会自动：检查 podman（缺则提示装）→ 起虚拟机（Windows）→ 下载语音模型到 `deploy/models` → `podman build -t docbox:0.4.4 .`。
模型缺失**不会阻塞构建**，只是「语音转写 / 实时转写」不可用；想省 420 MB 带宽可加 `-SkipModels` / `--skip-models`。

手动等价命令：

```bash
node deploy/fetch-models.mjs          # 可选：下载模型（hf-mirror.com，可用 --source hf 直连）
podman build -t docbox:0.4.4 .        # Windows 上建议加 --dns 223.5.5.5 --dns 119.29.29.29
```

## Windows 一键部署

前置：Windows 10/11（x64），有网络（首次安装 Podman 和初始化虚拟机）。

1. 把 `docbox-0.4.4-image.tar` 放到 `deploy\` 目录（或留在一键脚本同级）。
2. 右键 `install-windows.ps1` → **使用 PowerShell 运行**；或：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1
   ```

3. 脚本会自动：
   - 检测 podman，缺失则 `winget install RedHat.Podman`；
   - `podman machine init/start`（首次自动创建 4 核 / 6 GB / 80 GB 的虚拟机）；
   - `podman load -i docbox-0.4.4-image.tar`；
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
# {"ok":true,"version":"0.4.4", ...}
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

**视频解析抓不到 m3u8 / 提示「内置浏览器不可用」**：先用页面上的「内置浏览器 chromium」标签或 `curl http://127.0.0.1:3000/api/video/browser` 确认。容器里 chromium 随镜像安装（`DOCBOX_CHROME=/usr/bin/chromium`），启动参数已带 `--no-sandbox`（容器以 root 运行必须）和 `--disable-dev-shm-usage`（容器 `/dev/shm` 通常只有 64MB）。若改成 `--userns=keep-id` 以非 root 运行，请加 `-e DOCBOX_TMP_DIR=/data/tmp`，否则浏览器的工作目录不可写、嗅探会直接失败。

**镜像多大**：`podman images docbox` 约 4.3 GB（含 Node 依赖、FFmpeg、Chromium、MariaDB、SenseVoice/zipformer 语音模型）。

## 已验证

- 镜像可正常启动：MariaDB 10.11 初始化 + 建库建号 + 应用监听 3000，`/api/health` 返回 200；
- 容器内实测通过：中文 PDF 水印、文档转 PDF（无浏览器时走纯文本兜底排版）、公文排版、SenseVoice 快速转写（模型已打包在镜像里，无需联网）、APM 降噪（python3 + numpy）；
- **内置无头浏览器（视频解析的深度嗅探）容器内实测有效**：容器内 `Chromium 155.0.8059.79`（Debian bookworm），`--headless=new --no-sandbox --disable-dev-shm-usage` 正常输出 DOM；直接调用 `browser.mjs` 的 `sniffMedia()`：本地测试页抓到 **2 条 `.m3u8 [200]`**（2.1s，标题/请求数均正确），外网页面（baidu.com）抓到 82 个请求且标题正确；`GET /api/video/status` 返回 `browser.available=true, path=/usr/bin/chromium`。dbus 报错是容器无 dbus 的噪音，可忽略。
- 实测 `scripts/tools-check.mjs`：宿主机 **93/94**（唯一失败是 crt.sh 外部接口 502）；容器内 **91/94**，剩下 3 项全是需要外网的目标探测（RDAP / HTTP 方法探测 / crt.sh），容器无外网属部署环境限制，不是工具缺陷。
