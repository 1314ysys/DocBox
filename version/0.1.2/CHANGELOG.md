# 0.1.2 · 2026-10-20

> 主题：**登录 + 角色 + 模块级权限，右侧展示卡片与左侧模块一一对应。**

## 新增

### 账户与角色
- 新表 `users`（账号、scrypt 密码哈希、角色、状态、最近登录）、`user_modules`（普通用户授权模块）、`sessions`（登录会话）
- 密码：`scrypt(N=16384,r=8,p=1)` + 16 字节盐，`timingSafeEqual` 比较
- 会话：24 字节随机 sid，HttpOnly + SameSite=Lax，7 天有效，改密码/停用/删除即注销
- 登录接口 5 分钟 8 次失败限流
- 首次启动自动播种内置管理员 **root / root**

### 模块级权限
- 模块键：image / pdf / doc / sheet / ocr / media / net / history / accounts
- 四重拦截：左侧导航隐藏 → 工具卡片过滤 → 前端路由守卫跳回首页 → 后端接口 403（按请求路径映射模块）
- `/api/accounts/*` 仅管理员；`/api/health` 与 `/api/auth/login` 免登录

### 账户管理页 `#/accounts`
- 新建账户（账号 2-32 位、密码 ≥4 位）、角色切换、启停用、重置密码、删除
- 逐账户模块勾选，保存即生效
- 保护：root 不可删除/停用/降级；不能停用或删除自己；至少保留一名启用的管理员

### 界面
- 登录页（错误提示、限流提示、初始账号提示）
- 右上角用户菜单：账号、角色、模块数、账户管理入口、退出登录
- 右侧 hero 展示卡片随左侧模块切换，文案也随之变化

## 变更
- `/api/app` 增加 `auth`（enabled / user / modules）；`meta.mjs` 的 health 保持免登录
- 服务启动日志新增 `AUTH: 启用（默认账号 root/root）`
- 图前端 `core/auth.mjs` 统一登录态；`core/api.mjs` 收到 401 自动弹出登录页
- 版本号 0.1.2；冒烟测试 86 → **110** 项（新增登录、越权、账户 CRUD）

## 移除
- 首页 Stirling 横幅、顶栏“打开 PDF 套件”按钮、页脚 Stirling 链接、`stirlingPill` 逻辑

## 修复
- 侧栏 `nav-item[hidden]` 被 flex 覆盖的问题（补 `display:none !important`）
- 登录层 `display:flex` 覆盖 `[hidden]` 导致登录框不消失（补 `.login-screen[hidden]`）

## 验证
- `npm run smoke`：**110 / 110 通过**（新增 16 项登录/权限断言）
- 浏览器实测：未登录被拦 401、错误密码提示、root 登录 75 工具、viewer 仅 3 模块/36 工具、`#/cat/pdf` 跳回首页、`/api/suite/pdf/*` 与 `/api/accounts` 返回 403、账户新建/授权/保存/删除全流程，控制台 0 报错
- 截图：登录页、账户管理、模块化 hero、受限用户视图（docbox/shots/v012-*.png）

## 已知问题
- 数据库不可用时进入免登录模式（不校验账户）
- 会话存库，清空 `sessions` 表等于让所有账号重新登录