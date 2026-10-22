# DocBox 0.4.4

> 主题：**账户管理的模块授权终于"点了就看得见"**，并把成品目录的容器/宿主机路径关系说明清楚。

## 1. 普通账户的模块授权点不动（真 bug，已修）

现象：账户管理里点普通用户那一行的模块胶囊（图片工具 / PDF 工具…），**界面毫无变化**，感觉"点不了、授权不了也取消不了"。

根因（已复现确认，后端没问题 —— PATCH /api/accounts/:id 保存模块一直是好的）：

1. 胶囊的选中样式来自服务端渲染时写死的 `.mod-chip.on` 类，**前端没有任何联动**：点击只是把内部那个 `<input type="checkbox">` 的 `checked` 改了；
2. 可那个 checkbox 被 CSS 设成 `display: none`，用户根本看不到勾；
3. 于是"状态其实变了、但屏幕上一点反应都没有"，自然以为点不动。

修法：

- 给表格加 `change` 委托：勾选一变，立刻同步胶囊的 `.on` 类、并给选中项加 **✓** 前缀；
- 每行显示 **「已选 N / M 个模块」**，点一下计数就变；
- 只要有改动，右侧按钮从「保存」变成高亮的 **「保存 *」**（`btn-primary`），保存中显示「保存中…」；
- **切换角色即时联动**：选「管理员」→ 全部模块自动勾上并锁定（禁止单点），选回「普通用户」→ 恢复该账户已保存的勾选；
- 无障碍：checkbox 从 `display:none` 改为"视觉隐藏但可聚焦"，可以用 Tab 聚焦、空格切换，聚焦时有描边；
- 胶囊加了 hover / 按下反馈，锁定态用 `cursor: not-allowed`。

## 2. 成品目录到底在容器里还是宿主机上（说明 + 界面标注）

- 目录由环境变量决定：`DOCBOX_DATA_DIR` 有值 → 用它下面的 `outputs/`（镜像里固定 `DOCBOX_DATA_DIR=/data`，并声明 `VOLUME ["/data"]`），否则用项目目录下的 `outputs/`；
- `/api/settings` 现在额外返回 `outputs.inContainer` 与 `outputs.dataDir`；账户管理页会把目录标成**容器内路径**并提示宿主机该怎么挂：
  `-v D:\docbox-data:/data` → 成品出现在宿主机 `D:\docbox-data\outputs\`；
- **下载/预览始终走 HTTP（`/files/...`）**，浏览器不关心服务端物理路径，所以路径变了不影响任何工具的使用；只有"想直接用文件管理器打开成品"时才需要挂载。

## 3. 验证

| 测试 | 结果 |
| --- | --- |
| `npm run smoke` | **192 / 192** |
| `npm run tools:check` | **94 / 94** |
| `npm run ui:check` | **12 / 12**（新增 2 条：模块胶囊点选有反馈、模块授权可保存） |

新增的 ui-check 用例会**临时建一个 uicheck 账户**、在真实浏览器里点胶囊（校验"勾选状态 == 胶囊外观"）、点保存后用 `/api/accounts` 回读校验，最后删掉该临时账户，不污染现有账号。

实测记录：`pdf：false → true，胶囊「mod-chip on」，已选 2 / 8 个模块`；保存后接口回读 `["image","pdf"]`。目录信息实测：本机 `outputs.dir = E:\…\docbox\outputs，inContainer=false`；设 `DOCBOX_DATA_DIR=D:/container-data` 后为 `D:\container-data\outputs`。

## 6. 交付物（本版已产出并校验）

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `docbox-0.4.4-image.tar` | 4 317 192 704 字节（4.02 GiB） | `podman save --format docker-archive` 导出，镜像 `localhost/docbox:0.4.4` / ID `d44d957fd4ae` / 4.32 GB |
| `docbox-0.4.4.tar.gz` / `docbox-0.4.4.zip` | 1.8 MB / 1.9 MB | 源码快照（`git archive HEAD`），随仓库一起提交 |
| 阿里云 ACR | — | `.../podman_images_dev/images_dev:0.4.4` 与 `:latest`，digest `sha256:6a841d7a9dd9a1eefb9fdf22e2a1ff98d7c99108e2b179620b49353ef7bff476` |

- **镜像包 SHA256**：`b5938d21bbae919729c09192f6c4353928f6d526518d0d2e06b6c5539a822e01`
- **镜像包有效性**：`podman load -i docbox-0.4.4-image.tar` → `Loaded image: localhost/docbox:0.4.4`（实测通过）
- **容器内实跑**：`/api/health` → `{"ok":true,"version":"0.4.4","db":{"available":true}}`
- 说明：镜像包体积超过 GitHub Release 单个资产 **2 GiB** 上限，因此不进 Release；离线分发走网盘/内网，或直接 `podman pull` ACR。

## 7. 升级提示（同 0.4.3 段，无数据库结构变更）

覆盖代码 / 换镜像即可；`settings` 表复用于网络结果缓存，无迁移。
