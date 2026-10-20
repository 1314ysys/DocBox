# DocBox 0.3.2（2026-10-21）

> 主题：**「链接解析不了」修好——站点内置解析 + yt-dlp 自动发现/一键安装 + 解析过程可视化。**

## 1. 问题

0.3.1 在宿主机上解析 B 站等站点时提示「未检测到 yt-dlp，且页面里没有找到 m3u8 / 直链」，原因有三：

1. 宿主机确实没装 yt-dlp（只有容器镜像里装了），检测逻辑也只认 PATH 里的 `yt-dlp`；
2. B 站、腾讯、爱奇艺这类站点页面里本来就没有明文 m3u8，靠正则抓网页永远抓不到；
3. 失败时只给一句笼统提示，看不出是哪一步断的。

## 2. 修法

### 2.1 新增站点内置解析 `src/lib/sites.mjs`（不依赖 yt-dlp）

- 哔哩哔哩：`view` 接口拿标题/封面/时长 → `playurl` 接口拿流；
  - 优先 **DASH**（视频+音频分开，交给 ffmpeg 合成，画质更高）；
  - 拿不到 DASH 时退回 `platform=html5` 的 **durl MP4 直链**（免登录通常 720P）；
  - 支持 `BV` / `av` / `b23.tv` 短链（自动跟跳转）；
  - 画质码转成人话：`64 → 720P`、`80 → 1080P`、`116 → 1080P60`、`120 → 4K` 等；
  - 想解锁更高画质：把浏览器 Cookie 贴到环境变量 `DOCBOX_BILI_COOKIE`。
- 解析顺序变为：**站点内置 → yt-dlp → 网页抓取**，任何一步成功就返回。

### 2.2 yt-dlp 自动发现 + 一键安装

- 检测顺序：`DOCBOX_YTDLP` → `docbox/bin/yt-dlp(.exe)` → PATH → `python -m yt_dlp`；
- 页面右上角显示引擎状态：有 yt-dlp 显示版本号，没有则出现 **「一键安装 yt-dlp」** 按钮；
- 新接口 `POST /api/video/ytdlp/install`：先 `pip install -U yt-dlp`，失败再下载官方单文件到 `docbox/bin/`，装完自动刷新生效；
- 命令行等价：`node scripts/fetch-ytdlp.mjs`（新增）。

### 2.3 解析过程可视化 + 不再长时间卡住

- 解析结果里多了「解析过程」折叠块，逐步显示：站点内置解析 / yt-dlp / 抓取网页（HTTP 状态、内容类型、大小、命中地址数）/ iframe 跟进 / m3u8 解析，成功打 ✓、失败打 ✗ 并给出原因；
- yt-dlp 探测加了 `--socket-timeout 15 --retries 2 --extractor-retries 1` 与 **60s 进程级超时**，站点不可达时 1 分钟内明确报错，不再挂很久；
- 错误信息过滤掉 yt-dlp 的 Python 版本弃用噪音，只保留 `ERROR:` 行；
- 失败原因改成可操作提示：「未安装 yt-dlp（可点一键安装 / `python -m pip install -U yt-dlp`）」「yt-dlp 解析失败：…」「网页里没有 m3u8（站点用 JS 动态取流/需登录/地区限制）」。

### 2.4 下载链路补全

- `download()` 现在吃**格式对象**而不是只有 id：支持 `dash`（视频+音频分别下载再 `ffmpeg -c copy` 合成）、`hls`、`file`（带站点要求的 Referer/Cookie 头）、`ytdlp`；
- HLS 分片下载支持传入自定义头（Referer 等）；
- 批量任务同样走这套逻辑，DASH 也能进队列。

## 3. 实测（宿主机）

| 场景 | 结果 |
| --- | --- |
| yt-dlp 检测 | 宿主机 `pip install -U yt-dlp` 后自动识别：`2026.08.19`（PATH） |
| B 站解析 | `https://www.bilibili.com/video/BV1GJ411x7h7` → 1.3 秒返回 **6 个 DASH 清晰度**（480P，未登录上限），标题正常 |
| B 站下载 | 选首档 DASH → `dash+ffmpeg` 合成，产出 **11.3 MB MP4** |
| YouTube | 本机网络访问不到 youtube.com，60 秒内返回明确原因（不再空转） |
| 网页 → m3u8 | 本地测试页（JS 内嵌 `\/` 转义 m3u8）解析成功 |
| 批量任务 | 2 条 URL 全部 `done`，任务列表可取消/重试/删除 |

## 4. 版本

- 版本号 `0.3.2`，镜像 `docbox:0.3.2`（含 yt-dlp）；
- 冒烟 **189 项**（新增「视频页一键安装 yt-dlp 入口」）。
