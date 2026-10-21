# DocBox 交接规范文档（v0.3.0）

> 面向接手人：怎么部署、怎么改功能、怎么发版、有哪些坑。
> 本文随版本更新，当前对应 **0.3.0（2026-10-21）**。

---

## 0. 30 秒速览

| 项目 | 内容 |
| --- | --- |
| 是什么 | 单进程、单端口的本地文档工具箱：图片 / PDF / 文档 / 表格 / 音视频 / 网络安全 / OCR / 视频解析 |
| 技术栈 | Node 20+（生产用 22）· Express 5 · 原生 ES Module 前端（无构建步骤）· MySQL 8 / MariaDB 10.11 · ffmpeg · tesseract.js · sherpa-onnx · zxing-wasm |
| 端口 | 应用 3000（可改）· 数据库 3306（仅本机/容器内） |
| 默认账号 | root / root（首次登录后必须改） |
| 数据位置 | 源码方式：docbox/uploads\|outputs\|tmp\|models\|.cache + MySQL；容器方式：卷 /data |
| 规模 | 89 个工具（57 套件 + 34 原生 − 2 重复）· 186 项冒烟断言 · 94 项工具自检 |
| 交付物 | 源码 zip/tar.gz · Podman 镜像 tar（3.89 GB）· Windows/Linux 一键部署脚本 |

---

## 1. 交付物清单

```
version/0.3.0/
├── docbox-0.3.0-image.tar   # Podman 镜像（podman save 导出，3.71 GB 文件 / 镜像 3.89 GB）
├── docbox-0.3.0.zip         # 源码快照（含 deploy/、python/、docbox/）
├── docbox-0.3.0.tar.gz      # 同上，Linux 用
├── CHANGELOG.md             # 本版改动明细
└── VERSION.json             # 版本元数据（测试结果、镜像 info、计数）
deploy/
├── install-windows.ps1      # Windows 一键：装 podman → 初始化虚拟机 → load 镜像 → 起容器 → 健康检查 → 开浏览器
├── install-linux.sh         # Linux 一键：apt/dnf/zypper/pacman 装 podman → load → 起容器
├── docker-entrypoint.sh     # 容器入口：初始化 MariaDB → 建库建号 → 起应用
├── README.md                # 部署细节与参数
└── models/                  # 语音模型（构建镜像时才需要，源码运行可选）
docs/HANDOVER.md             # 本文
```

> 镜像 tar 不进 git（.gitignore 已排除 version/**/*.tar*），发布时单独拷给接手人。

---

## 2. 部署

### 2.1 方式 A：Podman 容器（推荐，零依赖）

Windows：

```powershell
# 把 docbox-0.3.0-image.tar 放到 deploy\ 目录后：
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1
# 常用参数
.\install-windows.ps1 -Port 8080 -Volume docbox-data2 -NoBrowser
```

Linux：

```bash
sudo bash deploy/install-linux.sh --port 3000
sudo bash deploy/install-linux.sh --port 3000 --data-dir /srv/docbox --boot   # 开机自启
```

脚本做的事：检测/安装 podman → 启动（或初始化）虚拟机（Windows）→ podman load 本地镜像 → 建命名卷 → --restart=always 起容器 → 轮询 /api/health → 打开浏览器。

手工部署（等价）：

```bash
podman load -i docbox-0.3.0-image.tar
podman volume create docbox-data
podman run -d --name docbox --restart=always -p 3000:3000 -v docbox-data:/data docbox:0.3.0
curl -s http://127.0.0.1:3000/api/health
```

容器内：/data = MariaDB 数据 + uploads + outputs + cache；/app/models 是镜像内置模型（不要挂空卷覆盖它）。

### 2.2 方式 B：源码运行（开发/调试用）

前置：Node ≥ 20（推荐 22）、MySQL 8.x（或 MariaDB 10.11）、ffmpeg（可用 npm 内置的 @ffmpeg-installer）。

```powershell
cd docbox
npm install                      # 首次；国内可加 --registry=https://registry.npmmirror.com
# 可选：准备语音模型（不放也能用，只是转写/实时转写不可用）
#   放到 docbox/models/sherpa/sense-voice/model.int8.onnx
#        docbox/models/sherpa/streaming-zipformer-zh-en/
#        docbox/models/silero-vad-fp32.onnx
npm start                        # http://127.0.0.1:3000
```

数据库：默认连 127.0.0.1:3306、用户 root、密码 root、库 docbox（不存在会自动建库建表并种一个 root/root 管理员）。
连不上数据库不会崩：自动进入「免登录模式」继续可用，只是历史记录/账户功能降级。

### 2.3 方式 C：反向代理 / 对外访问

- 应用只监听 127.0.0.1（容器内 0.0.0.0）。对外请用 Nginx/Caddy 反代并配 HTTPS；
- WebSocket 需要放行：/ws/terminal（SSH/Telnet 终端）、/ws/stt（实时转写）；
- 单文件上限 200 MB、单次 40 个文件（docbox/src/config.mjs 的 LIMITS）。

---

## 3. 配置项（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| DOCBOX_PORT | 3000 | 监听端口 |
| DOCBOX_HOST | 127.0.0.1 | 监听地址（容器里是 0.0.0.0） |
| DOCBOX_DATA_DIR | 空 | 设置后 uploads/outputs/cache 都落到该目录（容器用 /data） |
| DOCBOX_TMP_DIR | docbox/tmp | 临时目录（启动时清空，别把模型放这里） |
| DOCBOX_MODELS_DIR | docbox/models | 模型目录（必须持久化，420 MB） |
| DOCBOX_FONT | 自动探测 | PDF 中文字体；Linux 需 TTF（pdf-lib 不支持 TTC，构建期已抽取） |
| DOCBOX_DB_HOST / PORT / USER / PASSWORD / NAME | 127.0.0.1 / 3306 / root / root / docbox | 数据库连接 |
| DOCBOX_STT_BACKEND | sensevoice | 在线转写后端 |
| DOCBOX_STT_MODEL / DOCBOX_STT_STREAM_MODEL | 内置路径 | 覆写 Whisper / zipformer 模型 |
| DOCBOX_YTDLP | yt-dlp | yt-dlp 可执行文件路径（视频解析引擎） |
| ORT_LOGGING_LEVEL | 空 | 设为 error 可压掉 onnxruntime 噪音日志 |

---

## 4. 代码结构（改功能从这里下手）

```
docbox/
├── server.mjs               # Express 装配 + WebSocket（终端/流式转写）+ 启动/清理
├── src/
│   ├── config.mjs           # 路径、端口、DB、字体、LIMITS、APP_VERSION
│   ├── tool-catalog.mjs     # 服务端工具清单（PDF 23 / 音视频 18 / 网络 16）
│   ├── ocr-worker.mjs       # OCR 子进程：tesseract chi_sim+eng + zxing 条码
│   ├── lib/
│   │   ├── image / media / pdfops / docops / watermark   # 各套件实现
│   │   ├── netprobe.mjs     # 网络探测（服务端实现，仅自检/排障；界面已改用浏览器）
│   │   ├── hls.mjs          # m3u8 解析 / 分片下载 / AES-128 / ffmpeg 合成
│   │   ├── video.mjs        # 视频解析：yt-dlp 优先，页面扫描兜底
│   │   ├── ocr.mjs          # OCR 任务队列（单并发子进程）
│   │   ├── terminal.mjs     # SSH(ssh2) / Telnet 会话管理
│   │   ├── stt.mjs / stt-stream.mjs / asr-sherpa.mjs / vad.mjs   # 语音转写
│   │   ├── auth.mjs / db.mjs / track.mjs    # 认证、数据库、任务记录
│   │   └── files.mjs        # 上传/产物/清理/打包下载
│   └── routes/              # image pdf doc sheet ocr stt terminal video suite history accounts meta preview auth
├── public/                  # 前端（无构建，直接 <script type="module">）
│   ├── index.html           # 单页外壳 + 各视图容器
│   ├── styles.css
│   └── js/
│       ├── core/            # api / auth / dom / fields / files / preview / results / store / ui
│       │   └── netclient.mjs     # ★ 网络安全 16 项的浏览器端引擎（服务器不参与）
│       ├── tools/catalog.mjs     # 前端工具清单 + buildCatalog（合并服务端套件）
│       └── views/           # home tool watermark idphoto editor extract ocr video terminal history accounts md-editor md-table
├── scripts/
│   ├── smoke.mjs            # 186 项冒烟测试（自动登录，覆盖全部接口）
│   ├── tools-check.mjs      # 94 项逐工具自检（真实调用 + 校验产物）
│   └── tools-fixtures.mjs   # 自动生成测试夹具（PDF/图片/音视频/Office/Markdown）
├── testdata/                # 固定样例
└── models/                  # 语音模型（gitignore）
python/apm_server.py         # APM 降噪边车（可选，实时转写前处理）
```

新增一个工具的最小改动（以服务端套件工具为例）：

1. src/lib/xxx.mjs 写实现，返回 { outputs: [{ name, buffer, kind }], note }；
2. src/routes/ 对应 Router 加路由（或新建 Router 并在 server.mjs 挂载）；
3. src/tool-catalog.mjs 加一条 N({ id, name, cat, icon, desc, fields })，前端自动出卡片与表单；
4. 纯前端工具则在 public/js/tools/catalog.mjs 的 NATIVE_TOOLS 加条目（endpoint 或 route）；
5. scripts/smoke.mjs / scripts/tools-check.mjs 补断言。

---

## 5. 功能要点与边界

| 模块 | 数量 | 关键说明 |
| --- | --- | --- |
| 图片 | 5 | sharp 处理；证件照有预设排版；PDF 水印支持中文（走 TTF 嵌入） |
| PDF | 23 | 原生实现（pdf-lib + pdfjs + canvas），不依赖 Stirling / Java |
| 文档 | 15 | Word/Excel/PPT → PDF（mammoth / xlsx / 自研 PPTX 解析）；无浏览器时降级为纯文本 PDF |
| 表格 | 3 | Excel ↔ CSV ↔ JSON |
| OCR | — | tesseract 离线，中英混排 + 条码/二维码（20+ 码制）；PDF 整本逐页识别 |
| 音视频 | 18 | ffmpeg 子进程；转写 SenseVoice/Whisper + Silero VAD，支持流式实时转写 |
| 网络安全 | 16 | 全部由用户浏览器发起（DoH / WebSocket / fetch），服务器不再代理扫描 |
| 视频解析 | 1 | yt-dlp（B 站 / YouTube / 爱奇艺 / 腾讯 / 优酷 / 抖音）+ 内置 HLS 下载器 |
| 终端 | 1 | Web SSH / Telnet（xterm.js + WebSocket + 服务端中继） |
| 账户 | — | 角色 admin/user，模块级授权，导航/路由/接口三重拦截 |

已知限制（必须向使用者说明）：

1. 浏览器沙箱做不了：路由追踪（ICMP）、TLS 证书读取、裸 TCP Banner —— 这三项会返回「浏览器受限」，不要试图偷偷回退成服务器执行（那正是 0.3.0 要修的问题）；
2. 跨域站点读不到响应头/状态码时，界面会明确提示「未开放 CORS」，属正常现象；
3. 容器内如无外网：DNS / RDAP / 子域 / 外网站点解析会失败，属环境限制；
4. yt-dlp 依赖站点结构，站点改版后可能需要 pip install -U yt-dlp 升级（镜像内版本 2026.08.19）；
5. 视频下载仅供个人合规用途，遵守各平台条款与版权法，不要做成公开解析服务；
6. 无浏览器（容器）环境下文档转 PDF 走纯文本兜底，版式不还原；
7. 模型目录 420 MB，且不能放在 tmp（启动会被清空）；内存建议 ≥ 4 GB（podman 虚拟机建议 6 GB）；
8. 默认账号 root/root 必须在首启后修改；对外暴露务必加 HTTPS 反代。

---

## 6. 测试与自检

```bash
cd docbox
npm run smoke                                # 186 项；需服务已在 3000 运行（脚本会自己登录 root/root）
node scripts/tools-check.mjs http://127.0.0.1:3000 --json tmp/check.json
node scripts/tools-check.mjs http://127.0.0.1:3000 --only native      # 只跑原生接口
node scripts/tools-check.mjs http://127.0.0.1:3000 --only suite       # 只跑套件工具
```

预期结果（0.3.0 实测）：冒烟 186/186；宿主 tools-check 91/94、容器 92/94 —— 失败项几乎都是外网抖动（net-headers 超时、net-rdap fetch failed、net-subdomain crt.sh 502/超时）。若失败项集中在网络类，先重跑一次再判断是否回归。

自检小技巧：

- tools-check 缺夹具会自动调用 tools-fixtures.mjs 生成；
- 服务重启会清空 docbox/tmp，夹具路径固定在 tmp/fixtures，不用担心污染；
- 想验证 OCR 条码：用 zxing 生成 PNG 再 POST /api/ocr/image，mode=barcode。

---

## 7. 发版流程（照做即可）

1. 改版本号（四处，缺一不可）：
   - docbox/package.json 的 version
   - docbox/src/config.mjs 的 APP_VERSION
   - Dockerfile 顶部注释里的镜像 tag
   - deploy/install-windows.ps1（Image、候选 tar 名）与 deploy/install-linux.sh（IMAGE、候选 tar 名）
2. 跑测试：npm run smoke，再跑 tools-check（宿主，可选容器）。
3. 构建镜像（用干净上下文，避免 tar 期间文件变动报 archive/tar: write too long）：

```bash
podman build --format docker --dns 223.5.5.5 --dns 119.29.29.29 -t docbox:0.3.0 -f Dockerfile .
```

4. 导出镜像（大镜像在虚拟机内部 save 落盘，再 scp 回宿主，避免管道中断）：

```bash
podman machine ssh "rm -f /home/user/docbox.tar; nohup podman save --format docker-archive -o /home/user/docbox.tar localhost/docbox:0.3.0 > /home/user/save.log 2>&1 &"
# 轮询 stat -c %s 直到稳定，再：
scp -i <identity> -P 4067 user@127.0.0.1:/home/user/docbox.tar version/0.3.0/docbox-0.3.0-image.tar
podman load -i version/0.3.0/docbox-0.3.0-image.tar     # 校验：Loaded image: localhost/docbox:0.3.0
```

5. 写归档：version/<ver>/CHANGELOG.md、VERSION.json（测试结果、镜像 ID / 大小 / 校验结论）。
6. 源码归档：

```bash
git archive --format=zip    -o version/0.3.0/docbox-0.3.0.zip    HEAD
git archive --format=tar.gz -o version/0.3.0/docbox-0.3.0.tar.gz HEAD
git add -f version/0.3.0/docbox-0.3.0.zip version/0.3.0/docbox-0.3.0.tar.gz
```

7. 提交与打标签：git commit（建议 feat(x.y.z): …）+ git tag -f vX.Y.Z。
8. 验证干净：git status --porcelain 为空。

---

## 8. 升级 / 回滚 / 备份

容器升级：

```bash
podman stop docbox && podman rm docbox
podman load -i docbox-0.4.0-image.tar
podman run -d --name docbox --restart=always -p 3000:3000 -v docbox-data:/data docbox:0.4.0
```

数据在卷里，换镜像不丢；回滚 = 用旧 tar 重复上面三步。

备份：

```bash
# 应用数据（含 MariaDB 数据目录，最省事）
podman volume export docbox-data -o docbox-data-backup.tar
# 只要库
podman exec docbox mariadb-dump -u root -proot docbox > docbox-db-backup.sql
```

源码方式备份：docbox/uploads、docbox/outputs、docbox/models 三个目录 + mariadb-dump docbox。

---

## 9. 故障排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| /api/health 里 db.available=false | MySQL 未启动 / 密码不符 | 起库或改 DOCBOX_DB_*；不影响基本功能（免登录模式） |
| 登录提示密码错误 | 库里有旧数据 | 改 users 表，或删库重启重新种子 root/root |
| PDF 中文变方块 / 报 WinAnsi 编码错 | 字体缺失或 TTC 未转 TTF | 设置 DOCBOX_FONT 指向 TTF；容器镜像已内置 DocBoxCJK.ttf |
| 文档转 PDF 报「未找到浏览器」 | 容器无 Edge / Chrome | 0.2.0 起自动降级纯文本 PDF，属预期 |
| 转写报 fetch failed / 模型缺失 | models 被清空或路径错 | 检查 DOCBOX_MODELS_DIR，别放 tmp |
| 媒体工具 spawn ffprobe EACCES | 安装后丢了执行位 | chmod +x node_modules/@ffprobe-installer/*/ffprobe（构建期已处理） |
| 网络工具全是「浏览器受限」 | 正常 | 那三项浏览器做不到，用系统 tracert / openssl s_client |
| 视频解析「未解析到可用视频流」 | 站点改版 / 需登录 / 无 yt-dlp | pip install -U yt-dlp；或直接贴 m3u8 直链 |
| podman build 报 archive/tar: write too long | 构建上下文打包时被写入（日志 / tmp） | 换干净目录做上下文，或用 .dockerignore 排除 |
| 大镜像 podman save 出现 ssh EOF | 传输管道中断 | 虚拟机内先 save 落盘再 scp（见发版流程） |
| 前端改了没生效 | 浏览器缓存 | 强制刷新（服务端已设 maxAge: 0 + etag） |

---

## 10. 交接待办清单

- [ ] podman load 后用 /api/health 确认返回 version 0.3.0
- [ ] 登录 root/root 成功并修改默认密码
- [ ] 抽测 5 类工具（图片压缩 / PDF 合并 / Word 转 PDF / 音频转写 / OCR 条码）
- [ ] 抽测网络工具 3 项（DNS / 端口 / 安全头生成），确认面板显示「本机发起」
- [ ] 抽测视频解析（贴一个 m3u8 直链能下载出 MP4）
- [ ] 网页终端 Telnet 任一可达主机可登录
- [ ] npm run smoke 186/186
- [ ] tools-check 网络类失败项复核（重跑一次）
- [ ] 数据卷已备份，DOCBOX_MODELS_DIR 已确认持久化
- [ ] 对外访问已配 HTTPS 反代并放行 /ws/*

---

## 11. 安全与合规

- 网络安全模块只面向自有或已获授权资产，探测请求由使用者浏览器发出；无爆破、无漏洞利用；
- 视频解析仅处理公开链接，不托管内容，遵守各平台条款与版权法；
- 账户密码 scrypt 加盐存储，会话 HttpOnly Cookie 7 天；对外部署请配 HTTPS 并限定来源；
- 日志只记任务摘要（脱敏）；产物默认保留 6 小时（outputs）、上传 1 小时、tmp 2 小时，由 server.mjs 定时清理。

---

## 12. 联系与仓库

- 仓库：GitHub（private，见下方推送说明）
- 分支约定：main 为主干，发版打 vX.Y.Z 标签
- 提交信息建议：feat/fix/docs/chore(范围): 说明，中文可


---

## 13. 0.3.1 新增：视频解析链路与批量下载

### 13.1 解析链路（src/lib/video.mjs · resolveSource）

| 顺序 | 条件 | 做法 | 产物 |
| --- | --- | --- | --- |
| 1 | URL 本身是 `.m3u8` | `resolvePlaylist` 解析 master/meida | 码率列表 |
| 2 | yt-dlp 可用 | `yt-dlp -J` 取站点信息，**优先挑 protocol 含 m3u8 的流**再解析 | 码率列表 + 元数据 |
| 3 | 普通网页 | 抓 HTML，正则扫 m3u8 / mp4 直链（兼容 `\/`、`\u002F`、JSON 字段） | m3u8 → 码率列表 |
| 4 | 页面内嵌 iframe | 递归跟进（最多 2 层） | 同上 |

要点：
- 只要页面里出现 m3u8，**无 yt-dlp 也能下载**；
- 抓到的 m3u8 一律交给内置 HLS 引擎（`hls.mjs`：并发分片 + AES-128 + ffmpeg 合成），不依赖第三方解析站；
- 站点需要登录态/JS 渲染/地区解锁时仍会失败，属正常限制。

### 13.2 批量任务队列（src/lib/video-tasks.mjs）

- 建任务：`POST /api/video/batch {urls: [...]}`（一次最多 50 条，去重、过滤非 http）；
- 状态机：`queued → resolving → downloading → done | failed | canceled`；
- 并发：`DOCBOX_VIDEO_PARALLEL`（默认 2）；总量上限 200 条；
- 进度：HLS 分片计数 / 直链字节数，写回任务对象（前端 3s 轮询 `GET /api/video/tasks`）；
- 操作接口：`POST /api/video/tasks/:id/cancel`（AbortController 真取消）、`…/retry`、`DELETE /api/video/tasks/:id`、`DELETE /api/video/tasks`；
- 落库：`video_tasks` 表（`db.mjs` 的 `saveVideoTask / listVideoTasks / deleteVideoTask / clearVideoTasks`）；**DB 不可用时自动降级为内存队列**；
- 启动时 `restoreTasks()` 载入历史，未跑完的标记「服务重启，任务中断」可重试；
- 产物落在 `outputs/`，任务里带 `file.url`，前端「下载」直接取回。

### 13.3 前端

- `public/js/views/video.mjs` 重写：上半单条解析（引擎、站内 m3u8、码率列表、下载/入队），下半批量输入 + 任务列表；
- 轮询在离开 `#/video` 时自动停止（`cleanupVideo` 由 `main.mjs` 的 `paint` 调用）；
- 样式在 `public/styles.css` 的「视频批量下载任务列表」段（`.vt-row` 等）。

### 13.4 修改注意

- 新增/调整解析规则改 `resolveSource`，不要在路由里写正则；
- 下载接口要带 `signal`，否则任务取消不生效；
- 想提高吞吐调 `DOCBOX_VIDEO_PARALLEL`，但注意站点限速与本机带宽。


---

## 14. 0.3.2：解析失败排查与站点适配

### 14.1 解析顺序（src/lib/video.mjs · resolveSource）

1. 链接本身是 `.m3u8` → HLS 解析
2. **站点内置解析**（`src/lib/sites.mjs`）→ 目前有哔哩哔哩：`view` + `playurl`（DASH 优先，durl 兜底）
3. **yt-dlp**（如可用）→ `-J`，站内 m3u8 优先
4. **网页抓取** → 正则找 m3u8/直链，必要时跟进 iframe 一层

每一步都写进 `info.diagnose.steps`，前端「解析过程」折叠块直接展示，排查时先看它。

### 14.2 新增/改动的坑位

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 「未检测到 yt-dlp」 | 宿主机没装 / 不在 PATH | 页面点「一键安装」或 `python -m pip install -U yt-dlp`；也可 `node scripts/fetch-ytdlp.mjs`，或设置 `DOCBOX_YTDLP` |
| B 站只有 480P/720P | 未登录 Cookie | 把浏览器 Cookie 贴进 `DOCBOX_BILI_COOKIE` 再重启 |
| yt-dlp 报 Python 3.10 弃用警告 | 只是警告，不是失败原因 | 已过滤，真正原因看 `ERROR:` 行 |
| 某站点一直转圈 | 该站当前网络不可达 | 已加 60s 超时，会明确报「不可达/超时」 |
| DASH 下完没声音 | 音频流单独，需合并 | `download()` 已自动 ffmpeg 合成；若合成失败会退回纯视频并标注 `dash-video` |

### 14.3 新增接口 / 脚本

- `POST /api/video/ytdlp/install`：一键安装/升级 yt-dlp（pip → 官方二进制）
- `node scripts/fetch-ytdlp.mjs [--binary]`：命令行安装
- `GET /api/video/status`：返回 `ytdlp: {available, version, bin, install}`

### 14.4 再加一个站点怎么做

1. `src/lib/sites.mjs` 里加 `matchSite()` 规则与 `resolveXxx(url)`；
2. 返回统一结构：`{kind:'site', engine, title, thumbnail, duration, formats:[{id,type:'hls'|'file'|'dash',url,audioUrl,height,note,headers}], streams}`；
3. `type:'dash'` 记得给 `audioUrl`，下载会自动合成；
4. 需要登录态的站点，把 Cookie 头放进 `headers`（参考 B 站 `DOCBOX_BILI_COOKIE`）。


---

## 15. 0.4.0：内置浏览器嗅探（抓 JS 动态 m3u8）

### 15.1 为什么需要

静态 `fetch` 只能看到 HTML；大量站点用 hls.js / 接口下发的地址播放，HTML 里没有 m3u8。用无头浏览器真实跑一遍页面、监听 Network 才能拿到。

### 15.2 实现（src/lib/browser.mjs）

- 启动：`<browser> --headless=new --remote-debugging-port=0 --user-data-dir=<临时目录> URL`；
- 等 `DevToolsActivePort` 文件拿到端口 → `GET /json/list` 找 page target → 连它的 WebSocket（CDP）；
- `Network.enable` + `Page.enable` + `Runtime.enable`；监听 `Network.requestWillBeSent`（含请求头）与 `Network.responseReceived`（状态/类型）；
- 每 1.5 秒尝试 `document.querySelectorAll('video').forEach(v=>{v.muted=true;v.play()})` 并滚动页面；
- 结束前 `Runtime.evaluate document.title`、`Network.getCookies` 取 Cookie；
- 排序：HTTP 200 优先、`master` 优先、后出现优先；最多取前 3 个逐个 `resolvePlaylist` 验证可播；
- 收尾：`Browser.close`/kill 子进程 + 删临时 profile。

### 15.3 配置

| 变量 | 说明 |
| --- | --- |
| `DOCBOX_CHROME` | 浏览器可执行文件路径（容器里是 `/usr/bin/chromium`） |
| `deep`（请求参数/前端勾选） | true：嗅探耐心 20s + 多次触发播放；false：15s |
| `sniff`（内部选项） | false 可完全关闭浏览器嗅探（脚本调用时用） |

### 15.4 排查

| 现象 | 处理 |
| --- | --- |
| `内置浏览器嗅探: 没有找到 Edge/Chrome/Chromium` | 装浏览器或设置 `DOCBOX_CHROME`；容器内确认 `chromium --version` |
| 容器内浏览器起不来 | 确认启动参数含 `--no-sandbox --disable-dev-shm-usage`（Linux 已自动加） |
| 抓不到 m3u8 | 站点要登录/真人验证/DRM；把浏览器换成 Chrome 或提供 Cookie |
| 内存吃紧 | 每次嗅探一个浏览器进程（100–200MB），批量任务并发 2，可用 `DOCBOX_VIDEO_PARALLEL=1` 降并发 |


---

## 16. 0.4.1：成品保留策略与定时清理

### 16.1 机制

- 模块：`src/lib/retention.mjs`；设置项 `settings.outputs_retention_hours`（`0` = 永久保存，默认 24，上限 8760）；
- 定时：`startRetentionTimer()` 在 `server.mjs` 启动时调用，**每 30 分钟**跑一次，启动后 90 秒先跑一次；
- 清理对象：
  1. `OUTPUT_DIR`（成品，按文件 mtime；删空目录）；
  2. `TMP_DIR` 下 `video-*` / `video-task-*` / `hls-*` / `dash-*` / `ytdlp-*` / `direct-*` / `browser-*`；
  3. `video_tasks` 里已结束且过期的记录（含成品已被删的）。
- 永久保存（0）时直接返回，不删任何文件。

### 16.2 接口权限

| 接口 | 权限 |
| --- | --- |
| `GET /api/settings` | 任意登录用户（只读：保留时长 + 成品用量 + 上次清理） |
| `POST /api/settings/retention` | 管理员（`{hours, sweep?:false}`） |
| `POST /api/settings/retention/sweep` | 管理员（立即清理，`{hours?}` 可临时用别的阈值试算） |

### 16.3 界面上在哪改

登录 **root** → 侧边/首页进「账户管理」→ 底部「**成品文件保留策略**」面板：选择保留时长（含「永久保存」和「自定义」）→「保存并立即清理」。

### 16.4 注意

- 清理按**文件 mtime**，不是访问时间；用户反复下载不会延长寿命；
- `outputs/` 若挂在别的磁盘/卷，注意 `DOCBOX_DATA_DIR` 一致；
- 想临时不清理：把保留时长设 0；想立刻验证：点「只清理一次」或用 `curl -X POST /api/settings/retention/sweep`；
- 别把 `OUTPUT_DIR` 直接指到系统目录，清理逻辑会删到保留期外的文件。
