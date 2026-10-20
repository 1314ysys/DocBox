# DocBox 0.3.0（2026-10-21）

> 主题：**网络体检交还给用户的浏览器 · OCR 支持条码与中英混排 · 新增视频网站解析下载。**

## 1. 网络安全 16 项：改为由登录用户的浏览器本机发起

问题：v0.2.0 及之前，16 个网络工具全部在服务器进程里执行（ping / tracert / 端口 / 头 / 证书…），
谁点一下，服务器就替他去扫目标 —— 相当于把服务器变成「肉机」。

- 新增 `docbox/public/js/core/netclient.mjs`（约 400 行，零依赖）：
  - **DNS**：Cloudflare `1.1.1.1/dns-query` + AliDNS DoH，A/AAAA/CNAME/MX/TXT/NS/SOA；
  - **连通性**：HTTP 建连延迟采样（浏览器发不了 ICMP，指标已注明「HTTP 延迟，非 ping 包」）；
  - **端口**：WebSocket 握手探测（open / closed / filtered + 耗时）；
  - **HTTP 头与安全审计**：CORS 放行时读取真实响应头并打分（HSTS/CSP/nosniff/X-Frame-Options/Referrer/Permissions）；
  - **重定向追踪**、**访问性能拆解**（resource timing：DNS/TCP/TLS/TTFB/下载）、
    **子域名枚举**（DoH 批量 A 记录）、**RDAP**、**IP 归属**、**本机信息**（UA/平台/语言/核心数/内存/屏幕/时区/网络类型）、
    **安全响应头生成**（Nginx / Apache，支持 strict 预加载）；
  - 浏览器沙箱做不到的 3 项（路由追踪、TLS 证书、裸 TCP Banner）**显式返回「浏览器受限 + 建议命令」**，不偷偷回退到服务器执行。
- 结果面板加「🔒 探测请求由你自己的浏览器发起」标识，JSON 里带 `origin: "浏览器本机"`。
- 服务端 `/api/suite/net/*` 保留但不被界面调用（自检脚本 / 命令行排障）。

## 2. OCR：中英混排 + 条码 / 二维码

- 语言包：`chi_sim` + `eng` 同时装入 `<cache>/tessdata`，worker 以 `chi_sim+eng` 启动；
  中文之间多余空格继续合并，英文单词间隔保留。
- 条码：新增 `zxing-wasm`（WASM，离线），支持 QR / MicroQR / rMQR / Code39/93/128 / Codabar /
  EAN-8、EAN-13 / UPC-A、UPC-E / ITF / DataBar / DataMatrix / PDF417 / Aztec / MaxiCode 等。
- 接口：`/api/ocr/image`、`/api/ocr/batch` 新增 `mode=both|text|barcode`，返回 `barcodes: [{format, text}]`；
  PDF 整本 OCR 每页带该页条码，汇总去重后附在文末。
- 前端：识别内容下拉（中英混排+条码 / 仅文字 / 仅条码），条码结果自动追加到识别文本末尾。

## 3. 视频网站解析下载（新增工具）

- 新工具「视频网站解析」（音视频分类 → `#/video`）：
  贴链接 → 解析标题/封面/时长/各清晰度 → 选中下载，直接落盘成 MP4。
- `src/lib/hls.mjs`：master/meida 播放列表解析、码率选择、并发分片下载、AES-128 解密（含 IV 推导）、
  ffmpeg `-c copy` 合成（`aac_adtstoasc` 修正）。
- `src/lib/video.mjs`：优先 **yt-dlp**（`-J` 拿格式清单、`-f bv*+ba/b` + ffmpeg 合并）；
  没有 yt-dlp 时降级为「抓页面找 m3u8 / 直链」+ 自带 HLS 下载器。
- 镜像内预装 yt-dlp，覆盖哔哩哔哩、YouTube、爱奇艺、腾讯视频、优酷、抖音等；
  **不额外部署任何解析站点**，参考开源思路后代码全部内嵌本仓库。
- 接口：`GET /api/video/status`、`POST /api/video/probe`、`POST /api/video/download`。

## 4. 网页 SSH / Telnet 实测

- 用本地 Telnet 测试服务端（问候 + 回显）验证：`POST /api/terminal/connect` → `/ws/terminal?id=` 双向收发正常；
- SSH 走 ssh2 同一会话管线（ready → shell → 数据回调），本次未改动；
- 说明写进 README：浏览器不能开裸 TCP，网页终端必须由服务端中继，这与「网络体检改本机发起」不冲突。

## 5. 其它

- 依赖新增：`zxing-wasm@2.0.1`、`@tesseract.js-data/eng@1.0.0`；镜像新增 `python3-pip` + `yt-dlp`。
- 冒烟 181 → **186** 项（新增：网络工具 16 项本机发起、视频解析接口、netclient/video 前端资源）。
- 前端工具总数 88 → **89**（新增「视频网站解析」）。
- Dockerfile / 部署脚本 / 文档版本号统一到 0.3.0，镜像名 `docbox:0.3.0`、包名 `docbox-0.3.0-image.tar`。

## 6. 验证结果（2026-10-21）

| 项目 | 结果 |
| --- | --- |
| 冒烟 `npm run smoke` | **186 / 186 通过** |
| 宿主 tools-check | **91 / 94**（3 项均为宿主网络抖动：net-headers 超时、net-rdap fetch failed、net-subdomain crt.sh 502） |
| 容器 tools-check | **92 / 94**（net-methods timeout、net-subdomain fetch failed，均为外网抖动） |
| 条码识别 | QRCode `https://docbox.local/inv-2026-0001`、Code128 `DOCBOX-2026-ABC` 解码正确（宿主 + 容器） |
| 中英混排 OCR | `DocBox 文档工具箱 v0.3 / Mixed OCR test 2026 OK`，置信度 92% |
| 视频解析（HLS） | 本地 6s 测试流：probe → 分片下载 → 合成 MP4，ffprobe 校验 6.04s / 146KB 通过 |
| 视频解析（容器） | yt-dlp 2026.08.19 可用；容器内 m3u8 下载产出 63KB MP4 |
| 网页终端 | Telnet：connect → `/ws/terminal` 问候与输入回显双向正常 |
| 镜像 | `docbox:0.3.0` = `e45bafd7…`，3.89 GB，`podman load` 校验通过 |
