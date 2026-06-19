# AI Tab 架构文档

## 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│ 渲染进程 (Renderer)                                          │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ AiTab.tsx                                                │ │
│ │ ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │ │
│ │ │ 消息列表     │  │ 流式缓冲区    │  │ 权限卡片          │ │ │
│ │ │ (messages)  │  │ (streamBuffer│  │ (pendingPermission│ │ │
│ │ │             │  │  thinkingBuf)│  │  AskUserQuestion  │ │ │
│ │ │ AiMessage   │  │ StreamingMk │  │  ExitPlanMode     │ │ │
│ │ │ Bubble      │  │ + 光标       │  │  PermissionCard   │ │ │
│ │ └─────────────┘  └──────────────┘  └──────────────────┘ │ │
│ └──────────────────────────────────────────────────────────┘ │
│                          ▲ IPC (contextBridge)                │
└──────────────────────────┼───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│ 主进程 (Main)             │                                   │
│ ┌────────────────────────┴──────────────────────────────────┐ │
│ │ ai.ts                                                     │ │
│ │ ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │ │
│ │ │ spawnClaude  │  │ handleNdjson │  │ ipcMain handlers │ │ │
│ │ │ (child_proc) │──│ Message()    │──│ AI_CREATE        │ │ │
│ │ │              │  │ (stdout解析) │  │ AI_SEND          │ │ │
│ │ │              │  │              │  │ AI_PERMISSION_…  │ │ │
│ │ └──────┬───────┘  └──────┬───────┘  │ AI_ASK_RESUME    │ │ │
│ │        │                 │          └──────────────────┘ │ │
│ │   Claude CLI         解析后                                │ │
│ │   子进程             发送 IPC                               │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─────────────────────┐  ┌──────────────────────────────────┐ │
│ │ ai-ask-resume.ts    │  │ ai-plan-execute.ts               │ │
│ │ AskUserQuestion     │  │ ExitPlanMode "清空并执行"         │ │
│ │ Kill-and-Resume     │  │ 杀进程 → 重 spawn(acceptEdits)    │ │
│ │ 杀 → spawn(--resume)│  │ → 注入 plan 作为首条消息          │ │
│ └─────────────────────┘  └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 1. 主进程 (src/main/ai.ts)

### 1.1 Claude CLI 子进程管理

```
aiSessions: Map<sessionId, ManagedAiSession>
  ├── process: ChildProcess
  ├── sessionId: string
  ├── cwd: string
  ├── lineBuffer: string          // stdout 行缓冲
  ├── ready: boolean              // system/init 已接收
  ├── claudeSessionId?: string    // CLI 返回的 session_id (用于 --resume)
  ├── contextWindow?: number      // 模型实际 context window 大小
  ├── permissionMode?: AiPermissionMode
  ├── pendingPermission?: {...}   // 当前等待的权限请求
  └── awaitingUserInput?: boolean // AskUserQuestion 主动杀进程标记
```

### 1.2 启动 CLI

```
AiTab.create(sessionId, cwd, ...)
  → ipcMain.handle(AI_CREATE)
    → spawnClaude({ cwd, permissionMode, resumeSessionId? })
      → findBinary()                        // 找 claude / openclaude
      → spawn('claude', [
          '-p',
          '--output-format', 'stream-json',
          '--input-format', 'stream-json',
          '--permission-prompt-tool', 'stdio',
          '--verbose',
          '--include-partial-messages',      // ★ 关键：流式期间发送部分消息
          '--permission-mode', permissionMode,
          '--resume', resumeSessionId?,      // 恢复历史会话
        ])
    → attachAiProcess(sessionId, proc, cwd)
```

### 1.3 NDJSON 消息解析 (handleNdjsonMessage)

CLI 的 stdout 是 NDJSON (每行一条 JSON)。`attachAiProcess` 中的 stdout data 处理器逐行解析并路由：

| CLI type | IPC 通道 | 说明 |
|---|---|---|
| `system` (init) | `AI_READY` | 会话初始化完成，携带 model、slash_commands |
| `assistant` | `AI_MESSAGE` | 完整/部分 assistant 消息块 |
| `stream_event` | `AI_STREAM_TOKEN` | 逐 token 文本/thinking 增量 |
| `user` (tool_result) | `AI_MESSAGE` | 工具执行结果 |
| `result` | `AI_MESSAGE` | 回合结束，携带 cost/duration |
| `control_request` | `AI_PERMISSION` | 权限请求卡片 |
| `tool_progress` | `AI_PROGRESS` | 工具执行进度 |

#### assistant 消息结构

```typescript
// CLI 每个 content block (thinking → text → tool_use) 发一条 assistant 消息
// --include-partial-messages 下，同一 text block 会被多次发送，每次内容累积
{
  type: 'assistant',
  message: {
    id: 'msg_xxx',           // ★ 同一消息轮的多个 block 共享相同 id
    content: [
      { type: 'text', text: '...' },
      { type: 'thinking', thinking: '...' },
      { type: 'tool_use', id: '...', name: 'Write', input: {...} },
    ],
    parent_tool_use_id: '...', // 子 agent 调用
    usage: { input_tokens: 500, ... },
    modelUsage: { 'claude-sonnet-4-6': { contextWindow: 200000 } },
  },
}
```

#### stream_event → token

```typescript
// stream_event 是逐 token 增量
{ type: 'stream_event', event: {
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'Hel' }
} }
// 或
{ type: 'stream_event', event: {
    type: 'content_block_delta',
    delta: { type: 'thinking_delta', thinking: 'I need...' }
} }
```

### 1.4 权限请求特殊处理

#### AskUserQuestion — Kill-and-Resume

Claude CLI 在 stream-json input 模式下，发送 permission_request 后约 0.5s 会自动填入空答案。这意味着发送真正的 control_response 时 LLM 已经用空答案继续了。

**解决方案**: 收到 AskUserQuestion 时立即 kill 子进程（`awaitingUserInput = true`），用户回答后通过 `ai-ask-resume.ts` spawn `--resume` 重新加载历史 + 注入用户答案。

```
用户看到 AskUserQuestion 卡片
  → 主进程 kill CLI（阻止自动填空）
  → 用户点击选项
  → AiTab.handleAskResume()
    → AI_ASK_RESUME IPC
      → kill 旧进程
      → spawnClaude({ --resume claudeSessionId })
      → stdin 写入用户答案 user message
```

#### ExitPlanMode — 清空并执行

```
用户看到 Plan Ready 卡片
  → 点 "Clear & Execute"
  → AiTab.handlePlanClearExecute()
    → AI_PLAN_EXECUTE IPC
      → readFile(planFilePath)
      → kill 旧进程（不回复 control_request，避免 "plan rejected" 噪音）
      → spawnClaude({ permissionMode: 'acceptEdits' })  // 不传 --resume → 清空上下文
      → stdin 注入 plan 内容作为首条 user message
  → 点 "Send Feedback"
    → control_response deny + feedback → CLI 继续 plan 模式修改
```

---

## 2. 渲染进程 (src/renderer/src/components/AiTab.tsx)

### 2.1 状态管理

```typescript
// 按 sessionId 分片，不是全局单例
sessionStates: Record<string, AiSessionState>

AiSessionState {
  ready: boolean            // CLI 已就绪
  busy: boolean             // 当前正在处理
  messages: AiMessage[]     // 已完成的消息列表
  streaming: boolean        // 是否正在流式传输
  streamBuffer: string      // 流式文本缓冲（逐 token 累积）
  thinkingBuffer: string    // 流式 thinking 缓冲
  pendingPermission: ...    // 当前待处理的权限卡片
  slashCommands: ...        // 自动补全命令列表
  model: string             // 当前模型名
  contextPercent: number    // 上下文使用百分比
  name: string              // 会话名（取自首条用户消息）
}
```

### 2.2 IPC 消息处理

渲染进程通过 preload 暴露的 `window.api.ai.*` 监听 5 种 push 事件：

| IPC 通道 | 处理函数 | 作用 |
|---|---|---|
| `AI_MESSAGE` | `handleMsg` (line 807) | 接收完整消息（用户/助手/结果/工具结果） |
| `AI_STREAM_TOKEN` | `handleToken` (line 894) | 接收逐 token 增量 |
| `AI_PERMISSION` | `handlePerm` (line 930) | 接收权限请求 → 设置 pendingPermission |
| `AI_READY` | `handleReady` (line 940) | CLI 就绪 → 加载 slash_commands、model |
| `AI_ERROR` | `handleErr` (line 949) | 错误 → 合并到最后 pending tool |

### 2.3 Token 合并机制 (RAF coalescing)

```
┌─────────────────────────────────────────────────────────┐
│ onStreamToken 到达                                       │
│   → pendingTokensRef.set(sid, {text: 累积text})          │
│   → requestAnimationFrame(() => {                        │
│       updateSession(sid, s => ({                         │
│         streamBuffer: s.streamBuffer + batched.text,     │
│         thinkingBuffer: s.thinkingBuffer + batched.thk,  │
│         streaming: true,                                 │
│       }))                                                │
│     })                                                   │
│                                                          │
│ 设计原因: token 频率可达 50+/s，每次 setState 会阻塞主线程│
│ 影响权限卡片渲染。RAF 合并确保每 16ms 最多渲染一次。       │
└─────────────────────────────────────────────────────────┘
```

### 2.4 消息合并逻辑 (onMessage → updateSession)

这是整个流式渲染最核心也最容易出错的部分。

#### 输入

`onMessage` 收到一条 `msg` (可能是 assistant / user / result)：

```typescript
updateSession(msg.sessionId, (s) => {
  // ── 步骤 1: 消费尚未刷新到 state 的 RAF token ──
  // 防止比较时看到 stale buffer 值
  const pendingTokens = pendingTokensRef.current.get(msg.sessionId)
  if (pendingTokens) {
    pendingTokensRef.current.delete(msg.sessionId)
    s = { ...s,
      streamBuffer: pendingTokens.text ? s.streamBuffer + pendingTokens.text : s.streamBuffer,
      thinkingBuffer: pendingTokens.thinking ? s.thinkingBuffer + pendingTokens.thinking : s.thinkingBuffer,
    }
  }

  // ── 步骤 2: 判断消息类型 ──
  const isAssistant = msg.type === 'assistant' && msg.role === 'assistant'
  const lastMsg = s.messages[s.messages.length - 1]
  const isSameMessageId = isAssistant && msg.messageId === lastMsg?.messageId

  // ── 步骤 3: 计算 "buffer 中有但消息中没有" 的额外内容 ──
  // 使用 includes 判断：buffer 是消息的子串 → 不 flush（buffer 只是预览）
  const extraThinking = s.thinkingBuffer && (!msg.thinking || !msg.thinking.includes(s.thinkingBuffer))
    ? s.thinkingBuffer : ''
  const extraText = s.streamBuffer && (!msg.content || !msg.content.includes(s.streamBuffer))
    ? s.streamBuffer : ''

  // 创建 flushedMsg — 用于捕获 buffer 中有但消息遗漏的内容
  const flushedMsg = (hasExtra && s.streaming && (isAssistant || msg.type === 'result'))
    ? [{ content: extraText, thinking: extraThinking }] : []

  // ── 步骤 4: 合并或追加 ──
  if (isSameMessageId && lastMsg) {
    // 同一消息 ID：合并到同一条 AiMessage
    // --include-partial-messages 每次发累积内容 → 新内容以旧内容开头时替换
    const mergeContent = (old, new) => {
      if (!new) return old; if (!old) return new
      return new.startsWith(old) ? new : old + new
    }
    merged = { ...lastMsg,
      content: mergeContent(lastMsg.content, msg.content),
      thinking: mergeThinking(lastMsg.thinking, msg.thinking),
      toolUse: [...(lastMsg.toolUse || []), ...(msg.toolUse || [])],  // 工具始终追加
    }
    messages = [...s.messages.slice(0, -1), merged, ...flushedMsg]
  } else if (msg.toolResult) {
    // tool_result：合并到对应 tool_use 的 result 字段
    messages = mergeToolResultIntoMessages(s.messages, ...)
  } else {
    // 普通新消息：直接追加
    messages = [...s.messages, ...flushedMsg, msg]
  }

  // ── 步骤 5: 清理 buffer ──
  streamBuffer: msg 有 content → 清空; 否则保留
  thinkingBuffer: msg 有 thinking → 清空; 否则保留
  streaming: result 消息 → false; 否则保持
})
```

#### 合并逻辑中的三个关键修复

1. **RAF token 预消费** — 在比较 buffer 前先消费 `pendingTokensRef`，防止看到 stale 值
2. **`includes` 判断代替 `!==`** — buffer 是消息内容的子串时不创建 flushedMsg（buffer 只是流式预览，消息已覆盖）
3. **`startsWith` 替换代替 `join('')` 拼接** — `--include-partial-messages` 的累积内容直接替换而不是拼接；`toolUse` 数组始终追加（每个 tool_use block 是独立的工具调用）

---

## 3. 流式渲染的双重渲染问题

### 3.1 根源

双重渲染来自两个独立的竞态路径：

#### 路径 A: RAF token 与 message 间的竞态

```
时间线:
  1. token "Hello" 到达 → pendingTokensRef = {text: "Hello"} → RAF 调度
  2. RAF 触发 → streamBuffer = "Hello"
  3. token " world" 到达 → pendingTokensRef = {text: " world"} → RAF 调度（未触发）
  4. assistant message 到达 {content: "Hello world"}
  5. updateSession 读取 s.streamBuffer = "Hello"  ← STALE!
  6. extraText = "Hello" !== "Hello world" → true → flushedMsg("Hello") ← 错误!
  7. messages = [..., flushedMsg("Hello"), msg("Hello world")]  ← 双渲染!
  8. streamBuffer 被清空 → 但 RAF 还没触发
  9. RAF 触发 → streamBuffer = "" + " world" = " world" ← 残留!
```

**修复**: 步骤 5 之前先消费 `pendingTokensRef`，把待处理的 token 合并到 `s.streamBuffer`，再做比较。

#### 路径 B: `--include-partial-messages` 累积内容拼接

```
时间线:
  1. CLI 发送第 1 条 partial: {content: "Hello world.", messageId: "msg_1"}
     → 第一个 assistant message → 直接追加到 messages
  2. CLI 发送第 2 条 partial: {content: "Hello world. More text.", messageId: "msg_1"}
     → isSameMessageId = true → 合并
     → 旧逻辑: content = "Hello world." + "Hello world. More text."
       = "Hello world.Hello world. More text."  ← 前半截重复!
```

**修复**: 检测新内容是否以旧内容开头（`startsWith`），是则替换整个 content，否则才拼接。

#### 路径 C: thinking buffer 被 flush 出独立消息

```
时间线:
  1. thinking token "I need to" → buffer = "I need to"
  2. 第 1 条 partial: {thinking: "I need to", messageId: "msg_1"}
     → 消息追加，thinkingBuffer 清空
  3. thinking token " analyze" → buffer = " analyze"  
  4. 第 2 条 partial: {thinking: "I need to analyze", messageId: "msg_1"}
     → extraThinking = " analyze" !== "I need to analyze" → true → flushedMsg!
     → merged.thinking = "I need to" + "\n\n" + "I need to analyze" (旧拼接逻辑)
     → messages = [merged(含重复thinking), flushedMsg(" analyze")]
     → 三个 thinking 块!
```

**修复**: 路径 B 的 `startsWith` + 路径 A 的 `pendingTokens` 预消费 + `includes` 判断（buffer 是消息子串时不 flush）。

### 3.2 为什么 resume 后正常

Resume 时消息从 `.jsonl` 文件加载（`loadSessionMessages`），所有消息一次性生成，没有 `stream_event` token 流。没有 RAF 竞态，没有 `--include-partial-messages` 的累积消息。`streaming = false`，buffer 始终为空。

---

## 4. 消息渲染层次

### 4.1 消息类型分发

```
AiMessageBubble (line 466)
  ├── error           → AiErrorMessage      (红色错误卡片 + 安装命令)
  ├── role='user'     → AiUserMessage       (右对齐聊天气泡)
  ├── type='result'
  │   └── 无 meta 且无 subtype → return null  (抑制重复空 result)
  └── 其他             → AiAssistantMessage
```

### 4.2 AiAssistantMessage 渲染

```
AiAssistantMessage (line 396)
  ├── 状态标签 (isAborted / error_max_tokens / error_during_execution)
  ├── thinking       → ThinkingBlock        (可折叠 "Thinking" 按钮)
  ├── content        → ChatMarkdown          (ReactMarkdown + 代码高亮)
  ├── toolUse[]      → AiToolCallCard[]     (可展开工具调用卡片)
  └── 元信息         → "N turns · $X.XX · Ys"
```

### 4.3 流式缓冲渲染（独立于消息列表）

```
state.streaming && (streamBuffer || thinkingBuffer)
  ├── thinkingBuffer → ThinkingBlock (defaultOpen, 自动展开)
  └── streamBuffer   → StreamingMarkdown + 闪烁光标
```

`StreamingMarkdown` 与 `ChatMarkdown` 的区别：
- 检测未闭合的 code fence (``` 奇数配对)
- 未闭合的代码块渲染为 `<pre>` 原始文本（避免中途 remount 和重新高亮）
- 闭合部分正常走 ReactMarkdown

### 4.4 子 Agent 分组

```
message.parentToolUseId 存在时
  → 左边框 (border-l-3 border-ide-accent/40)
  → "AGENT" 标签
  → 内容缩进
```

---

## 5. 渲染进程 ↔ 主进程 IPC 全览

### invoke (渲染进程 → 主进程)

| 方法 | IPC 通道 | 说明 |
|---|---|---|
| `create(opts)` | `AI_CREATE` | 创建 AI 会话，spawn 子进程 |
| `send(sid, msg)` | `AI_SEND` | 发送用户消息（stdin NDJSON） |
| `cancel(sid)` | `AI_CANCEL` | 取消当前操作（SIGINT / taskkill） |
| `destroy(sid)` | `AI_DESTROY` | 销毁会话（taskkill + 清理 Map） |
| `respondPermission(...)` | `AI_PERMISSION_RESPONSE` | 回复权限请求（stdin control_response） |
| `clearAndExecutePlan(sid, path)` | `AI_PLAN_EXECUTE` | ExitPlanMode 清空执行 |
| `askResume(sid, answers)` | `AI_ASK_RESUME` | AskUserQuestion kill-and-resume |
| `setPermissionMode(sid, mode)` | `AI_SET_PERMISSION_MODE` | 运行时切换权限模式 |
| `checkAvailable()` | `AI_CHECK_AVAILABLE` | 检查 CLI 是否安装 |
| `listSessions(cwd)` | `AI_LIST_SESSIONS` | 列出可 resume 的历史会话 |
| `loadSessionMessages(sid, cwd)` | `AI_LOAD_SESSION_MESSAGES` | 加载 .jsonl 消息历史 |

### push (主进程 → 渲染进程)

| 事件 | IPC 通道 | 触发时机 |
|---|---|---|
| 消息 | `AI_MESSAGE` | assistant / user / result NDJSON |
| Token | `AI_STREAM_TOKEN` | stream_event text_delta / thinking_delta |
| 权限 | `AI_PERMISSION` | control_request (工具审批/AskUserQuestion/ExitPlanMode) |
| 就绪 | `AI_READY` | system/init NDJSON 收到 |
| 错误 | `AI_ERROR` | 进程异常退出或 spawn 失败 |
| 文件变更 | `AI_FILE_CHANGE` | file edit 工具调用 |
| 进度 | `AI_PROGRESS` | tool_progress NDJSON |

---

## 6. 会话生命周期

```
┌─────────────────┐
│ Tab 切换/创建     │
│ activeSessionId  │
│ 变化              │
└────────┬────────┘
         ↓
  检查 createdSessionsRef
  (防重复创建)
         ↓
  checkAvailable()
         ↓
  ┌──────────────────┐
  │ AI_CREATE        │ → spawnClaude → attachAiProcess
  │ permissionMode,  │   → stdout 逐行 NDJSON 解析
  │ resumeSessionId? │   → IPC push 到渲染进程
  └──────────────────┘
         ↓
  ┌──────────────────┐  渲染进程 useEffect 注册
  │ onMessage        │  5 个 IPC listener
  │ onStreamToken    │
  │ onPermission     │
  │ onReady          │
  │ onError          │
  └──────────────────┘
         ↓
  … 用户交互循环 …
  (发送消息 / 审批权限 / 切换模式)
         ↓
  ┌──────────────────┐
  │ 会话销毁          │
  │ destroy(sid)     │ → taskkill + aiSessions.delete
  │ 或 Tab 关闭       │   + setSessionStates 清理
  └──────────────────┘
```

---

## 7. 关键文件索引

| 文件 | 职责 |
|---|---|
| `src/main/ai.ts` | 主进程：子进程管理、NDJSON 解析、IPC handler 注册 |
| `src/main/ai-ask-resume.ts` | AskUserQuestion kill-and-resume 流程 |
| `src/main/ai-plan-execute.ts` | ExitPlanMode 清空并执行流程 |
| `src/renderer/src/components/AiTab.tsx` | 渲染进程：状态管理、消息合并、UI 渲染 |
| `src/preload/index.ts` (205-290) | contextBridge 桥接层：IPC invoke/on 封装 |
| `src/shared/types.ts` (291-428) | 共享类型：AiMessage, AiSessionState, 各种 Payload |


