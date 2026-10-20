# 0.2.0 · 2026-10-20

> 主题：**全工具自检 + Podman 单镜像交付（一键部署脚本）。**

## 一、全工具自检（93 / 94）

新增 `npm run tools:check`：自动生成测试夹具（PDF / PNG / JPG / WebP / MP4 / MP3 / WAV / DOCX / XLSX / PPTX / Markdown / HTML / CSV），
逐个真实调用 **57 个套件工具**（PDF 32 + 音视频 15 + 网络 10）与 **33 个原生接口**，下载产物并校验大小。

| 结果 | 数量 | 说明 |
| --- | --- | --- |
| 通过 | 92 | 套件 55 / 原生 33 + 4 项环境项 |
| 失败（外部服务） | 2 | rdap.org 返回 403、crt.sh 返回 502，代码路径与错误处理已验证 |

### 修掉的真实缺陷

- **图片轮播（media-slideshow）输出失败**：`scale=1280:-2` 与 `force_original_aspect_ratio` 同用时高度算出 853（奇数），libx264 拒绝编码 → 改为 `scale=w='min(iw,W)':h=-2`；
- **RDAP 查询偶发 403**：补 `User-Agent` 并把超时从 15s 提到 20s；
- **语音模型被自己删掉（容器里暴露）**：模型原本放 `tmp/models`，而启动时 `cleanupRuntime()` 会清空 tmp，导致每次重启都要重新下载 420MB → 模型改存 `models/`（新增 `DOCBOX_MODELS_DIR`），tmp 只放临时文件；
- **无 Edge/Chrome 时文档转 PDF 直接失败**：新增纯文本 PDF 兜底渲染（`src/lib/htmltext-pdf.mjs`），容器/服务器上 doc→PDF、公文排版、批量转换都能出稿；
- **PDF 中文水印报 WinAnsi**：pdf-lib 不能嵌入 TTC 字体集合，镜像改用 TTF 并通过 `DOCBOX_FONT` 指定；
- **容器里媒体工具报 ffprobe EACCES**：`--ignore-scripts` 装依赖后预编译二进制没有执行位，构建期 `chmod +x` 修好；
- **Linux 下「路由追踪」调 Windows 的 tracert**：系统命令按平台翻译（traceroute / ip / ss），镜像内装 traceroute 与 iproute2。

### 自检脚本

```bash
npm run tools:fixtures   # 生成 tmp/fixtures 测试夹具
npm run tools:check      # 全量自检（约 4 分钟），--json 输出明细
```

## 二、Podman 单镜像

镜像 `docbox:0.2.0`（`podman save` 导出为 `docbox-0.2.0-image.tar`）：

- **一个容器 = 全部依赖**：Node 22 + MariaDB 10.11 + FFmpeg 5.1 + 中文字体（文泉驿）+ Python3/numpy（APM）+ 预置语音模型（SenseVoiceSmall 228MB、流式 zipformer 174MB、Silero VAD 2MB，共 420MB）；
- 入口 `deploy/docker-entrypoint.sh`：首次启动初始化 MariaDB → 建库建号 → 启动应用；之后秒起；
- 数据全在 `/data` 卷：数据库、上传、产物、缓存；删容器不丢数据；
- 健康检查 `/api/health`，`--restart=always` 自动重启。

## 三、一键部署脚本（从 0 装环境）

| 平台 | 脚本 | 行为 |
| --- | --- | --- |
| Windows | `deploy/install-windows.ps1` | 检测/安装 podman（winget）→ 初始化并启动 podman 虚拟机 → `podman load` 本地镜像 → 建数据卷 → 起容器 → 轮询健康检查 → 打开浏览器 |
| Linux | `deploy/install-linux.sh` | 按发行版安装 podman（apt/dnf/zypper/pacman）→ `podman load` → 建卷/绑目录 → 起容器 → 健康检查；`--boot` 生成 systemd 用户服务（quadlet）开机自启 |

两者都支持换端口、换数据卷/数据目录、幂等重跑（升级时重建容器、保留数据）。

## 四、其它改动

- `src/config.mjs`：新增 `DOCBOX_DATA_DIR`（可写数据放卷里）、`DOCBOX_TMP_DIR`、`DOCBOX_FONT`；字体候选加入 Linux 常见 CJK 路径；
- `DOCBOX_HOST` 支持 `0.0.0.0`（容器内监听）；
- `.dockerignore` / `Dockerfile` / `deploy/` 新目录；
- 冒烟断言 178 → **181**（新增：容器镜像定义、Windows/Linux 部署脚本存在）。

## 文件

- 新增：`Dockerfile`、`.dockerignore`、`deploy/{docker-entrypoint.sh,install-windows.ps1,install-linux.sh,README.md}`、`docbox/scripts/{tools-fixtures.mjs,tools-check.mjs,prefetch-models.mjs}`；
- 修改：`docbox/src/config.mjs`、`docbox/src/lib/media.mjs`、`docbox/src/lib/netprobe.mjs`、`docbox/scripts/smoke.mjs`、`README.md`。
