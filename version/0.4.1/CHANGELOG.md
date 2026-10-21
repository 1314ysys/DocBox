# DocBox 0.4.1（2026-10-21）

> 主题：**成品文件按保留策略自动清理，保留时长在「账户管理」里由 root 永久配置（默认 24 小时）。**

## 1. 背景

0.3.1 起视频等工具产出的成品统一落在服务端 `outputs/`，但从未自动清理，长期使用会持续占盘（尤其视频 MP4 + 容器数据卷）。本次补上**可配置的定时清理**。

## 2. 新增

### 2.1 保留策略（`src/lib/retention.mjs`）

- 设置存 `settings` 表（key = `outputs_retention_hours`），**重启不丢**；
- `0 = 永久保存`；默认 **24 小时**；上限 8760 小时（365 天）；
- 后台任务：**每 30 分钟**扫一次（启动 90 秒后先跑一次），把超过保留期的删除；
- 清理范围：
  1. `OUTPUT_DIR`（成品目录，`/files/...` 指向这里）—— 按文件 mtime 判断，删空目录；
  2. `TMP_DIR` 下的视频中间产物（`video-*`、`video-task-*`、`hls-*`、`dash-*`、`ytdlp-*`、`direct-*`、`browser-*`）；
  3. 已结束且过期的 `video_tasks` 记录（成品被删或创建时间早于保留期），避免任务列表里留下死链。
- 永久保存模式下**只读不删**（连临时目录也不碰），日志也会静默。

### 2.2 接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/settings` | 登录用户 | 返回 `retention:{hours, permanent, defaultHours}`、`outputs:{dir, files, bytes}`、`lastSweep` |
| POST | `/api/settings/retention` | **管理员** | `{hours}` 保存并立即按新值清理一次（`sweep:false` 可只保存） |
| POST | `/api/settings/retention/sweep` | **管理员** | 立即清理一次（便于验证） |

参数校验：负数/非数字返回 400；普通用户可读不可改（403）。

### 2.3 界面（账户管理 → 成品文件保留策略）

root 登录后进「账户管理」，新增面板：

- 下拉选择：`永久保存 / 1h / 6h / 12h / 24h（默认）/ 48h / 72h / 168h / 自定义…`；
- 显示当前成品目录路径、文件数、占用大小、上次清理时间与删除数量；
- 按钮「保存并立即清理」「只清理一次」，结果用 toast 提示。

## 3. 实测（宿主机）

| 场景 | 结果 |
| --- | --- |
| 默认值 | `hours=24, permanent=false`，成品 124 个 / 3.0 MB |
| 设「永久保存」 | 保存成功，清理 `removedFiles=0`，文件全部保留 |
| 设 2 小时 | 立即清理：删掉 62 个过期成品，刚生成的文件保留 |
| 传 `hours: -5` | HTTP 400「保留时长必须是不小于 0 的整数」 |
| 普通用户调用改设置接口 | 403；`GET /api/settings` 200 |
| 恢复 24 小时 | 正常保存 |
| 冒烟 | **192 项**（新增「成品保留策略接口」「保留时长参数校验」） |

## 4. 升级提示

- 老用户升级后默认就是 **24 小时**，历史成品会在下一次扫描（≤30 分钟）按 mtime 清理；
- 想保留历史产物，先到「账户管理」把保留策略改成「永久保存」再升级，或把 `outputs/` 备份走；
- 容器部署：清理的是数据卷 `docbox-data` 里的 `/data/outputs`。

## 5. 部署与构建脚本（随仓库发布）

| 文件 | 作用 |
| --- | --- |
| `deploy/build-image.ps1` / `.sh` | **从源码一键构建镜像**：检查 podman → 起虚拟机 → 拉语音模型 → `podman build` |
| `deploy/fetch-models.mjs` | 跨平台下载 3 组语音模型（约 420 MB，hf-mirror.com，可 `--source hf` 直连、`--out` 换目录、已存在自动跳过） |
| `deploy/install-windows.ps1` | 新增 `-SkipLoad`：镜像已在本地时跳过载入镜像包 |
| `deploy/install-linux.sh` | 新增 `--skip-load`：同上 |
| `Dockerfile` | 语音模型校验由「缺失即失败」改为**缺失只告警**，没有模型也能构建/运行（转写不可用） |

> 说明：镜像包（4.1 GB）超出 GitHub 单文件上限，仓库只放源码与脚本；镜像可用 `deploy/build-image.ps1`/`.sh` 自行构建，或从发行包获取。

## 6. 镜像发布（阿里云 ACR 个人版）

- 镜像已推送到阿里云容器镜像服务个人版（杭州）：`crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev`，标签 `0.4.1` / `latest`；
- manifest digest：`sha256:2647d5172afa3c4266eb717427c62ab06175f176fc1ff24f678f481828ec6ccf`（与本地 `localhost/docbox:0.4.1` 的 image ID `7e733823392c` 一致，层内容未变）；
- 仓库为**公开**仓库，`podman pull` / `docker pull` 免登录，国内拉取速度优于从 GitHub 下载 4 GB tar；
- 实测：匿名 `podman pull` 成功 → 起容器 → `/api/health` 返回 `ok:true / 0.4.1 / MariaDB 10.11.19`，容器内 `Chromium 155.0.8059.79`、`yt-dlp 2026.08.19` 正常；
- 部署入口：`sudo bash deploy/install-linux.sh --image crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev:0.4.1 --skip-load`，或 Windows `podman pull` 后 `install-windows.ps1 -Image <镜像> -SkipLoad`；
- 说明：ACR **个人版不支持镜像构建**，绑定 GitHub 代码源只做登记，不会自动构建/自动更新镜像（自动构建需企业版，或在 GitHub Actions 侧构建后推送）。
