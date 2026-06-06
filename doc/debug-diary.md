# Monaco Diff 红色误报排查日记

**日期**: 2026-06-06 | **耗时**: ~2h

## 现象

文件只新增几行（无删除），inline diff 左侧 `.margin-view-overlays` 出现红色竖条，暗色主题下渲染色 `#3c2424`。

## 排查路径（7 个方向，前 6 个全错）

| # | 尝试 | 依据 | 为何无效 |
|---|---|---|---|
| 1 | 加 `useInlineViewWhenSpaceIsLimited` | 怀疑窄面板 side-by-side 布局错位 | 此选项不存在 |
| 2 | ResizeObserver 检测宽度 < 500px 强制 inline | 怀疑容器宽度导致左右交叉 | 本来就是 inline |
| 3 | 删 `diffAlgorithm: 'advanced'` | 怀疑算法变更 (`903ad93`) | Gutter 颜色与算法无关 |
| 4 | 恢复 `keepCurrentOriginalModel` / `keepCurrentModifiedModel` | 怀疑 `0ed9902` 去掉后 model 重建 | 与 model 生命周期无关 |
| 5 | CRLF/LF 归一化 (`\r\n` → `\n`) | 怀疑 `git show` (LF) vs `file.read` (CRLF) 行尾不一致 | 与行尾无关 |
| 6 | CSS `display:none` `.gutter-delete` | 直接隐藏红色竖条 | 会同时隐藏真正的删除标记 |

## 根因

方向全错，问题不在 diff 算法也不在布局。

commit `903ad93` 在 `monaco-themes.ts` 中新增了：

```ts
'diffEditorGutter.removedLineBackground': danger + '25',  // 新增
'diffEditorGutter.insertedLineBackground': success + '25',
```

Monaco 的 CSS 变量优先级链：

```
.gutter-delete background-color =
  var(--diffEditorGutter-removedLineBackground)     ← danger+25% 🔥 新增
  → var(--diffEditor-removedLineBackground)         ← danger+15% (fallback)
  → var(--diffEditor-removedTextBackground)         ← danger+20%
```

**之前**：未设置 gutter token，走 fallback `danger+15%`，在 `#1e1e2e` 背景上几乎不可见。

**之后**：显式设置 `danger+25%`，opacity 从 15% 提到 25%，渲染为 `#3c2424`。Monaco 算法本身的误匹配一直存在，只是之前看不清。

## 教训

**先定位颜色从哪里来，再追代码。** `git log -p -S "keyColorOrOption" -- path` 用 pickaxe 找引入点，比猜算法/布局/编码快 10 倍。
