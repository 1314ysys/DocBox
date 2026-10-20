# 0.1.9 · 2026-10-20

> 修复实时转写结果框：文字删不掉、每句话闪烁后又被改写。

## 问题

0.1.8 的 `renderLive()` 在每次 partial 都整体重写 textarea：

```js
ta.value = st.finalText + (st.partialText ? '\n' + st.partialText : '');
```

- 每 180ms 一次整段重写 → 用户删掉的字符被立即写回（"无法删除"）；
- 未定稿文本被当成新行插入、下次整行替换 → "闪一行出来，再把多余的字删掉"；
- 重写还会重置光标与滚动位置。

## 修复

- 结果框只放**定稿**文本：新增 `appendConfirmed()`，用 `ta.setRangeText(sep + text, len, len, 'end')` 末尾插入，绝不整段重写；用户编辑与光标得以保留；
- 新增 `#ocrLive` 预览行（`.ocr-live`，虚线蓝框，前缀"识别中"）：`setLivePartial()` 只改 `textContent`，partial 原地刷新，不再碰结果框；
- `final`：追加该句 + 清空预览 + 记录分段（SRT 用）；
- `done`：不再覆盖整段（只有一条 final 都没收到时才兜底写入）；
- 开始/停止/切页签都会重置预览行与分段状态。

## 验证

- 浏览器实测（Edge + 虚拟麦克风，7.78s 语音）：识别中预览行 47/70 次采样可见，长度序列单调（2→3→4→6→7→10→11→13→16→18→19→26→28→31），**回退 0 次**；
- 实时中全选删除 → 立即为空，3 秒后仍为空（旧文本未被还原）；
- 停止后结果框保留"支持中文和 EMPLOY识别"等定稿内容；
- `npm run smoke`：**177/177**（新增 3 项静态断言）。

## 文件

- 修改：`docbox/public/index.html`（新增 `#ocrLive`）、`docbox/public/styles.css`（`.ocr-live`）、`docbox/public/js/views/ocr.mjs`（`setLivePartial` / `appendConfirmed` / 新 `renderLive`）、`docbox/scripts/smoke.mjs`、`README.md`
