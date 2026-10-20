# 0.1.10 · 2026-10-20

> 修复账户管理「账户列表」行距过长：单行 458px → 64px。

## 根因

账户页复用了通用的两栏 `.workspace`（`minmax(0,1.35fr) minmax(300px,.65fr)`），把 6 列的账户表塞进右侧 345px 的窄栏：

- 表格列被压到极限，「授权模块」列只剩 **52px**，8 个模块标签只能竖排 → 每行高度 **458px**；
- 表格本身 1040px 起，窄栏里还出现横向滚动条。

## 修复

- `.workspace-accounts { grid-template-columns: minmax(0, 1fr) }`：账户页改为整行，表格拿到 1166px；
- `.mod-grid`：`gap 4px 5px`、`max-width 560px`；`.mod-chip`：`padding 2px 7px`、`font-size 10.8px`；
- 单元格 `padding 8px 10px`、`line-height 1.45`；关键列设置 `min-width`（账号 150 / 角色 108 / 状态 84 / 最近登录 132 / 操作 196）；
- `.account-form .fld` 限制 `max-width 240px`，新建表单不再铺满整行。

## 验证

- Playwright 实测（1500×1000）：行高 458 → **64px**，模块列 52 → 474px，横向滚动消失，表单字段宽 240px；
- `npm run smoke`：**178/178**（新增「账户页整行布局已生效」）。

## 文件

- 修改：`docbox/public/js/views/accounts.mjs`（workspace-accounts 类）、`docbox/public/styles.css`（布局/表格/标签/表单）、`docbox/scripts/smoke.mjs`、`README.md`
