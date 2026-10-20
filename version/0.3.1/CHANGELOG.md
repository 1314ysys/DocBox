# DocBox 0.3.1（2026-10-21）

> 主题：**视频解析融合「网页 → m3u8」链路 + 批量下载任务队列。**

## 1. m3u8 解析改为「跟原始视频网站一致」的链路

以前只认「链接本身就是 m3u8」，站点页面要先自己找 m3u8。现在统一成一条链路（`src/lib/video.mjs` 的 `resolveSource`）：

1. **链接本身是 m3u8** → 解析 master/meida，枚举码率；
2. **yt-dlp 可用** → `-J` 拿站点信息，**优先取其中的 m3u8 流**（`protocol=m3u8*`），交给自带 HLS 下载器；
3. **普通网页** → 抓 HTML 与内嵌 JS（兼容 `\/`、`\u002F` 转义与 `"url":"...m3u8"` JSON 字段）找出 m3u8 / 直链；找到 m3u8 再解析出码率；
4. **页面里是 iframe 播放器** → 自动跟进一层（最多 2 层）再抓。

结果：B 站/YouTube/爱奇艺/腾讯/优酷 这类站点「贴网页链接 → 自动拿到站内 m3u8 → 走内置下载器」；任何站点只要页面里出现 m3u8，也能直接解析下载，不依赖 yt-dlp。

## 2. 批量下载 + 任务列表

- 新增后台任务队列 `src/lib/video-tasks.mjs`：
  - 用户一次贴多条 URL（一行一条，最多 50 条/次），建任务后**后台自动解析 + 下载**，关掉页面也继续跑；
  - 并发 2（`DOCBOX_VIDEO_PARALLEL` 可调），状态机 `queued → resolving → downloading → done/failed/canceled`；
  - 进度：HLS 按分片计数、直链按字节数；可**取消 / 重试 / 删除**，任务落库 `video_tasks` 表，重启后历史可见（中断的标记失败可重试）；
  - 产物统一进 `outputs/`，任务列表里点「下载」即可取回 MP4。
- 新增接口：
  - `POST /api/video/batch`　批量建任务
  - `GET  /api/video/tasks`　任务列表 + 统计
  - `GET  /api/video/tasks/:id` · `POST …/cancel` · `POST …/retry` · `DELETE …/:id` · `DELETE /api/video/tasks`
- 前端「视频网站解析」页面改版：
  - 上半：单条解析（显示引擎、站点内 m3u8 地址、码率列表，可直接下载或「加入后台队列」）；
  - 下半：批量输入框 + 任务列表（进度条 / 状态 / 大小 / 操作），3 秒自动刷新，离开页面自动停轮询。

## 3. 其它

- `hls.mjs`：分片/密钥请求补 `AbortSignal`（支持取消）、统一 UA + Referer；
- `db.mjs`：新增 `video_tasks` 表与 CRUD（DB 不可用时自动降级为纯内存队列）；
- 冒烟增至 188 项（新增批量任务列表、批量接口非法链接校验）；
- 版本号 0.3.1，镜像 `docbox:0.3.1`。

## 4. 验证

| 项目 | 结果 |
| --- | --- |
| 网页 → m3u8 解析 | 本地测试页（JS 里带 `\/` 转义的 m3u8）解析成功：`kind=page, engine=hls`，标题取自页面 |
| 批量任务 | 2 条 URL（1 个网页 + 1 个 m3u8 直链）全部 `done`，各产出 122 KB MP4 |
| 任务操作 | retry / cancel / delete 均返回成功 |
| 任务统计 | `{total:2, running:0, done:2, failed:0}` |
