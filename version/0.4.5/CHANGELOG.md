# DocBox 0.4.5 · 2026-11-11

## 主题：修掉「数据库一坏就等于免登录」的安全缺陷（fail-closed）

### 问题

0.4.4 及以前 `src/lib/auth.mjs`：

```js
if (!authEnabled()) { req.user = null; req.userModules = ALL_MODULE_KEYS; req.authMode = 'open'; return next(); }
```

`authEnabled()` 就是 `dbState().available`。数据库不可用 → 所有接口放行、全模块可用。
这是为「单机桌面工具别被自身故障锁死」设计的，但有三个问题：

1. 一次性判定、从不重试：`initDb()` 只在 `app.listen()` 回调里跑一次，失败后即使数据库恢复也永远不放回严格模式；
2. 完全静默：`/api/health` 依然返回 `ok:true`，界面无任何提示；
3. 容器化后假设失效：源码模式 `DOCBOX_HOST` 默认 `127.0.0.1`（只有本机），但镜像里写死 `0.0.0.0`，一旦部署到局域网，降级就等于对外裸奔。

定级：CWE-636 Not Failing Securely。当前部署不可被未认证攻击者远程触发（MariaDB 只监听容器内 127.0.0.1；运行期查询错误不会翻转 `available`，只有启动时），但**启动期数据库故障（OOM / 磁盘满 / InnoDB 损坏）会导致永久静默的认证绕过**。

### 修法

| 模式 | 条件 | 行为 |
| --- | --- | --- |
| strict | 数据库可用 | 正常登录 + 角色/模块 |
| locked（默认降级） | 数据库不可用 | 受保护接口一律 503 `{code:'DB_UNAVAILABLE'}`；WS 握手断开 |
| open（显式本机降级） | 数据库不可用 + `DOCBOX_OPEN_WITHOUT_DB=1` + loopback | 免登录（仅本机），其余仍 503 |

- 新增 `authModeFor(req)` / `isLoopback()` / `degradedOpenAllowed()`；
- `requireAuth` / `requireAdmin` / `requireModule` 改为按模式守卫；`requireModule` 先判断路径是否属于模块（避免误伤 `/api/health`）；
- `/api/auth/me` 返回 `authMode` / `dbAvailable`；
- `/api/health` 返回 `authMode` / `degraded`，降级时 `ok:false`；
- 启动后若数据库不可用，每 30 秒重试 `initDb()`，恢复即回 strict（无需重启）；
- WebSocket 升级同样按模式拦截；
- 前端：锁定态登录页红色说明，本机降级态顶部橙色横幅。

### 测试

| 项 | 结果 |
| --- | --- |
| `npm run smoke` | **200 / 200**（新增 8 条降级断言） |
| `npm run tools:check` | **94 / 94**（230.5s） |
| `npm run ui:check` | **12 / 12**（20.7s） |

降级断言（实测）：
- 数据库不可用时 `/api/health` → 200、`ok:false`、`authMode:'locked'`
- `/api/app` → 503 `DB_UNAVAILABLE`
- `POST /api/suite/net/headers-gen` → 503
- `POST /api/auth/login` → 503
- 加 `DOCBOX_OPEN_WITHOUT_DB=1` 且 loopback → `authMode:'open'`、`/api/app` 200

### 兼容性

- 无数据库结构变更；
- 依赖「免登录」的老部署需显式加 `DOCBOX_OPEN_WITHOUT_DB=1`，否则升级后接口返回 503（这是有意为之）。
