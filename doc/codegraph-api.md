# Codegraph MCP — `codegraph_explore` 接口详细文档

自然语言或符号名查询，一次调用返回相关符号的**完整源码**（等价于 Read，无需再打开文件）。大多数问题只需这一个调用。

---

## 输入参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `query` | string | **是** | — | 自然语言问题，或符号/文件名的组合（空格分隔），如 `"AuthService loginUser session-manager"` |
| `maxFiles` | number | 否 | 12 | 返回源码的最大文件数，控制输出篇幅 |
| `projectPath` | string | 否 | — | 其他已初始化 `.codegraph/` 的项目路径，省略则用当前项目 |

### `query` 写法示例

| 场景 | query 写法 |
|------|-----------|
| 架构/原理 | `"how does the terminal session lifecycle work"` |
| 符号定位 | `"pushNavHistory"` |
| 多符号关联 | `"AuthService loginUser session-manager"` |
| 文件+符号 | `"App.tsx pushNavHistory"` |
| 流程追踪 | `"mutateElement renderScene"`（命名路径上的关键符号，自动浮现调用链） |
| bug 调查 | `"git status refresh pendingPathRef stale"` |

---

## 输出格式

完整输出由三个段组成：

### 段 1：概览行

```
## Exploration: <query摘要>

Found <N> symbols across <M> files.
```

示例：
```
## Exploration: App.tsx

Found 79 symbols across 19 files.
```

### 段 2：Blast radius（依赖警告）

列出涉及符号的**调用方**（caller），标注是否有测试覆盖。重构/编辑前应检查此段。

```
### Blast radius — what depends on these (update/verify before editing)

- `<symbol>` (<file>:<line>) — <caller数> caller in <file>; ⚠️ no covering tests found
- `<symbol>` (<file>:<line>) — <caller数> callers in <file1>, <file2>; ✅ tests cover this
```

示例（实际输出）：
```
### Blast radius — what depends on these (update/verify before editing)

- `applyCSSVariables` (src/renderer/src/themes/context.tsx:16) — 1 caller in `src/renderer/src/themes/context.tsx`; ⚠️ no covering tests found
- `pushNavHistory` (src/renderer/src/App.tsx:330) — 1 caller in `src/renderer/src/App.tsx`; ⚠️ no covering tests found
- `resolveAndOpenFile` (src/renderer/src/components/TerminalView.tsx:132) — 2 callers in `src/renderer/src/components/TerminalView.tsx`; ⚠️ no covering tests found
```

字段解读：
- **caller数** — 直接调用该符号的函数数量
- **in <file>** — 调用方所在文件
- **⚠️ no covering tests found** — 该符号无测试覆盖，修改需格外小心
- **✅ tests cover this** — 有测试保护

### 段 3：Source Code（逐文件源码）

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

每个文件一个 `####` 块：

```
#### <file> — <symbol1>(<edge类型>), <symbol2>(<edge类型>), +<N> more

```<lang>
<行号>  <源码行>
<行号>  <源码行>
...
```
```

示例（实际输出）：
```
#### src/renderer/src/App.tsx — pushNavHistory(calls), eventMatchesBinding(calls), getShortcuts(calls), App(function), useI18n(calls), +3 more

```tsx
139	  revision: number          // 递增以强制 DiffViewer 重新加载内容
140	}
141	
142	export default function App() {
143	  const { t } = useI18n()
144	  const [sessions, setSessions] = useState<TerminalSession[]>([])
...
```

**文件标题行字段解读：**

- `<file>` — 文件路径
- `<symbol>(calls)` — 该符号是**调用方**（calls 别人），explore 顺着它展开
- `<symbol>(function)` — 该符号是 function 定义
- `+<N> more` — 该文件中还有 N 个相关符号未在标题中列出

### 截断处理

当输出超预算时，源码尾部截断并附提示：

```
... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. ... do not Read these files.)
```

**处理方式：** 对截断的特定区域，再做一次 `codegraph_explore` 用更窄的 query，**不要 Read 已展示的文件**——explore 已等价于 Read。

---

## 输出行为特性

| 特性 | 说明 |
|------|------|
| 源码实时性 | 每次调用从磁盘实时读取，非缓存，与 Read 工具 byte-for-byte 等价 |
| 行号格式 | `<行号><tab><源码>`，与 Read 工具一致 |
| 预算控制 | `maxFiles` 限制源码文件数；超出时截断而非遗漏 |
| 符号发现 | 单个 query 可跨越 10+ 文件发现相关符号（如 `App.tsx` 发现 79 symbols / 19 files） |
| 边类型标注 | 文件标题标注每个符号的边类型（calls/called by），方便追踪调用链 |
| 重载/多定义 | 同名符号在不同文件的定义都会出现，无需额外消歧 |
| 空结果 | 若 query 无匹配，返回空（无 symbols found） |

---

## 与其他 Codegraph 工具的配合

| 场景 | 策略 |
|------|------|
| explore 截断了某符号 body | 用 `codegraph_node(symbol, includeCode=true)` 补充单个符号 |
| 需精确消歧重载符号 | 用 `codegraph_node(symbol, file="xxx.ts", line=42)` |
| 需完整 caller/callee 列表 | 用 `codegraph_callers` / `codegraph_callees`（explore 的 Blast radius 只列部分） |
| 重构前影响评估 | 用 `codegraph_impact`（深度遍历下游依赖） |
| 仅需符号位置（无源码） | 用 `codegraph_search`（更快更轻） |

---

## 实际调用示例

```javascript
// 查询架构原理
codegraph_explore({ query: "how does terminal session lifecycle work" })

// 查询具体符号
codegraph_explore({ query: "pushNavHistory" })

// 查询多符号关联
codegraph_explore({ query: "AuthService loginUser session-manager" })

// 限制输出篇幅
codegraph_explore({ query: "App.tsx", maxFiles: 2 })

// 查询其他项目
codegraph_explore({ query: "main entry point", projectPath: "/path/to/other/project" })
```