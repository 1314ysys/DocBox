# 0.1.5 · 2026-10-20

> 主题：**修左侧菜单滚动 + 返回不再跳回顶部。**

## 修复

### 1. 左侧导航独立滚动
- `.sidebar` 增加 `overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable;`
- 鼠标停在菜单上滚轮只滚菜单；窗口高度不足时菜单出现自己的细滚动条（`::-webkit-scrollbar` 8px）
- 滚到菜单两端也不会把右侧内容带走（`overscroll-behavior: contain`）

### 2. 返回记住板块与滚动位置
- 工具页返回按钮：`#/` → `#/cat/<tool.cat>`，文案由「← 返回全部工具」改为「← 返回文档 / 图片 / PDF / …」
- Markdown 编辑器、表格生成器返回 `#/cat/doc`，水印页返回 `#/cat/image`
- `main.mjs` 新增滚动记忆：按 hash 记录 `window.scrollY`，`history.scrollRestoration = 'manual'`，路由切换后 rAF + 160ms 双次恢复（兼顾异步渲染页面）
- 记忆写入 `sessionStorage['docbox.scroll']`，刷新、浏览器后退、分类来回切换均恢复；新标签页从头开始

## 测试
- `npm run smoke`：**143 / 143 通过**
- 浏览器实测：分类页滚到 463 → 进工具 → 点返回 → `#/cat/doc` 且 463；浏览器后退 463；刷新 463；文档分类 463 与音视频分类 300 互不干扰；左侧滚轮后 `window.scrollY=0`、右侧滚轮 `window.scrollY=463`；1400×470 窗口左侧 `scrollTop=342` 页面不动；控制台 0 报错