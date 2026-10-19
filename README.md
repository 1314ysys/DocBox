# DocBox · 本地文档工具箱

**单进程、单端口、数据不出本机**的文档 / 图片 / 音视频 / 网络安全工作台。  
所有处理都在本机 Node 进程内完成（ffmpeg 仅作为子进程调用），任务记录写入本地 MySQL。

`v0.1.5` · 87 个可用工具 · 全类型文件预览 · 15 项文档能力 · 账户角色与模块授权 · 143 项冒烟断言全通过

---

## 0.1.5 有什么变化

- **左侧导航独立滚动**：鼠标停在左侧菜单上滚动只滚菜单（矮窗口时菜单自己有滚动条），滚到头也不会把右侧页面带走；滚轮在右侧内容区才滚页面。
- **返回记住板块位置**：工具页的返回按钮改为「← 返回文档 / 图片 / PDF …」，回到进入前的分类页，并恢复该分类页的滚动位置（不再回到第一个板块的顶部）。
- **位置持久化**：分类页滚动位置按 `#/cat/<分类>` 记录在 sessionStorage，刷新页面、浏览器后退、跨分类来回切换都能回到原位；新打开标签页时从头开始。

## 0.1.4 有什么变化

- **全类型预览**：所有带文件的工具，选完文件立刻预览 —— 图片缩略图、PDF 首页缩略图（pdf.js 客户端渲染）、Word 文本、Excel 表格、PPT 分页要点、Markdown/TXT/HTML 文本、音频/视频播放器，浏览器不支持的媒体容器给出转码提示。
- **结果也能预览**：处理完成后结果卡片里直接看 —— PDF 首页缩略图、转出的 Word 文本、Excel 表格、TXT/MD 文本，图片与音视频保持原来的缩略图与播放器。
- **预览接口**：`/api/preview/document`（上传文件解析为 text / table / slides）与 `/api/preview/output`（按 `/files/...` 地址预览已生成文件），只允许本系统输出目录，越界地址直接 400。
- **OCR 页加预览**：选图后先看缩略图再识别。
- 新增 [preview.mjs](docbox/public/js/core/preview.mjs)（前端预览调度）与 [preview.mjs](docbox/src/routes/preview.mjs)（后端解析）。

## 0.1.3 有什么变化

- **文档模块扩到 15 项**（对齐 gongjuheji.com/document 的全部能力）：Word / Excel / PowerPoint / Markdown / 文本 → PDF，HTML ⇄ Word，Word → TXT / HTML / Markdown，Markdown → HTML，HTML → Markdown，Word 批量格式转换，公文一键排版，Markdown 编辑器，Markdown 表格生成器。
- **PDF 转换全部本地完成**：DOCX 用 OOXML 直写、PPTX 逐页解析（文字 + 图片）后用本机 Edge 打印，不装 Office / LibreOffice。
- **公文一键排版**：A4 版式（上 37 / 下 35 / 左 28 / 右 26 mm）、标题小标宋二号、一级标题黑体、二级楷体、正文仿宋三号、首行缩进两字、28 磅行距、页码（— 1 —）、附件另起一页，同时输出 Word + PDF。
- **Markdown 编辑器** `#/md-editor`：左侧编辑、右侧实时预览（服务端渲染 + 消毒）、字数行数统计、草稿自动存 localStorage，可导出 HTML / PDF / .md。
- **Markdown 表格生成器** `#/md-table`：按行列生成标准表格，支持表头与列对齐，一键复制 / 下载 / 送入编辑器。
- **音视频预览**：音视频工具选文件后立即内嵌播放器（显示格式、体积、时长、分辨率），处理结果卡片同样内嵌播放器；浏览器不支持的容器会提示先转码。
- 修复：单文件工具（PDF 拆分 / 页面管理 / 水印 / 文档类工具）上传字段名写死 `files` 导致 400 的问题。
- 修复：`/api/app` 的工具计数改为按实际目录计算（不再写死 75）。

## 0.1.2 有什么变化

- **账户与角色**：登录后才能使用，密码用 scrypt 加盐存储，会话落库（HttpOnly Cookie，7 天）。默认管理员 **root / root**。
- **模块级权限**：管理员可见 9 个模块（7 个工具模块 + 处理历史 + 账户管理）；普通用户只能看到被勾选的模块，左侧导航、工具卡片、路由**和接口**四处同时拦截，越权请求直接 403。
- **账户管理页** `#/accounts`：新建账户、切换角色、启停用、重置密码、逐账户勾选模块授权；内置 root 保护（不可删除/停用/降级）、至少保留一名启用的管理员。
- **展示卡片与模块对应**：右侧 hero 卡片随左侧所选模块变化（PDF 显示合并/加密/页面组织，音视频显示转码/GIF/音轨，网络安全显示端口/证书/响应头审计…），不再是一张通用展示图。
- 清理残留的 Stirling 入口（顶栏按钮、首页横幅、页脚链接）。

## 0.1.1 有什么变化

- **彻底移除 Stirling-PDF**：不再有 8090 端口、不再需要 JDK 25、`stirling/` 与 `runtime/`（约 1.7 GB）已删除。原 Stirling 的能力全部改写为原生实现，直接跑在 DocBox 的 3000 端口上。
- **新增音视频套件（18 项）**：基于 ffmpeg 的转码、压缩、剪辑、合并、GIF、抽帧、提音、变速、音量、静音、旋转、水印、图片转视频、淡入淡出、元数据清除。
- **新增网络安全套件（16 项）**：端口扫描、DNS、ping/traceroute、响应头审计、TLS 证书、RDAP、跳转链、耗时分解、目录探测、方法探测、服务指纹、本机网络、子域枚举、安全配置生成、IP 归属。
- **新增 23 项原生 PDF 能力**：旋转、删页、重排、裁剪、缩放、多页合一、小册子、拆分、叠加、长页拼接、解压、扁平化、去空白页、加密、解密、清理、读写元数据、PDF→图片/文字、图片提取、图片转 PDF、书签。
- **本地 MySQL 落库**：`jobs`（处理历史）、`templates`（水印模板）、`net_reports`（安全报告）、`settings`（偏好）；数据库不可用时自动降级，其余功能照常。
- **前端新增**：音视频 / 网络安全两个分类页、检测结果 JSON 面板（复制 / 下载）、`#/history` 处理历史页（筛选 / 清空）。

## 账户与权限

首次启动会自动在 MySQL 里创建内置管理员：**root / root**（角色 `admin`，拥有全部模块）。

| 能力 | 管理员 | 普通用户 |
| --- | --- | --- |
| 可见模块 | 全部 9 个 | 仅被勾选的模块 |
| 账户管理 `#/accounts` | 可见可用 | 导航隐藏，接口 403 |
| 其他模块工具 | 全部可用 | 仅授权模块；未授权模块导航隐藏、卡片过滤、路由跳回首页、接口 403 |

模块键：`image`（图片）`pdf`（PDF）`doc`（文档）`sheet`（表格）`ocr`（识别）`media`（音视频）`net`（网络安全）`history`（处理历史）`accounts`（账户管理，仅管理员）。

安全细节：

- 密码 `scrypt(N=16384, r=8, p=1)` + 16 字节随机盐，比较用 `timingSafeEqual`；
- 会话是 24 字节随机 sid，存在 `sessions` 表，Cookie 带 `HttpOnly; SameSite=Lax`；
- 同一账号 5 分钟内登录失败超过 8 次会被限流；
- 改密码 / 停用 / 删除账户会立刻注销该账户的会话；
- **数据库不可用时进入「免登录模式」**：本地工具照常可用（不会把自己锁在门外），登录页会提示数据库不可用。

## 快速开始

前置：Windows 10/11、**Node.js ≥ 20**（已验证 v24.20）、本机装有 Edge（文档转 PDF 用）。  
MySQL 8.x 可选：没有也能用，只是「处理历史」不可用。

```powershell
cd docbox
npm install          # 首次
cd ..
.\start-all.ps1      # 启动（会顺带拉起 MySQL 服务并打开浏览器）
```

打开 <http://127.0.0.1:3000/>，停止用 `.\stop-all.ps1`。

也可以手动跑：

```powershell
cd docbox
npm start            # node --max-old-space-size=1536 server.mjs
npm run smoke        # 143 项冒烟检查（需服务已启动）
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

## 工具清单（87 项可用）

| 分类 | 数量 | 代表能力 |
| --- | --- | --- |
| 图片 | 7 | 压缩、格式转换（含 AVIF）、尺寸调整、7 套水印、图片编辑、证件照 A4 排版、图片合成 PDF |
| PDF（自研基础） | 7 | 合并、拆分、页面管理、PDF 水印、页码、压缩、拆解导出 |
| PDF（原生套件） | 21 | 旋转 / 删页 / 重排 / 裁剪 / 缩放 / 多页合一 / 小册子 / 叠加 / 长页 / 解压 / 扁平化 / 去空白 / 加密(AES-256) / 解密 / 清理 / 元数据读写 / PDF→图片 / PDF→文字 / 图片提取 / 图片转 PDF / 书签 |
| 文档 | 15 | Word / Excel / PPT / Markdown / 文本 → PDF，HTML ⇄ Word，Word → TXT / HTML / MD，Markdown → HTML，批量转换，公文排版，Markdown 编辑器，表格生成器 |
| 表格 | 2 | Excel ⇄ CSV ⇄ JSON、多工作表拆分 |
| 文字识别 | 1 | 图片 + 整本 PDF 的离线中文 OCR（tesseract.js v7 + chi_sim） |
| 账户管理 | 1 | 创建账户、角色（管理员/普通用户）、按模块授权、启停用、重置密码 |
| 音视频 | 18 | 转码、压缩、提取音轨、音频转码、截取、合并、GIF、抽帧、缩放、变速、响度、静音、旋转、水印、图片轮播、淡入淡出、探明信息、清元数据 |
| 网络安全 | 16 | 端口扫描（64 并发/顶 1000 端口）、DNS、ping、traceroute、响应头评级、TLS 证书、RDAP、跳转链、耗时、目录探测、方法探测、服务指纹、本机网络、子域枚举、安全配置生成、IP 归属 |

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
      netprobe.mjs         # 网络探测（16 项，纯 Node 实现）
      track.mjs            # 处理记录写入
    routes/                # auth / accounts / preview / image / idphoto / pdf / suite / history / doc / sheet / ocr / meta
  public/                  # 原生 ES 模块前端（core / tools / views），含登录页、账户管理、Markdown 编辑器、音视频预览
  scripts/smoke.mjs        # 143 项冒烟测试
  testdata/                # 冒烟用样例（PDF / 图片 / 音视频 / 表格 / Word / PPTX / Markdown / HTML）
version/                   # 版本基线（VERSION.json + CHANGELOG.md + 源码快照）
```

## 安全声明

网络安全分类**只面向自有或已获授权的资产**：没有口令爆破、漏洞利用或第三方扫描服务，全部为连通性、指纹与配置审计的本地实现，每条结果都带 `warning: 仅限自有或已获授权的资产`。请勿用于未授权目标。

## 验证

- `npm run smoke`：**143/143 通过**（登录/权限 16 · 图片/证件照 5 · PDF 基础 7 · PDF 套件 22 · 文档 16 · 预览 11 · 音视频 16 · 网络安全 15 · 数据库 10 · 其它 25）
- 浏览器（Edge/Chromium）实测：首页 87 张卡片、文档 15 项、图片/PDF/Word/Excel/PPT/Markdown/TXT 七类预览、结果 PDF 与 Word 预览、OCR 缩略图、音视频播放器、Markdown 编辑器导出、公文排版、账户权限，均无控制台报错。

## 版本历史

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 0.1.5 | 2026-10-20 | 左侧导航独立滚动条；工具返回改为回到所属分类并恢复滚动位置（含刷新/后退） |
| 0.1.4 | 2026-10-20 | 全类型文件预览：图片 / PDF 首页 / Word 文本 / Excel 表格 / PPT 分页 / Markdown-TXT 文本 / 音视频播放器，结果卡片同样可预览 |
| 0.1.3 | 2026-10-20 | 文档模块扩到 15 项（对齐 gongjuheji.com/document：PPT/Html↔Word/TXT/批量/公文排版/MD 编辑器/表格生成器），音视频预览播放器 |
| 0.1.2 | 2026-10-20 | 登录 + 角色 + 模块授权（导航/路由/接口三重拦截）、账户管理页、展示卡片与模块一一对应 |
| 0.1.1 | 2026-10-20 | 移除 Stirling-PDF 端口与 JDK；新增音视频 18 项、网络安全 16 项、原生 PDF 21 项；接入本地 MySQL；新增历史页 |
| 0.1.0_beta | 2026-10-20 | 首个基线：Stirling 融合 + 7 套水印 + 离线 OCR + 前端模块化 |

详见 `version/<版本>/CHANGELOG.md`。

## License

MIT
