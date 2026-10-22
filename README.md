# DocBox · 本地文档工具箱

**单进程、单端口、数据不出本机**的文档 / 图片 / 音视频 / 网络安全工作台。  
所有处理都在本机 Node 进程内完成（ffmpeg 仅作为子进程调用），任务记录写入本地 MySQL。

`v0.4.4` · 89 个可用工具 · 网络安全改为**浏览器本机发起** · OCR 支持**中英混排 + 条码/二维码** · **视频网站解析 + 内置浏览器嗅探 + 批量下载任务队列**（贴网页链接自动抓 m3u8，B 站 / YouTube / 爱奇艺 / 腾讯 / 优酷） · SSH/Telnet 网页终端 · SenseVoice 流式识别 · 全类型文件预览 · 账户角色与**模块授权可点选** · 192 项冒烟断言 + 12 项 UI 交互断言全通过

---

## 目录

- [一键部署（Podman 容器，推荐）](#一键部署podman-容器推荐)
- [快速开始（从源码运行）](#快速开始)
- [本地数据库](#本地数据库)
- [近期变更（0.4.x）](#044-有什么变化)
- [账户与权限](#账户与权限)
- [文档工具（15 项）](#文档工具15-项)
- [工具清单（89 项可用）](#工具清单89-项可用)
- [目录结构](#目录结构)
- [安全声明](#安全声明)
- [验证](#验证)
- [版本历史](#版本历史)
- [License](#license)

## 一键部署（Podman 容器，推荐）

不想装 Node / MySQL / FFmpeg，就用容器：一个镜像自带 Node 22、MariaDB、FFmpeg、中文字体、中文 OCR 与 SenseVoice/zipformer 语音模型，数据全部留在数据卷里。

**一条命令搞定**（脚本自动：装 podman → 起虚拟机 → 取镜像 → 建数据卷 → 起容器 → 等健康检查 → 打开浏览器）：

```powershell
# Windows（右键「使用 PowerShell 运行」也行）
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1
```

```bash
# Linux
sudo bash deploy/install-linux.sh
```

默认从**阿里云 ACR 自动拉镜像**（约 4.3 GB，国内直连；公开仓库免登录）。取不到镜像时脚本会把可选的三种办法直接打出来，不会静默失败。

### 三种取镜像方式（脚本按此顺序自动回退）

| 方式 | 怎么用 | 适合 |
| --- | --- | --- |
| **镜像包**（优先） | 把 `docbox-0.4.4-image.tar` 放到 `deploy/` 或仓库根目录；或 `-ImageTar PATH` / `--image-tar PATH` | 内网 / 无外网 |
| **本地已有镜像** | 自己构建过：`-SkipLoad` / `--skip-load` | 改代码后重装 |
| **阿里云 ACR**（兜底/默认） | 脚本自动 `podman pull`；也可手动：`podman pull crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev:0.4.4` | 有网，最省事 |

```bash
# ACR 地址（标签 0.4.4 / latest 是同一镜像；docker 同理）
podman pull crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev:0.4.4
```

> 公开仓库，`podman pull` / `docker pull` **免登录**；若以后改成私有，先 `podman login crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com`（用户名/密码见阿里云控制台「访问凭证」）。
> 已发布 digest：`sha256:11ff0ab9d68eb6c7743cbb78959024758dc86fd6ade450c1f09e4a0865abdad4`（`0.4.4` 与 `latest` 同一镜像）。
> 想自己核对：`podman pull crpi-muahgwhixaz856an.cn-hangzhou.personal.cr.aliyuncs.com/podman_images_dev/images_dev:0.4.4` 后
> `podman image inspect --format '{{.Id}}' …` 应得到 `sha256:d44d957fd4ae…`（镜像 config 摘要），
> 与 `latest` 拉下来的是同一个 ID。

### 从源码构建镜像（要改代码时才需要）

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-image.ps1     # 构建 docbox:0.4.4
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1 -SkipLoad
```

```bash
bash deploy/build-image.sh          # 约 10~20 分钟，产物 docbox:0.4.4
bash deploy/install-linux.sh --skip-load
```

- 离线 tar 不随仓库分发（4.3 GB，超过 GitHub 单文件限制）：需要时 `podman save --format docker-archive -o docbox-0.4.4-image.tar <镜像名>` 自行导出；脚本会自动捡 `deploy/`、仓库根目录、`version/*/` 下的 `docbox-*-image.tar`；
- 数据卷 `docbox-data` → `/data`（MariaDB、上传、产物），删容器不丢数据；
- 默认账号 `root / root`，端口 3000，`/api/health` 用于健康检查；
- 常用参数：`-Port`/`--port`、`-Volume`/`--volume`、`--data-dir`（改用绑定目录）、`--boot`（Linux 开机自启 quadlet）、`--no-pull`（完全离线）。

细节、参数与常见问题见 **[deploy/README.md](deploy/README.md)**；  接手/二次开发/发版流程见 **[docs/HANDOVER.md](docs/HANDOVER.md)**（部署 · 改功能 · 发版 · 注意事项 · 故障排查）。

---

> 仓库：<https://github.com/1314ysys/DocBox> · 一键部署与从源码构建见 [`deploy/README.md`](deploy/README.md)

## 快速开始

前置：Windows 10/11、**Node.js ≥ 20**（已验证 v24.20）、本机装有 Edge（文档转 PDF 用）。  
MySQL 8.x 可选：没有也能用，只是「处理历史」不可用。

```powershell
cd docbox
npm install --ignore-scripts   # 首次
cd vad-runtime && npm install && cd ..   # Silero VAD 独立运行时（约 40MB native）
cd ..
python -m venv python\.venv               # 可选：本地音频前处理（numpy 降噪/AGC）
python\.venv\Scripts\python -m pip install -r python\requirements.txt
.\start-all.ps1      # 启动（会顺带拉起 MySQL 服务并打开浏览器）
```

> `vad-runtime/` 是**刻意**与主依赖树隔离的独立包：主树的 Whisper 用 onnxruntime-node 1.14，
> VAD 用 1.22，同进程双版本会崩。`start-all.ps1` / `npm start` 会自动清理 transformers 里坏掉的嵌套 sharp。

打开 <http://127.0.0.1:3000/>，停止用 `.\stop-all.ps1`。

也可以手动跑：

```powershell
cd docbox
npm start            # node --max-old-space-size=8192 server.mjs
npm run smoke        # 192 项冒烟检查（需服务已启动）
```

## 本地数据库

服务启动时自动连接并建库建表，**无需手动执行 SQL**：

| 项 | 值 |
| --- | --- |
| 地址 | `127.0.0.1:3306` |
| 数据库 | `docbox`（不存在会自动创建） |
| 账号 / 密码 | `root` / `root`（本机实测：MySQL 8.4.3，`root@localhost`） |
| 字符集 | `utf8mb4` / `utf8mb4_0900_ai_ci` |

密码按 `DB_PASSWORD` → 空 → `root` → `123456` → `mysql` → `password` 依次尝试，成功后写回配置状态；全部失败时服务仍正常启动，只是历史相关接口返回「数据库不可用」。

可通过环境变量覆盖：`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。

表结构：

- `jobs(id, suite, tool, status, duration_ms, input, output, note, error, created_at)` — 每次处理一行
- `templates(template_id, name, spec JSON, updated_at)` — 水印模板（前端保存时同步）
- `net_reports(id, tool, target, summary JSON, created_at)` — 网络体检结论
- `settings(k, v, updated_at)` — 偏好键值
- `users(id, username, password_hash, role, status, display_name, last_login_at)` — 账户（scrypt 哈希，默认 root/root）
- `user_modules(user_id, module)` — 普通用户的模块授权
- `sessions(sid, user_id, ip, ua, expires_at)` — 登录会话

> 想换库名/密码，改 `docbox/src/config.mjs` 的 `DB` 或设环境变量即可。

## 0.4.4 有什么变化

> 主题：**账户管理的模块授权点了就看得见**，成品目录的容器/宿主机路径关系也说明清楚。

- **修好「普通账户模块点不动」**：胶囊的选中样式原来只按服务端数据写死、和内部 checkbox 没有联动，而 checkbox 又被 CSS 隐藏 —— 所以点了状态其实变了、屏幕毫无反应；
  - 现在勾选一变立刻同步胶囊外观并加 **✓**，每行显示「已选 N / M 个模块」；
  - 有改动时按钮变成高亮的「保存 *」，保存中显示「保存中…」；
  - **切换角色即时联动**：选「管理员」→ 全部模块勾上并锁定，选回「普通用户」→ 恢复已保存的勾选；
  - checkbox 改为"视觉隐藏但可聚焦"，Tab 聚焦 + 空格切换，胶囊有 hover/按下反馈。
- **成品目录说明**：`/api/settings` 新增 `outputs.inContainer` / `dataDir`，账户管理页会把目录标成「容器内路径」并提示宿主机挂载方式（`-v D:\docbox-data:/data` → 成品出现在宿主机 `D:\docbox-data\outputs\`）；下载/预览始终走 HTTP `/files/…`，路径不影响使用。
- 新增 2 条 UI 回归用例（模块胶囊点选有反馈、模块授权可保存），会临时建账号、真点真存、回读校验后删除。

---

## 0.4.3 有什么变化

> 主题：**网络安全工具去掉第三方中间商**——RDAP/WHOIS 直连权威、子域名改本地字典爆破，查过的结果本地缓存。

- **RDAP / WHOIS 不再经过 `rdap.org`**：内置 IANA 引导表（`src/data/rdap/`），域名按后缀、IP 按前缀算出**权威服务器**直连（`example.com → rdap.verisign.com`、`8.8.8.8 → rdap.arin.net`）；
  - 权威 RDAP 不可用时自动 **WHOIS TCP 43 直连兜底**（服务器经 `whois.iana.org` 探测 + 30 天缓存 + 内置兜底表）；
  - **本地缓存**：结果写 `settings` 表（重启不丢），域名 24h / IP 7d，第二次查询 0 毫秒返回；
  - 表单支持「WHOIS 服务器（可选）」与「忽略本地缓存」。
- **子域名枚举改成本地字典爆破**：内置 605 条常用命名 + 可自备 `src/data/subdomains-extra.txt`；
  - `dns.Resolver`（c-ares）真并发，实测 200 个候选 **0.4 秒**扫完（原来走公共 API，受制于人）；
  - 自动**泛解析识别**（随机子域探测 + 按 IP 过滤假结果）；
  - **失败快速**：连续 12 个候选全超时且无 NXDOMAIN → 11 秒内报「本机 DNS 疑似被拦截」并给建议，不再干等 5 分钟；45 秒时间预算，超时返回已扫结果；
  - 来源可选：本地字典 / 证书日志 / 两者，证书日志仍按 crt.sh → hackertarget 重试；
  - 结果缓存 6 小时，返回每条子域名的解析 IP。
- 数据文件说明见 `docbox/src/data/README.md`。

---

## 0.4.2 有什么变化

> 主题：**水印模板对齐参考样式（通用品牌 / 考勤打卡 / 工程记录 / 自定义水印），图片编辑终于能自由选区放大。**

- 图片水印新增 4 套模板，字段严格按参考图来（共 11 套）：
  - **通用品牌**：品牌名 + 真实时间 + 地点 + 经纬度/天气/海拔/方位角 + 拍摄人/工作单位 + 备注；
  - **考勤打卡**：大字打卡时间 + 日期星期天气 + 地点 + 经纬度/海拔 + 拍摄人/工作单位；
  - **工程记录**：自定义标题 + 施工内容 + 拍摄时间 + 地点 + 经纬度/天气/海拔/方位角；
  - **自定义水印**：自定义标题 + 自由多行文字 + 拍摄时间/地点/经纬度/天气/海拔/方位角；
- 新增水印字段：**海拔、方位角、拍摄人、工作单位、施工内容、自定义标题、自定义多行文字**；
- 渲染器新增 `facts` 行（多个字段拼一行，如「经纬度：… · 天气：… · 海拔：…」）与 `free` 行（自定义多行），并加了**文字溢出兜底**（估算字宽导致超宽时自动等比缩到卡内，不再出现 composite 报错）；
- **图片编辑修好自由选区**：画布改为原图 1:1 绘制 + CSS 缩放，选区坐标＝原图坐标（原来选区框相对容器定位，拖出来的框和鼠标对不上、也没法放大看细节）；
  - **拖拽即选区**：左键、右键都能拉选区（右键菜单已屏蔽），拖动选区内部可以整体挪位置；
  - **滚轮**以光标为中心自由放大缩小（20%~1200%），**中键拖拽**平移；
  - **裁剪入口给足三处**：选区上浮出的「✓ 应用裁剪 / ✕ 取消」（还带实时尺寸）、画布上方工具栏的「✂ 应用裁剪」、右侧面板的「应用裁剪选区」；双击选区内部、`Ctrl+Enter` 也能直接裁，`Esc` 取消；
  - **导出前若还有未应用的选区会自动先裁剪**，不会再出现「点了裁剪、下载还是整张图」；
  - 工具栏加了 `−`、缩放百分比（点一下回「适应」）、`＋` 三个按钮与操作提示。
- 新增前端交互自检 `npm run ui:check`（`scripts/ui-check.mjs`）：用无头 Edge/Chrome 走真实鼠标事件「登录 → 图片编辑 → 选图 → 拉选区 → 裁剪 → 导出」，并断言**导出图片尺寸 == 选区尺寸**；当前 8/8 通过。
- 网络安全类工具对公共查询接口（rdap.org / crt.sh / hackertarget）加了**重试与备用源**：crt.sh 挂了自动改用 hackertarget，仍失败会给「接口暂时不可用，稍后重试」的人话提示，而不是抛 `fetch failed`。

---

## 0.4.1 有什么变化

> 主题：**成品文件不再无限堆积——默认 24 小时自动清理，root 可改成永久保存或任意小时数。**

- 新增 `src/lib/retention.mjs`：保留时长存 `settings` 表（重启不丢），`0 = 永久保存`，默认 **24 小时**；
- 后台**每 30 分钟**扫一次（启动 90 秒后先跑一次），清理：
  1. `outputs/` 成品（`/files/...` 指向这里，按文件 mtime）；
  2. `tmp/` 下视频中间产物（`video-*`、`hls-*`、`dash-*`、`ytdlp-*`、`browser-*` …）；
  3. 过期且已结束的 `video_tasks` 记录，避免任务列表留下死链；
- 新接口：`GET /api/settings`（登录可读）、`POST /api/settings/retention`、`POST /api/settings/retention/sweep`（仅管理员）；
- 「账户管理」页新增**成品文件保留策略**面板：下拉 `永久保存 / 1h / 6h / 12h / 24h / 48h / 72h / 168h / 自定义`，显示成品目录、文件数、占用与上次清理时间，可「保存并立即清理」；
- 升级提示：默认生效即 24 小时，历史成品会在下次扫描时按 mtime 清掉；要保留就先改成「永久保存」或先备份 `outputs/`。

---

## 0.4.0 有什么变化

> 主题：**贴个网页链接就行——后台内置浏览器打开页面，自动嗅探 m3u8 再解析下载。**

- 新增 `src/lib/browser.mjs`：**零新增依赖**的无头浏览器嗅探（Node + 已有的 `ws` 直接说 Chrome DevTools Protocol）；
  - 自动找内核：`DOCBOX_CHROME` → Windows Edge/Chrome → Linux chromium → macOS Chrome；
  - 打开页面后监听 Network，抓所有 `.m3u8`（带状态码与请求头），并**带出页面 Cookie**；
  - 自动静音 + `play()` + 轻滚页面，触发那些「点了播放才开始取流」的站点；
  - 抓到的 m3u8 交给自带 HLS 引擎枚举码率，后续分片下载自动携带 **Referer + Cookie**。
- 解析顺序补上第 5 步兜底：m3u8 直链 → 站点内置（B 站）→ yt-dlp → 网页正则 → **内置浏览器嗅探**；
- 新增接口 `GET /api/video/browser`；`probe`/`batch` 支持 `deep`（20 秒深度嗅探）；前端加勾选框、浏览器徽标，解析过程里能看到嗅探的请求数与耗时；
- 镜像内装 `chromium` 并设 `DOCBOX_CHROME=/usr/bin/chromium`（Linux 自动 `--no-sandbox`）。

实测：本地「JS 动态取流」页面静态抓取 0 命中，嗅探 2.6 秒抓到 m3u8，整条 probe→download 6.1 秒、产出 63 KB MP4。

---

更早版本（0.1.1 ～ 0.3.2）的变更明细见 **[docs/CHANGELOG-HISTORY.md](docs/CHANGELOG-HISTORY.md)**。

## 账户与权限

首次启动会自动在 MySQL 里创建内置管理员：**root / root**（角色 `admin`，拥有全部模块）。

| 能力 | 管理员 | 普通用户 |
| --- | --- | --- |
| 可见模块 | 全部 9 个 | 仅被勾选的模块 |
| 账户管理 `#/accounts` | 可见可用 | 导航隐藏，接口 403 |
| 其他模块工具 | 全部可用 | 仅授权模块；未授权模块导航隐藏、卡片过滤、路由跳回首页、接口 403 |

模块键：`image`（图片）`pdf`（PDF）`doc`（文档）`sheet`（表格）`ocr`（OCR 与转写）`media`（音视频）`net`（网络安全）`history`（处理历史）`accounts`（账户管理，仅管理员）。

安全细节：

- 密码 `scrypt(N=16384, r=8, p=1)` + 16 字节随机盐，比较用 `timingSafeEqual`；
- 会话是 24 字节随机 sid，存在 `sessions` 表，Cookie 带 `HttpOnly; SameSite=Lax`；
- 同一账号 5 分钟内登录失败超过 8 次会被限流；
- 改密码 / 停用 / 删除账户会立刻注销该账户的会话；
- **数据库不可用时进入「免登录模式」**：本地工具照常可用（不会把自己锁在门外），登录页会提示数据库不可用。

## 文档工具（15 项）

对标 <https://gongjuheji.com/document> 的全部能力，全部本机实现：

| 工具 | 输入 | 输出 | 说明 |
| --- | --- | --- | --- |
| Word 转 PDF | .docx | PDF | 保留标题 / 列表 / 表格 / 图片（mammoth + Edge 打印） |
| Excel 转 PDF | .xlsx / .xls / .csv | PDF | 多工作表自动分页 |
| PowerPoint 转 PDF | .pptx | 横向 PDF | 逐页解析文字与图片，A4 横向打印 |
| Markdown 转 PDF | .md | PDF | 支持表格、代码块、引用 |
| 文本转 PDF | .txt | PDF | 等宽保留换行 |
| Markdown 编辑器 | 手动输入 | HTML / PDF / .md | 实时预览、草稿保存 |
| HTML 转 Word | .html | .docx | 标题 / 列表 / 加粗转成 Word 段落 |
| Word 转 HTML | .docx | .html | 带样式的独立文件 |
| Word 转 TXT | .docx | .txt | 纯文本提取 |
| Word 格式转换（批量） | 多文件 | TXT / HTML / MD / PDF | 一次转多个，自动打包 |
| Word 转 Markdown | .docx | .md | ATX 标题 + 列表 |
| Markdown 转 HTML | .md | .html | 独立 HTML（自带样式） |
| HTML 转 Markdown | .html | .md | turndown 转换 |
| 公文一键排版 | .docx / .txt / .md | Word + PDF | A4、仿宋三号、缩进、页码、附件换页 |
| Markdown 表格生成器 | 行列数 | Markdown 表格 | 表头 + 列对齐 |

> 图片转 PDF 在「图片」模块（图片合成 PDF），同样属于文档流水线。

## 工具清单（89 项可用）

| 分类 | 数量 | 代表能力 |
| --- | --- | --- |
| 图片 | 7 | 压缩、格式转换（含 AVIF）、尺寸调整、11 套水印（通用品牌/考勤打卡/工程记录/自定义水印…）、图片编辑（右键选区 + 滚轮缩放）、证件照 A4 排版、图片合成 PDF |
| PDF（自研基础） | 7 | 合并、拆分、页面管理、PDF 水印、页码、压缩、拆解导出 |
| PDF（原生套件） | 21 | 旋转 / 删页 / 重排 / 裁剪 / 缩放 / 多页合一 / 小册子 / 叠加 / 长页 / 解压 / 扁平化 / 去空白 / 加密(AES-256) / 解密 / 清理 / 元数据读写 / PDF→图片 / PDF→文字 / 图片提取 / 图片转 PDF / 书签 |
| 文档 | 15 | Word / Excel / PPT / Markdown / 文本 → PDF，HTML ⇄ Word，Word → TXT / HTML / MD，Markdown → HTML，批量转换，公文排版，Markdown 编辑器，表格生成器 |
| 表格 | 2 | Excel ⇄ CSV ⇄ JSON、多工作表拆分 |
| OCR 与转写 | 2 | 图片 + 整本 PDF 的离线中文 OCR（tesseract.js v7 + chi_sim）；音视频 SenseVoice 转写（Silero VAD 分段，离线后台任务 / 在线同步）+ 麦克风 Zipformer 流式实时转写（WebRTC / WS PCM，可选本地 APM 降噪）+ SRT 导出 |
| 账户管理 | 1 | 创建账户、角色（管理员/普通用户）、按模块授权、启停用、重置密码 |
| 音视频 | 18 | 转码、压缩、提取音轨、音频转码、截取、合并、GIF、抽帧、缩放、变速、响度、静音、旋转、水印、图片轮播、淡入淡出、探明信息、清元数据 |
| 网络安全 | 17 | 端口扫描（64 并发/顶 1000 端口）、DNS、ping、traceroute、响应头评级、TLS 证书、RDAP、跳转链、耗时、目录探测、方法探测、服务指纹、本机网络、子域枚举、安全配置生成、IP 归属、SSH/Telnet 网页终端 |

## 目录结构

```
docbox/
  server.mjs               # Express 5 入口（唯一进程、唯一端口 3000）
  src/
    config.mjs             # 端口/路径/DB/ffmpeg 路径/版本号
    tool-catalog.mjs       # 57 条套件工具元数据（PDF 23 / 音视频 18 / 网络 16）
    lib/
      db.mjs               # mysql2 连接池 + 建表 + jobs/templates/reports/settings/users/sessions/user_modules
      auth.mjs             # scrypt 密码、Cookie 会话、模块权限中间件
      pdfops.mjs           # 23 项原生 PDF 实现
      pdf-render.mjs       # pdfjs + @napi-rs/canvas 渲染
      media.mjs            # ffmpeg/ffprobe 封装（18 项）
      docops.mjs           # DOCX 直写 / PPTX 解析 / 公文排版 / Markdown 工具
      netprobe.mjs         # 网络探测（16 项，服务端实现，仅自检/排障用）
      hls.mjs              # HLS 播放列表解析 + 分片下载 + AES-128 解密 + 合成 MP4
      video.mjs            # 视频网站解析（yt-dlp 优先，页面扫描兜底）
      track.mjs            # 处理记录写入
    routes/                # auth / accounts / preview / image / idphoto / pdf / suite / history / doc / sheet / ocr / stt / terminal / video / meta
  public/                  # 原生 ES 模块前端（core / tools / views），含登录页、账户管理、Markdown 编辑器、音视频预览
  public/js/core/netclient.mjs  # 网络安全 16 项：浏览器本机发起的探测引擎（服务器不参与）
  scripts/smoke.mjs        # 159 项冒烟测试
  testdata/                # 冒烟用样例（PDF / 图片 / 音视频 / 表格 / Word / PPTX / Markdown / HTML）
version/                   # 版本基线（VERSION.json + CHANGELOG.md + 源码快照）
```

## 安全声明

网络安全分类**只面向自有或已获授权的资产**：没有口令爆破、漏洞利用或第三方扫描服务。

- **探测由你自己的浏览器发起**（v0.3.0 起）：DNS/端口/HTTP/子域/RDAP 等请求都从登录用户的电脑发出，服务器不代为扫描任何目标，服务端代码只保留给自检脚本与命令行排障；
- Web SSH / Telnet 终端属于「浏览器连目标服务器」，协议上必须由服务端中继 TCP，且不在服务器上执行目标侧命令；
- 视频解析只处理公开可访问的链接，不托管、不转存站点内容，请遵守各平台的版权与使用条款。

## 验证

| 检查 | 结果 |
| --- | --- |
| 宿主 `npm run smoke` | **192 / 192 通过**（登录权限 / 图片 / PDF 基础与套件 / 文档 / 预览 / 音视频 / 网络安全 / 终端 / 转写 / 数据库 / 其它） |
| 宿主 `npm run tools:check` | **94 / 94**（57 个套件工具 + 37 个原生工具，逐个真跑） |
| `npm run ui:check` | **12 / 12**（无头 Edge 真实鼠标事件：选区 → 裁剪 → 导出尺寸一致） |
| 容器 `docbox:0.4.4` | `/api/health` → `{"ok":true,"version":"0.4.4","db":{"available":true}}`，MariaDB 10.11.19 正常初始化 |
| 容器内无头浏览器 | Chromium 155 `--headless=new` 可用，`sniffMedia()` 从本地测试页抓到 `.m3u8 [200]`（视频站解析的兜底链路真实有效） |
| 一键部署（空环境实测） | Windows：一条命令自动 pull 4.3 GB → 起容器 → 健康检查通过；Linux：同流程 215 秒，镜像已在本地时 8 秒 |
| 浏览器实测 | 首页 89 张卡片、7 类预览、OCR、播放器、Markdown 导出、公文排版、账户权限，无控制台报错 |

## 版本历史

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| **0.4.4** | 2026-10-22 | 账户模块授权可点选（胶囊联动 / 已选计数 / 角色联动 / 键盘可操作）；成品目录容器路径说明；一键部署脚本支持 ACR 自动拉取 + ssh 通道自愈；镜像推阿里云 ACR |
| 0.4.3 | 2026-10-21 | 网络工具去第三方依赖：RDAP/WHOIS 直连权威 + 本地缓存，子域名改本地字典爆破（c-ares 并发、泛解析识别、快速失败） |
| 0.4.2 | 2026-10-21 | 水印模板扩到 11 套（通用品牌 / 考勤打卡 / 工程记录 / 自定义）+ 海拔方位角等字段；图片编辑器选区裁剪重做；新增 `npm run ui:check` |
| 0.4.1 | 2026-10-21 | 成品保留策略与定时清理；内置浏览器嗅探（抓 JS 动态 m3u8） |
| 0.4.0 | 2026-10-21 | 内置无头浏览器嗅探视频流 + 解析诊断可见（浏览器 / yt-dlp 状态） |
| 0.3.2 | 2026-10-21 | 解析失败排查与站点适配；yt-dlp 自动发现与一键安装；下载链路补全 |
| 0.3.1 | 2026-10-21 | 视频解析改为「跟原始站点一致」的链路；批量下载 + 任务队列 |
| 0.3.0 | 2026-10-21 | 网络安全 16 项全部改浏览器本机发起；OCR 中英混排 + 条码/二维码；视频网站解析下载；网页终端实测 |
| 0.2.0 | 2026-10-20 | 全工具自检 93/94；Podman 单镜像交付 + Windows/Linux 一键部署脚本 |
| 0.1.9 | 2026-10-20 | 实时转写「定稿区 + 实时行」分离，不再整段抖动 |
| 0.1.8 | 2026-10-20 | 识别引擎换 sherpa-onnx（离线 SenseVoice + 流式 Zipformer）；WebRTC 本地采集；Python 音频前处理侧车 |
| 0.1.7 | 2026-10-20 | 转写模型升级 Whisper small；Silero VAD 神经网络检测人声（独立进程隔离 onnxruntime）；实时转写改 WebSocket PCM 流式 |
| 0.1.6 | 2026-10-20 | SSH/Telnet 网页终端（xterm.js + WebSocket）；OCR 改名「OCR 与转写」，新增 Whisper tiny 转写与麦克风实时转写、SRT 导出 |
| 0.1.5 | 2026-10-20 | 左侧导航独立滚动条；工具返回回到所属分类并恢复滚动位置（含刷新/后退） |
| 0.1.4 | 2026-10-20 | 全类型文件预览：图片 / PDF / Word / Excel / PPT / Markdown-TXT / 音视频，结果卡片同样可预览 |
| 0.1.3 | 2026-10-20 | 文档模块扩到 15 项（PPT/Html↔Word、TXT、批量、公文排版、MD 编辑器、表格生成器） |
| 0.1.2 | 2026-10-20 | 登录 + 角色 + 模块授权（导航/路由/接口三重拦截）、账户管理页 |
| 0.1.1 | 2026-10-20 | 移除 Stirling-PDF 端口与 JDK；新增音视频 18 项、网络安全 16 项、原生 PDF 21 项；接入本地 MySQL；历史页 |
| 0.1.0_beta | 2026-10-20 | 首个基线：Stirling 融合 + 7 套水印 + 离线 OCR + 前端模块化 |

详见 `version/<版本>/CHANGELOG.md`。

## License

MIT

## 许可证

本项目以 **MIT License** 发布，全文见 [LICENSE](LICENSE)。第三方组件（PDF.js、SheetJS、sharp、Stirling-PDF、miniPaint、语音模型等）的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 免责声明

DocBox 只在本地/自有服务器运行，不提供任何第三方内容源。视频解析功能仅用于处理你有权访问的公开链接，使用时请遵守目标网站条款与当地法律法规。
