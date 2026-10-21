# DocBox 0.4.0（2026-10-21）

> 主题：**贴个网页链接就行——后台内置浏览器打开页面，自动嗅探 m3u8 再解析下载。**

## 1. 新增：内置浏览器嗅探（`src/lib/browser.mjs`）

以前的「网页抓取」只是 `fetch` HTML 做正则；站点若用 JS 动态取流（hls.js / 接口下发 m3u8），页面 HTML 里根本没有地址，必然抓不到。现在多了一台**后台无头浏览器**：

- **零新增依赖**：用 Node 自带能力 + 项目已有的 `ws`，直接说 Chrome DevTools Protocol；
- 自动找内核：`DOCBOX_CHROME` → Windows Edge/Chrome 默认路径 → Linux `chromium`/`google-chrome` → macOS Chrome；
- 流程：`msedge --headless=new --remote-debugging-port=0` 起一个临时用户目录 → 打开页面 → `Network.enable` 监听全部请求 → 抓 `.m3u8`（记录状态码、请求头）→ 顺便带上页面 Cookie → 关闭浏览器、删临时目录；
- 页面里如果有 `<video>`，会**自动静音 + 调 play() + 轻滚页面**触发加载（很多站点了播放才开始取流）；
- 抓到 m3u8 后直接交给自带 HLS 引擎枚举码率，并把 **Referer + Cookie** 带到后续分片下载（登录态站点也能下）。

### 解析顺序（`resolveSource`）

1. 链接本身是 `.m3u8` → 直接解析
2. 站点内置解析（哔哩哔哩 API）
3. yt-dlp（如可用，站内 m3u8 优先）
4. 网页正则抓取
5. **内置浏览器嗅探（兜底，默认开启）** ← 本次新增

`deep` 参数（前端「深度嗅探」勾选框，默认勾选）控制嗅探耐心：20 秒 + 多次触发播放；关掉则 15 秒。

## 2. 接口 / 前端

- `GET  /api/video/browser`：内置浏览器是否可用（名字/路径/提示）
- `POST /api/video/probe {url, deep}`：`deep` 默认 true
- `POST /api/video/batch {urls, deep}`：批量任务同样走嗅探（每任务独立浏览器实例）
- `GET /api/video/status`：多返回 `browser` 字段
- 前端：解析框下方新增「抓不到时用内置浏览器深度嗅探」勾选框；状态栏显示 `yt-dlp 版本` + `内置浏览器 msedge/chromium` 徽标；「解析过程」里能看到嗅探这一步的请求数与耗时

## 3. 容器

- 镜像内 `apt-get install chromium`，并设 `DOCBOX_CHROME=/usr/bin/chromium`；Linux 下自动加 `--no-sandbox --disable-dev-shm-usage`（容器里必需）。

## 4. 实测

| 场景 | 结果 |
| --- | --- |
| 本地「JS 动态取流」测试页（HTML 里没有 m3u8，运行时 fetch 接口才拿到） | 静态抓取命中 0；**内置浏览器嗅探 2.6 秒抓到 1 个 m3u8**，解析成功 |
| 同上走完整 API（probe → download） | `kind=browser, engine=builtin-browser`，6.1 秒出结果；下载产出 **63 KB MP4**（hls 引擎） |
| 浏览器检测 | 宿主机自动识别 `msedge.exe`；容器内识别 `chromium` |
| 冒烟 | **190 项**（新增「内置浏览器嗅探接口」） |

## 5. 已知限制

- 需要登录/真人验证/DRM（Widevine）的流仍然抓不到，会明确提示；
- 无头浏览器对个别站点会被识别为 bot，可换 Chrome 或设置 `DOCBOX_CHROME`；
- 每次嗅探会起一个浏览器进程（约 100–200 MB 内存，2–20 秒），批量任务按队列串行 2 个，不会把机器打满。
