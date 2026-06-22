# Claude CLI 接口架构与内部通讯软件设计方案

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────┐
│                  渲染进程 (Renderer)                  │
│  ┌──────────────────────────────────────────────┐   │
│  │  AiTab.tsx (GUI Chat Interface)              │   │
│  │  - sessionStates (AiSessionState 记录)        │   │
│  │  - rAF throttle 流式 token 合并               │   │
│  │  - ReactMarkdown + StreamingMarkdown 渲染     │   │
│  │  - 权限卡片 / Todo 面板 / 斜杠命令补全         │   │
│  └──────────────┬───────────────────────────────┘   │
│  ┌──────────────▼───────────────────────────────┐   │
│  │  preload/index.ts (contextBridge)            │   │
│  │  window.api.ai.* (25 个方法/事件)             │   │
│  └──────────────┬───────────────────────────────┘   │
└─────────────────┼───────────────────────────────────┘
                  │ IPC (ipcRenderer.invoke / ipcRenderer.on)
┌─────────────────▼───────────────────────────────────┐
│                  主进程 (Main)                        │
│  ┌──────────────────────────────────────────────┐   │
│  │  main/ai.ts (核心子进程管理器)                  │   │
│  │  - findBinary() CLI 二进制发现                │   │
│  │  - buildClaudeArgs() 参数构建                 │   │
│  │  - spawnClaude() 子进程生成                   │   │
│  │  - handleNdjsonMessage() NDJSON 解析分流      │   │
│  │  - attachAiProcess() 进程生命周期管理          │   │
│  ├──────────────────────────────────────────────┤   │
│  │  main/ai-revert.ts     (JSONL 截断 + revert) │   │
│  │  main/ai-ask-resume.ts (AskUserQuestion 恢复) │   │
│  │  main/ai-plan-execute.ts (Plan 模式执行)      │   │
│  └──────────────┬───────────────────────────────┘   │
└─────────────────┼───────────────────────────────────┘
                  │ stdio (NDJSON 双向流)
┌─────────────────▼───────────────────────────────────┐
│                Claude CLI 子进程                      │
│  claude -p --output-format stream-json              │
│        --input-format stream-json                   │
│        --permission-prompt-tool stdio               │
│        --include-partial-messages                   │
│  stdin → NDJSON 控制请求 (user message / control)    │
│  stdout → NDJSON 事件流 (assistant / stream / perm)  │
└─────────────────────────────────────────────────────┘
```

---

## 二、IPC 接口层（renderer ↔ main）

### 2.1 请求接口（renderer → main, invoke）

| IPC Channel | 方向 | 触发 | 参数 | 返回值 |
|---|---|---|---|---|
| `ai:checkAvailable` | 渲染→主 | 启动检查 | `cliCommand?` | `{available, binary}` 或 `{available, error, installCmd}` |
| `ai:create` | 渲染→主 | 新建会话 | `AiCreateOptions` | `{success}` 或 `{success, error, installCmd}` |
| `ai:send` | 渲染→主 | 发送消息 | `AiSendPayload` | `{success}` 或 `{success, error}` |
| `ai:cancel` | 渲染→主 | 中断操作 | `sessionId: string` | `boolean` |
| `ai:destroy` | 渲染→主 | 销毁会话 | `sessionId: string` | `boolean` |
| `ai:listSessions` | 渲染→主 | 会话历史 | `cwd?: string` | `{sessions: [...]}` |
| `ai:loadSessionMessages` | 渲染→主 | 加载历史 | `resumeSessionId, cwd` | `{messages, model, slashCommands}` |
| `ai:permissionResponse` | 渲染→主 | 权限响应 | `AiPermissionResponsePayload` | `{success}` 或 `{success, error}` |
| `ai:planExecute` | 渲染→主 | 执行计划 | `AiPlanExecutePayload` | `{success}` |
| `ai:setPermissionMode` | 渲染→主 | 切换模式 | `AiSetPermissionModePayload` | `{success}` 或 `{success, error}` |
| `ai:setModel` | 渲染→主 | 切换模型 | `AiSetModelPayload` | `{success}` 或 `{success, error}` |
| `ai:askResume` | 渲染→主 | 恢复问答 | `AiAskResumePayload` | `{success}` |
| `ai:revert` | 渲染→主 | 撤销对话 | `AiRevertPayload` | `{success}` |
| `ai:fork` | 渲染→主 | 分支对话 | `AiForkPayload` | `{success}` |

### 2.2 推送事件（main → renderer, on）

| IPC Channel | 方向 | 触发时机 | 数据 |
|---|---|---|---|
| `ai:ready` | 主→渲染 | CLI 子进程初始化完成 | `{sessionId, tools?, model?, slashCommands?}` |
| `ai:message` | 主→渲染 | 完整消息 | `AiMessage` |
| `ai:streamToken` | 主→渲染 | 流式 token | `{sessionId, token, kind?}` |
| `ai:permission` | 主→渲染 | 权限请求 | `AiPermissionRequest` |
| `ai:progress` | 主→渲染 | 工具执行进度 | `{sessionId, toolUseId, tool, elapsed}` |
| `ai:fileChange` | 主→渲染 | 文件编辑检测 | `AiFileChange` |
| `ai:error` | 主→渲染 | 进程错误/崩溃 | `{sessionId, error, installCmd?}` |

---

## 三、核心类型定义（shared/types.ts）

### 3.1 消息类型

```typescript
type AiMessageType = 'system' | 'assistant' | 'user' | 'result'
                     | 'stream_event' | 'permission_request' | 'tool_progress'

interface AiMessage {
  sessionId: string
  type: AiMessageType
  role?: 'assistant' | 'user'
  messageId?: string          // 用于多块合并去重
  content?: string            // Markdown 文本
  thinking?: string           // 思考过程
  thinkingDurationMs?: number
  model?: string
  toolUse?: AiToolUse[]       // 工具调用
  toolResult?: AiToolResult   // 工具结果
  error?: string
  installCmd?: string
  costUsd?: number
  numTurns?: number
  durationMs?: number
  contextPercent?: number | null
  subtype?: 'success' | 'error_max_tokens' | 'error_during_execution'
  isAborted?: boolean
  parentToolUseId?: string
  timestamp: number
}

interface AiToolUse {
  id: string
  name: string
  input: Record<string, any>
  result?: AiToolResult
}

interface AiToolResult {
  toolUseId: string
  content: string
  isError: boolean
}
```

### 3.2 会话与权限

```typescript
interface AiSessionState {
  ready: boolean
  busy: boolean
  messages: AiMessage[]
  streaming: boolean
  streamBuffer: string
  thinkingBuffer: string
  thinkingStartedAt: number | null
  pendingPermission: AiPermissionRequest | null
  slashCommands: AiSlashCommand[]
  model: string
  contextPercent: number | null
  name: string
}

interface AiPermissionRequest {
  sessionId: string
  requestId: string
  tool: string
  description: string
  command?: string
  toolInput?: Record<string, any>
}

type AiPermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions'

interface AiCreateOptions {
  sessionId: string
  cwd: string
  autoApprove: boolean
  permissionMode: AiPermissionMode
  resumeSessionId?: string
  cliCommand?: string
}
```

---

## 四、CLI 子进程协议（main/ai.ts）

### 4.1 子进程启动参数

```bash
claude -p
  --output-format stream-json      # stdout 输出 NDJSON 流
  --input-format stream-json       # stdin 接受 NDJSON
  --permission-prompt-tool stdio   # 权限请求走 stdin/stdout
  --verbose                        # 详细日志
  --include-partial-messages       # 增量助手消息
  --permission-mode <mode>         # plan | acceptEdits | bypassPermissions
  --append-system-prompt <text>    # 附加系统提示（含平台描述 + 工作目录）
  --resume <sessionId>             # 恢复历史会话（可选）
```

### 4.2 stdin NDJSON 发送格式

**用户消息：**
```json
{"type":"user","message":{"role":"user","content":"用户的输入文本"}}
```

**权限响应（允许/拒绝）：**
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "xxx",
    "response": {
      "behavior": "allow",
      "updatedInput": {},
      "toolUseID": "xxx"
    }
  }
}
```

**运行时切换模式：**
```json
{
  "type": "control_request",
  "request_id": "set-mode-xxx",
  "request": {"subtype": "set_permission_mode", "mode": "acceptEdits"}
}
```

**运行时切换模型：**
```json
{
  "type": "control_request",
  "request_id": "set-model-xxx",
  "request": {"subtype": "set_model", "model": "sonnet"}
}
```

**中断操作：**
```json
{
  "type": "control_request",
  "request_id": "xxx",
  "request": {"subtype": "interrupt"}
}
```

### 4.3 stdout NDJSON 事件流解析

| NDJSON type | 处理 | 推送事件 |
|---|---|---|
| `system`(subtype=init) | 缓存在线模型、斜杠命令 | `AI_READY` |
| `assistant` | 解析 content blocks（text/thinking/tool_use） | `AI_MESSAGE` |
| `stream_event`→`content_block_delta`| 提取 text_delta / thinking_delta | `AI_STREAM_TOKEN` |
| `control_request` | 权限询问 | `AI_PERMISSION` |
| `tool_progress` | 工具执行进度 | `AI_PROGRESS` |
| `result` | 执行结果（含成本、耗时） | `AI_MESSAGE` |
| `user`(tool_result) | 工具返回结果 | `AI_MESSAGE` |
| `content_block_start/stop/message_delta/keep_alive` | 忽略 | — |

### 4.4 进程生命周期

```
AI_CREATE → findBinary() → spawnClaude() → attachAiProcess()
                            ↓
                    ┌─── AI_READY (初始化完成)
                    │
          ┌──── AI_SEND → stdin.write(NDJSON)
          │         ↓
          │    stdout → handleNdjsonMessage() → 按 type 分流
          │         ↓
          │    AI_MESSAGE / AI_STREAM_TOKEN / AI_PERMISSION / AI_PROGRESS
          │
          ├──── AI_CANCEL → stdin.write(interrupt)
          ├──── AI_DESTROY → taskkill /f /t (Windows) / SIGTERM (Unix)
          └──── AI_REVERT → JSONL 截断 → kill → spawn --resume
```

---

## 五、渲染层数据流（AiTab.tsx）

### 5.1 流式 Token 管线

```
AI_STREAM_TOKEN (高频)
    ↓
pendingTokensRef Map (rAF throttle, 每 200ms 刷新)
    ↓
streamBuffer / thinkingBuffer (React state)
    ↓
StreamingMarkdown 组件
    ├── 已闭合代码栅栏前 → ReactMarkdown 渲染
    └── 未闭合代码栅栏 → 裸文本显示
```

### 5.2 Markdown 渲染栈

```
AiMessage.content (Markdown 文本)
    ↓
ChatMarkdown / StreamingMarkdown
    ↓
react-markdown + remark-gfm
    ↓
MarkdownCodeBlock (Monaco 语法高亮)
    ├── mermaid 图表 → 全屏缩放模态框
    └── 普通代码块 → monaco.editor.colorize()
```

### 5.3 会话状态管理

```typescript
// App.tsx 维护
const [sessionStates, setSessionStates] = useState<Record<string, AiSessionState>>({})

// AiTab.tsx 使用
const sessionState = sessionStates[activeSessionId]
```

---

## 六、内部通讯软件设计方案

### 6.1 目标

在内部通讯软件中实现类似 AiTab 的 AI 对话功能，使用给定的 CLI 接口：

```bash
link get --number <N>   # 接收 N 条信息
link send --user <user>  # 发送信息给用户，支持 picture 和 text
```

### 6.2 系统架构

```
┌──────────────────────────────────────────────┐
│             内部通讯 Bot 进程                   │
│                                               │
│  ┌───────────────────┐  ┌──────────────────┐  │
│  │ 消息接收轮询器      │  │ 消息发送器        │  │
│  │ link get --number  │  │ link send --user │  │
│  │ (setInterval 轮询) │  │ (即时发送)        │  │
│  └────────┬──────────┘  └────────┬─────────┘  │
│           │                      │            │
│  ┌────────▼──────────────────────▼─────────┐  │
│  │          消息队列 & 会话管理器           │  │
│  │  - 多会话支持 (按 user/group 隔离)       │  │
│  │  - 消息去重 (messageId dedup)           │  │
│  │  - 会话状态持久化 (JSONL)                │  │
│  └────────────────┬───────────────────────┘  │
│                   │                          │
│  ┌────────────────▼───────────────────────┐  │
│  │          AI 子进程管理器                │  │
│  │  spawn claude --stream-json ...        │  │
│  │  NDJSON 解析 ←→ agent 子进程 stdin/stdout│  │
│  └────────────────┬───────────────────────┘  │
└───────────────────┼──────────────────────────┘
                    │
          ┌─────────▼─────────┐
          │  Claude CLI 子进程  │
          └───────────────────┘
```

### 6.3 消息协议映射

| 内部通讯操作 | AI Tab 对应 | 说明 |
|---|---|---|
| `link send --user <me>` | — | 用户发送消息给 bot（text / picture） |
| `link get --number 1` | `ai:send` | 轮询获取新消息 |
| Bot 响应 text | `ai:message` (content=Markdown) | 通过 `link send --user <me>` 发回 |
| Bot 响应 picture | `ai:message` (含图片URL) | 渲染图片 + 通过 `link send` 带图片路径发送 |
| 图片消息处理 | AiTab 图片粘贴/拖拽 | 接收图片 → 保存到本地 → 传给 Claude 上下文 |
| 流式输出 | `ai:streamToken` | 按 token 分段发送 `link send`，客户端即时渲染 |
| 工具权限 | `ai:permission` | bot 直接 autoApprove，或转发给用户确认 |
| 会话历史 | `ai:listSessions` | 本地 JSONL 持久化，重启时可恢复 |

### 6.4 详细设计

#### 6.4.1 Bot 进程初始化流程

```
1. Bot 启动
2. link get --number 10  (拉取最近的 10 条消息)
3. 过滤新消息（按消息 ID 去重）
4. 识别 @bot 或特定频道消息
5. 触发 AI 处理流程
```

#### 6.4.2 AI 处理流程

```
收到用户输入（text 或 picture）
    ↓
spawn claude 子进程 (如尚不存在)
    ↓
发送 NDJSON 用户消息到 claude stdin
    ├── 文本消息: {"type":"user","message":{"role":"user","content":"text"}}
    └── 图片消息: {"type":"user","message":{"role":"user","content":"描述图片内容"}}
                   + 图片文件路径传给 --append-system-prompt
    ↓
claude stdout NDJSON 事件流
    ├── stream_event → 分段 token → link send 逐段推送（实现流式打字效果）
    ├── assistant   → 完整消息 → link send 发送最终 Markdown
    ├── tool_progress → link send 发送进度通知
    ├── permission_request → autoApprove 或转发给用户
    └── result → 记录成本/耗时
```

#### 6.4.3 图片消息处理

```typescript
interface IncomingMessage {
  type: 'text' | 'picture'
  text?: string
  picturePath?: string   // 图片路径（收到的图片先保存到本地）
  userId: string
  messageId: string
  timestamp: number
}

// 图片消息处理策略：
// 方案 A：Claude 原生支持多模态 → 直接传入图片路径
// 方案 B：图片 OCR → 提取文字 → 作为文本上下文传给 Claude
//
// 推荐：先尝试方案 A（claude 3.5+ 原生支持图片），回退到方案 B
```

#### 6.4.4 流式推送实现

```typescript
// 逐 token 发送，客户端即时渲染
async function streamResponse(sessionId: string, userId: string) {
  let buffer = ''
  const flushInterval = 200  // ms

  setInterval(() => {
    if (buffer) {
      linkSend(userId, { type: 'text', content: buffer, streaming: true })
      buffer = ''
    }
  }, flushInterval)

  claude.onStreamToken(({ sessionId, token }) => {
    buffer += token
    // 客户端渲染: 持续更新 streaming-content 区域
  })

  claude.onMessage((msg) => {
    if (msg.type === 'assistant' && msg.content) {
      linkSend(userId, { type: 'text', content: msg.content, streaming: false })
      // 客户端渲染: 替换 streaming-content 为 final Markdown
    }
  })
}
```

### 6.5 客户端渲染（通讯软件 UI 侧）

#### 6.5.1 Markdown 渲染

```
收到 link get 的缓存
    ↓
解析消息类型
    ├── streaming: true  → 持续追加到流式缓冲区
    ├── streaming: false → 替换缓冲区为最终 Markdown
    └── type: picture    → 渲染图片
    ↓
ReactMarkdown / marked.js 渲染
    ├── 代码块语法高亮
    ├── 表格支持
    ├── 图片内联
    └── 链接可点击
```

#### 6.5.2 UI 布局

```
┌────────────────────────────────┐
│  通讯软件 AI 对话面板           │
│                                │
│  ┌─ 历史消息 ───────────────┐  │
│  │  User: 帮我写一个排序算法   │  │
│  │  Bot:  以下是快速排序...   │  │
│  │  │ def quick_sort(arr):  │  │
│  │  │     ...               │  │
│  │  └───────────────────────┤  │
│  │                         │  │
│  │  User: [图片] 这段代码    │  │
│  │  │ 有什么问题？          │  │
│  │  Bot: 这里有一个bug...    │  │
│  │  │ (流式输出中...)        │  │
│  ├──────────────────────────┤  │
│  │  输入框 [发送] [图片]     │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

### 6.6 会话管理

```typescript
// 按 用户/群组 隔离会话
interface BotSession {
  userId: string            // 或 groupId
  claudeSessionId: string   // Claude 子进程 ID
  messages: AiMessage[]
  createdAt: number
  lastActive: number
  cwd: string               // 当前工作目录
}

// 持久化到 local 或 JSONL
// 重启后可通过 --resume 恢复
```

### 6.7 关键差异与挑战

| 对比项 | Vibe IDE AiTab | 内部通讯软件 |
|---|---|---|
| 接口方式 | Electron IPC | CLI 命令 (link get/send) |
| 消息推送 | IPC push (即时) | 轮询 pull (link get) |
| 流式输出 | IPC streamToken 高频推送 | 分段 link send + 客户端累积 |
| 图片输入 | drag-drop 图片文件 | 链路传图片 base64 或 文件路径 |
| 权限交互 | 模态框 UI | autoApprove 或卡片消息 |
| 会话持久化 | JSONL 文件 | JSONL 文件（相同） |
| Markdown 渲染 | react-markdown + Monaco | marked.js / ReactMarkdown |

### 6.8 实现建议

1. **消息轮询**：`setInterval(() => link get --number 5, 1000)`，去重后处理新消息
2. **流式渲染**：接收 `streaming: true` 的消息持续 append 到临时 div；收到 `streaming: false` 时替换为最终渲染结果
3. **图片处理**：接收图片 → 保存到本地临时目录 → OCR 或直接传给 Claude
4. **权限策略**：默认 autoApprove 模式+ `--permission-mode bypassPermissions`，避免交互卡住
5. **错误恢复**：claude 子进程崩溃后自动 spawn 恢复，通过 `--resume` 保持上下文
6. **消息队列**：buffer 待处理的 link send，避免并发发送顺序乱序

---

## 七、参考代码位置

| 功能 | 文件 |
|---|---|
| IPC 通道定义 | `src/shared/types.ts:1-127` |
| AI 类型定义 | `src/shared/types.ts:294-460` |
| Preload 桥接 | `src/preload/index.ts:204-297` |
| CLI 子进程管理 | `src/main/ai.ts` (927行) |
| 消息回退 | `src/main/ai-revert.ts` |
| AskUserQuestion 恢复 | `src/main/ai-ask-resume.ts` |
| Plan 模式执行 | `src/main/ai-plan-execute.ts` |
| GUI 聊天界面 | `src/renderer/src/components/AiTab.tsx` (2136行) |
| 流式 Markdown | `src/renderer/src/components/AiTab.tsx` 内 ChatMarkdown / StreamingMarkdown |
| 代码块高亮 | `src/renderer/src/components/MarkdownCodeBlock.tsx` |
| 辅助终端 AuxTab | `src/renderer/src/components/AuxTab.tsx` |

---

## 八、推荐实现路线图

```
Phase 1: 基础文本对话
  - Bot 进程框架 + link get/send 封装
  - claude 子进程 spawn + stdin/stdout NDJSON
  - 文本消息接收 → AI 处理 → Markdown 回复
  - 简单轮询消息机制

Phase 2: 流式体验
  - 分段 link send 实现打字机效果
  - 客户端 streaming Div + 最终替换

Phase 3: 图片支持
  - 图片消息接收 → 本地缓存 → 传给 Claude
  - Claude 回复中的 Markdown 图片渲染

Phase 4: 完善
  - 多会话隔离 (按群组/用户)
  - 会话持久化 + 恢复
  - 权限处理 (autoApprove / 确认卡片)
  - 错误恢复 + 稳定性
```
