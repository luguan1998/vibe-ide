# Alt+K CodeGraph Explore 功能方案

## 背景

当前 Alt+K 打开 `CodeGraphSearch` 浮窗，用于符号搜索（searchNodes）。用户希望新增"探索"模式：输入自然语言 → 按 Enter → 调用 `codegraph.explore` → 结果以 MD 格式在浮窗展示。

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/shared/types.ts` | 新增 `CODE_EXPLORE` IPC 频道 |
| `src/main/codegraph.ts` | 新增 `code:explore` handler，调用 `cg.explore()` |
| `src/preload/index.ts` | 新增 `code.explore(query, opts)` 桥接方法 |
| `src/renderer/src/components/CodeGraphSearch.tsx` | 新增 Search/Explore 模式切换，Explore 模式 Enter 触发调用 |
| `src/renderer/src/components/CodeGraphExploreResult.tsx` | **新建** — MD 渲染浮窗展示 explore 结果 |
| `src/renderer/src/App.tsx` | 新增 `exploreResult` 状态，渲染 `CodeGraphExploreResult` |

## 实施步骤

### Step 1: IPC 管道 — types + main + preload

**types.ts** — 已完成，新增 `CODE_EXPLORE: 'code:explore'`

**preload/index.ts** — 已完成，新增 `explore` 桥接方法

**codegraph.ts** — 核心改动：直接引入 MCP `ToolHandler`，传入已有 `cg` 实例调用 `handleExplore`：

```ts
ipcMain.handle(IPC_CHANNELS.CODE_EXPLORE, async (_event, query: string, opts?: { maxFiles?: number }) => {
  if (!cg) return { error: 'Not initialized', content: '' }
  try {
    const { ToolHandler } = require('@colbymchenry/codegraph/dist/mcp/tools')
    const handler = new ToolHandler(cg)
    const result = await handler.handleExplore({ query, maxFiles: opts?.maxFiles ?? 12 })
    // result = { content: [{ type: 'text', text: markdown字符串 }] }
    const text = result.content?.[0]?.text || ''
    return { content: text }
  } catch (err: any) {
    return { error: err.message, content: '' }
  }
})
```

`ToolHandler` 构造只需 `cg` 实例（已有），`handleExplore` 返回完整 MCP 格式 markdown，无需自己组装。

### Step 2: CodeGraphSearch 模式切换

在搜索行图标旁加模式切换按钮组（`Search` | `Explore`），用 `mode` state 管理。

- **Search 模式**（默认）：行为不变，debounce 250ms 搜索
- **Explore 模式**：
  - placeholder 改为 "输入问题后按 Enter 探索..."
  - 不 debounce，仅在 Enter 时触发
  - 隐藏 kind filter 行（explore 是自然语言，不需要类型过滤）
  - Enter → 调用 `window.api.code.explore(query.trim(), { maxFiles: 12 })`
  - 调用成功后：将结果 `{ content }` 传给 `onExploreResult` 回调，关闭搜索浮窗

### Step 3: CodeGraphExploreResult 浮窗组件（新建）

**设计**：全屏半透明背景 + 居中大卡片，和 history popup 同模式。

```tsx
// fixed inset-0 z-50 flex items-center justify-center bg-black/50
// 内层卡片：w-[80vw] max-h-[85vh] bg-ide-sidebar border rounded-lg shadow-2xl
```

结构：
- 顶部栏：标题 "Explore: <query摘要>" + 关闭按钮(Esc)
- 内容区：`overflow-auto` + `.md-preview` CSS class + `ReactMarkdown` + `remarkGfm`
- 加载态：spinner
- 错误态：红色提示
- Escape 关闭：`document.addEventListener('keydown', handler, true)` + `e.stopImmediatePropagation()`
- 背景点击关闭：`onClick={() => onClose()}`，内层 `onClick={e => e.stopPropagation()}`

### Step 4: App.tsx 集成

- 新增 state：`exploreResult`（`null | { query: string; content: string }`）
- `CodeGraphSearch` 新增 prop `onExploreResult`：
  ```tsx
  onExploreResult={(result) => { setExploreResult(result); setShowCodeSearch(false) }}
  ```
- 在 App render 底部新增：
  ```tsx
  {exploreResult && (
    <CodeGraphExploreResult
      query={exploreResult.query}
      content={exploreResult.content}
      onClose={() => setExploreResult(null)}
    />
  )}
  ```

## 验证方式

1. `npm run dev` 启动
2. Alt+K 打开浮窗 → 切换到 Explore 模式
3. 输入如 "how does terminal session lifecycle work" → 按 Enter
4. 搜索浮窗关闭，结果浮窗弹出，MD 格式正确渲染
5. Esc 或点击背景关闭结果浮窗
6. 切回 Search 模式，原有功能不变