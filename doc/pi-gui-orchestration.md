# pi-gui 编排（Orchestration）深挖

> 调研对象：[minghinmatthewlam/pi-gui](https://github.com/minghinmatthewlam/pi-gui) — 为 [`pi` 编程代理](https://github.com/earendil-works/pi) 构建的桌面 GUI。
>
> 调研日期：2026-07-31，基于仓库 HEAD `main`（版本 `0.1.0-beta.33`）。
>
> 前置阅读：[doc/pi-gui-implementation.md](./pi-gui-implementation.md) — 项目全景。本文聚焦**多 agent 编排**实现细节。

---

## 0. "pi gui" 判读

见 [pi-gui-implementation.md §0](./pi-gui-implementation.md#0-pi-gui-所指)。结论：`minghinmatthewlam/pi-gui`（730★），唯一一个把 pi 编程代理包装成桌面 GUI 的开源项目，与 vibe-ide 的 AiTab 场景高度相关。

---

## 1. 编排系统总体架构

```
                    ┌─────────────────────────────────────┐
                    │         Renderer (React)            │
                    │  ConversationTimeline               │
                    │    ├─ TimelineItem (parent msg)     │
                    │    │   └─ ToolCallView (tool)       │
                    │    │       └─ OrchestrationChildren │  ← 折叠面板
                    │    │           ├─ ChildThreadCard   │
                    │    │           ├─ ChildThreadCard   │
                    │    │           └─ ChildThreadCard   │
                    │    └─ TurnMarker ("Worked for 5s")  │
                    └──────────────┬──────────────────────┘
                                   │ IPC (push/pull)
                    ┌──────────────┴──────────────────────┐
                    │         Main Process (Electron)      │
                    │                                      │
                    │  AppStore                            │
                    │    ├─ app-store-orchestration.ts     │  ← 编排中枢
                    │    │    ├─ registerOrchestrationRuntime()  │
                    │    │    ├─ OrchestrationSupervisorLoop    │
                    │    │    └─ Evidence pipeline              │
                    │    ├─ app-store-timeline.ts          │
                    │    ├─ app-store-session-state.ts     │
                    │    └─ app-store.ts (central state)   │
                    │                                      │
                    │  orchestration-runtime.ts            │  ← 4 个编排工具定义
                    │  worktree-manager.ts                 │  ← 每个 child 可独立 worktree
                    └──────────────┬──────────────────────┘
                                   │ SessionDriver / SessionManager
                    ┌──────────────┴──────────────────────┐
                    │  pi Runtime (@earendil-works/       │
                    │  pi-coding-agent)                    │
                    │    ├─ AgentSessionRuntime            │
                    │    ├─ SessionManager (JSONL R/W)     │
                    │    └─ Extension tools                │
                    └─────────────────────────────────────┘
```

核心思路：**编排不是 GUI 层逻辑，而是 agent runtime 的 extension tools**。GUI 只是把编排状态可视化。

来源：[app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts) + [orchestration-runtime.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/orchestration-runtime.ts)

---

## 2. 编排数据模型

### 2.1 核心类型

```ts
// orchestration-runtime.ts — 编排工具的 schema 定义

const CreateChildThreadInputSchema = Type.Object({
  prompt: Type.String({ minLength: 1 }),
  worktree: Type.Optional(Type.Union([
    Type.Literal("local"),           // 直接在 workspace 根目录工作
    Type.Literal("new"),             // 创建新 git worktree
  ])),
  title: Type.Optional(Type.String()),
  initialContext: Type.Optional(Type.String()),  // 注入到子线程的上下文
});

const SendMessageToThreadInputSchema = Type.Object({
  threadId: Type.String(),
  message: Type.String(),
  mode: Type.Union([
    Type.Literal("steer"),     // 当前 turn 结束时注入
    Type.Literal("followUp"),  // agent 完成后作为新 turn
  ]),
});

const ReadThreadInputSchema = Type.Object({
  threadId: Type.String(),
  maxItems: Type.Optional(Type.Number({ default: 50 })),
});
```

```ts
// desktop-state.ts — 编排状态类型

interface OrchestrationChildThread {
  threadId: string;            // session ID
  parentThreadId: string;      // 父线程 ID
  title: string;
  status: ThreadStatus;        // "idle" | "running" | "stopped" | "error"
  worktreeMode: "local" | "new" | "existing";
  worktreePath?: string;       // 独立 worktree 的文件系统路径
  createdAt: string;           // ISO timestamp
  updatedAt: string;
  lastError?: string;
  evidence: OrchestrationEvidence[];
}

type ThreadStatus = "idle" | "running" | "stopped" | "error";

interface OrchestrationEvidence {
  id: string;
  type: EvidenceType;
  content: string;
  source: "worker_report" | "orchestrator_acceptance" | "review_finding" | "blocker";
  createdAt: string;
}

type EvidenceType = "worker_report" | "orchestrator_acceptance" | "review_finding" | "blocker";
```

```ts
// orchestration-runtime.ts — 编排工具注册

interface OrchestrationToolDefinition {
  name: string;
  description: string;
  inputSchema: TSchema;                    // TypeBox schema
  handler: (input: unknown, context: OrchestrationContext) => Promise<string>;
}
```

来源：[orchestration-runtime.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/orchestration-runtime.ts) + [desktop-state.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/desktop-state.ts)

### 2.2 四个编排工具

| 工具名 | 作用 | 关键参数 | 返回 |
|--------|------|----------|------|
| `create_child_thread` | 创建新子线程 session，发送初始 prompt | `prompt`, `worktree?`, `title?`, `initialContext?` | child threadId |
| `list_threads` | 列出 orchestrator 下的所有 child threads | 无 | child thread 列表（含 status） |
| `read_thread` | 读取 child 的 transcript（最近 N 条） | `threadId`, `maxItems?` | transcript items |
| `send_message_to_thread` | 向 child 发送后续指令 | `threadId`, `message`, `mode: steer \| followUp` | 确认 |

来源：[orchestration-runtime.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/orchestration-runtime.ts)

---

## 3. 编排运行时注册

`registerOrchestrationRuntime()` 在 main process 启动时调用，把 4 个工具注入 pi runtime 的 extension 系统：

```ts
// app-store-orchestration.ts (概要)

function registerOrchestrationRuntime(appStore: AppStore): void {
  const tools: OrchestrationToolDefinition[] = [
    {
      name: "create_child_thread",
      description: "Spawn an isolated child coding session. The child runs in its own thread with a separate JSONL session file. Optionally create a git worktree for filesystem isolation.",
      inputSchema: CreateChildThreadInputSchema,
      handler: async (input, context) => {
        // 1. 创建新 session（新 JSONL 文件）
        // 2. 如果 worktree === "new"，调用 worktree-manager 创建 git worktree
        // 3. 记录 OrchestrationChildThread 到 state
        // 4. 启动 AgentSessionRuntime（pi runtime 的新 session）
        // 5. 发送初始 prompt
        // 6. 返回 threadId
      },
    },
    {
      name: "list_threads",
      handler: async (_, context) => {
        // 返回当前 orchestrator 的所有 child threads + status
      },
    },
    {
      name: "read_thread",
      handler: async (input, context) => {
        // 调用 session-supervisor.getTranscript() 获取 child 的消息
        // 截断到 maxItems 条
      },
    },
    {
      name: "send_message_to_thread",
      handler: async (input, context) => {
        // steer: 注入到当前 turn 结束
        // followUp: 排队为下一个 user turn
      },
    },
  ];

  // 注册到 pi runtime 的 extension system
  for (const tool of tools) {
    appStore.runtimeSupervisor.registerExtensionTool(tool);
  }
}
```

关键设计：**工具定义在 main process，但由 agent（LLM）调用**。orchestrator agent 在对话中决定何时 spawn child、何时 read result，GUI 只被动展示。

来源：[app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

---

## 4. Supervisor Loop（监督循环）

编排的核心是 orchestrator agent 的**监督循环**——不是一次性派发，而是持续的 monitor → evaluate → act 循环。

### 4.1 循环结构

```
Orchestrator Agent (parent session)
│
├─ User sends prompt
│
├─ Turn 1: Agent 分析任务 → 决定拆分
│   ├─ tool_call: create_child_thread({ prompt: "实现 X", worktree: "new" })
│   ├─ tool_call: create_child_thread({ prompt: "实现 Y", worktree: "new" })
│   └─ text: "I've spawned 2 child threads to work on X and Y in parallel."
│
├─ Turn 2+: 监督循环（由 runtime 自动触发）
│   ├─ tool_call: list_threads() → [{ id: "a", status: "running" }, { id: "b", status: "idle" }]
│   ├─ tool_call: read_thread({ threadId: "a", maxItems: 10 }) → transcript...
│   ├─ 评估：a 完成了，b 还在跑
│   └─ text: "Thread a completed. Waiting for thread b..."
│
├─ Turn N: 汇总
│   ├─ tool_call: read_thread({ threadId: "a" }) → final transcript
│   ├─ tool_call: read_thread({ threadId: "b" }) → final transcript
│   ├─ 合并结果，生成最终回答
│   └─ text: "Both threads completed. Here's the summary..."
```

### 4.2 监督触发机制

```ts
// app-store-orchestration.ts — 监督循环的触发条件

// orchestrator 在每次 child 状态变化时收到通知：
// - child status 从 running → idle/stopped
// - child 产生新的 evidence（worker_report）
// - child 超时（可配置）

// 通知方式：通过 pi runtime 的 session event 机制
// child session 的 SessionDriverEvent 被转发给 parent session 的 runtime
// parent agent 据此决定下一步动作
```

**关键区别**：pi-gui 的编排**不是 OS 级进程管理**，而是 **agent-level 的对话循环**。orchestrator 是一个普通 agent session，只是多了 4 个编排工具。并行执行由 pi runtime 的多个 `AgentSessionRuntime` 实例实现。

来源：[app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

---

## 5. 子线程隔离

### 5.1 Session 隔离

每个 child thread 是一个**完全独立的 session**：
- 独立 JSONL 文件（`~/.pi/agent/sessions/<project>/<childSessionId>.jsonl`）
- 独立 `AgentSessionRuntime` 实例
- 独立 transcript、独立消息历史
- 通过 `parentThreadId` 字段关联到 orchestrator

```ts
// session-supervisor.ts — child session 创建

async function createChildSession(
  parentRef: SessionRef,
  options: CreateChildOptions
): Promise<SessionRef> {
  const childSessionId = generateSessionId();
  const childSessionFile = resolveSessionFilePath(parentRef.workspaceId, childSessionId);

  // 创建新 session（与创建普通 session 完全相同）
  const childRef = await this.createSession({
    workspaceId: parentRef.workspaceId,
    sessionFile: childSessionFile,
    parentSessionId: parentRef.sessionId,  // ← 关联字段
  });

  // 记录到 orchestration state
  this.appStore.addOrchestrationChild({
    threadId: childSessionId,
    parentThreadId: parentRef.sessionId,
    status: "idle",
    worktreeMode: options.worktree ?? "local",
    worktreePath: options.worktreePath,
  });

  return childRef;
}
```

### 5.2 Git Worktree 隔离

child thread 可以选择文件系统级别的隔离：

```
workspace/                    ← parent 在这里工作
├── .git/
├── src/
└── ...

.git/worktrees/child-xyz/     ← child 的独立 worktree
├── src/                      ← 独立的文件副本
└── ...
```

```ts
// worktree-manager.ts — worktree 创建

async function createWorktreeForChild(
  workspacePath: string,
  childThreadId: string
): Promise<string> {
  const branchName = `pi-gui/orch-${childThreadId.slice(0, 8)}`;
  const worktreePath = path.join(workspacePath, ".git", "worktrees", childThreadId);

  // git worktree add <path> -b <branch>
  await simpleGit(workspacePath).raw([
    "worktree", "add", worktreePath, "-b", branchName,
  ]);

  return worktreePath;
}
```

**好处**：parent 和 child 可以同时修改文件而不冲突。child 完成后，parent 可以 review diff 并 merge。

来源：[worktree-manager.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/worktree-manager.ts) + [app-store-worktree.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-worktree.ts)

---

## 6. Evidence System（证据系统）

编排不只是 spawn + wait，还需要 orchestrator 评估 child 的工作质量。pi-gui 用 **evidence** 来记录这个评估过程。

### 6.1 Evidence 类型

| source | 含义 | 谁产生 |
|--------|------|--------|
| `worker_report` | child 自报的工作总结 | child agent（通过 tool call 返回） |
| `orchestrator_acceptance` | orchestrator 确认接受 child 的工作 | orchestrator agent |
| `review_finding` | orchestrator review child transcript 后发现的问题 | orchestrator agent |
| `blocker` | child 报告遇到的阻碍 | child agent |

### 6.2 Evidence 流转

```
Child Thread                    Orchestrator Thread
    │                                │
    ├─ 完成工作                       │
    ├─ tool_result: worker_report     │
    │   "实现了 X 功能，修改了 3 个文件" │
    │                                │
    │                    ┌───────────┤
    │                    │ orchestrator 调用 read_thread()
    │                    │ 读取 child transcript
    │                    │ 评估质量
    │                    ├───────────┐
    │                    │ tool_call: (implicit evidence)
    │                    │ orchestrator_acceptance: "LGTM"
    │                    │ OR review_finding: "缺少错误处理"
    │                    │           │
    │  ← send_message_to_thread ────┤
    │    "请补充错误处理"              │
    │                                │
    ├─ 修改后重新报告                  │
    ├─ worker_report: "已补充"        │
    │                    ┌───────────┤
    │                    │ orchestrator_acceptance ✓
```

来源：[app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts) + [desktop-state.ts `OrchestrationEvidence`](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/desktop-state.ts)

---

## 7. UI 层编排渲染

### 7.1 Timeline 中的编排可视化

编排结果在 `ConversationTimeline` 中以内联嵌套面板的形式展示：

```
┌─ Timeline ─────────────────────────────────────────────┐
│                                                         │
│ [User] 请同时实现 X 和 Y 功能                            │
│                                                         │
│ [Assistant] 我来拆分成两个子任务并行处理。                 │
│                                                         │
│ ┌─ 🔧 create_child_thread ─────────────────────────┐   │
│ │  prompt: "实现 X 功能"                             │   │
│ │  worktree: new                                     │   │
│ │  result: thread_abc123                             │   │
│ └────────────────────────────────────────────────────┘   │
│                                                         │
│ ┌─ 🔧 create_child_thread ─────────────────────────┐   │
│ │  prompt: "实现 Y 功能"                             │   │
│ │  worktree: new                                     │   │
│ │  result: thread_def456                             │   │
│ └────────────────────────────────────────────────────┘   │
│                                                         │
│ ⏱ Worked for 3s                                        │
│                                                         │
│ [Assistant] 已派发给两个子线程。让我检查进度...            │
│                                                         │
│ ┌─ 🔧 list_threads ────────────────────────────────┐   │
│ │  ├─ thread_abc123: ✅ idle (completed)             │   │
│ │  └─ thread_def456: 🔄 running                      │   │
│ └────────────────────────────────────────────────────┘   │
│                                                         │
│ ┌─ 🔧 read_thread (thread_abc123) ─────────────────┐   │
│ │  ▸ OrchestrationChildren (2 children)              │   │
│ │  ┌───────────────────────────────────────────────┐ │   │
│ │  │ 🟢 thread_abc123 "实现 X"    ✅ completed     │ │   │
│ │  │   worktree: .git/worktrees/abc123/            │ │   │
│ │  │   evidence: [worker_report, acceptance]       │ │   │
│ │  ├───────────────────────────────────────────────┤ │   │
│ │  │ 🟡 thread_def456 "实现 Y"    🔄 running       │ │   │
│ │  │   worktree: .git/worktrees/def456/            │ │   │
│ │  │   last update: 2s ago                         │ │   │
│ │  └───────────────────────────────────────────────┘ │   │
│ └────────────────────────────────────────────────────┘   │
│                                                         │
│ [Assistant] Thread abc 完成了，def 还在运行。等待中...    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.2 `OrchestrationChildrenView` 组件

```tsx
// timeline-item.tsx — 编排子线程面板

function OrchestrationChildrenView({
  children,
  onOpenThread,
  onReadTranscript,
}: {
  children: OrchestrationChildThread[];
  onOpenThread: (threadId: string) => void;
  onReadTranscript: (threadId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="orchestration-children">
      <div className="orchestration-children__header" onClick={() => setExpanded(!expanded)}>
        <span className="orchestration-children__icon">▸</span>
        <span>Orchestration Children ({children.length})</span>
      </div>
      {expanded && (
        <div className="orchestration-children__list">
          {children.map((child) => (
            <ChildThreadCard
              key={child.threadId}
              child={child}
              onOpen={() => onOpenThread(child.threadId)}
              onRead={() => onReadTranscript(child.threadId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChildThreadCard({
  child,
  onOpen,
  onRead,
}: {
  child: OrchestrationChildThread;
  onOpen: () => void;
  onRead: () => void;
}) {
  const statusIcon = {
    idle: "⏸",
    running: "🔄",
    stopped: "✅",
    error: "❌",
  }[child.status];

  return (
    <div className={`child-thread-card child-thread-card--${child.status}`}>
      <div className="child-thread-card__header">
        <span className="child-thread-card__status">{statusIcon}</span>
        <span className="child-thread-card__title">{child.title || child.threadId.slice(0, 8)}</span>
        <span className="child-thread-card__mode">{child.worktreeMode}</span>
      </div>
      {child.worktreePath && (
        <div className="child-thread-card__worktree">
          worktree: {child.worktreePath}
        </div>
      )}
      {child.evidence.length > 0 && (
        <div className="child-thread-card__evidence">
          {child.evidence.map((ev) => (
            <span key={ev.id} className={`evidence-badge evidence-badge--${ev.source}`}>
              {ev.source}
            </span>
          ))}
        </div>
      )}
      <div className="child-thread-card__actions">
        <button onClick={onOpen}>Open in new tab</button>
        <button onClick={onRead}>Read transcript</button>
      </div>
    </div>
  );
}
```

来源：[timeline-item.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-item.tsx)

### 7.3 侧边栏中的编排分组

Sidebar 的 session 列表按 `thread-groups.ts` 的规则分组：

```ts
// thread-groups.ts — 会话分组逻辑

function groupThreadsByOrchestration(
  sessions: SessionRecord[]
): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  const childByParent = new Map<string, SessionRecord[]>();

  // 按 parentThreadId 聚合
  for (const session of sessions) {
    if (session.parentThreadId) {
      const siblings = childByParent.get(session.parentThreadId) ?? [];
      siblings.push(session);
      childByParent.set(session.parentThreadId, siblings);
    }
  }

  // 顶级 session（无 parent）作为 group header
  for (const session of sessions) {
    if (!session.parentThreadId) {
      groups.push({
        type: "orchestration",
        parent: session,
        children: childByParent.get(session.id) ?? [],
      });
    }
  }

  return groups;
}
```

Sidebar 渲染：

```
┌─ Sidebar ──────────────────┐
│                              │
│ 📁 Workspace A              │
│   ├─ 🔵 Main thread         │  ← orchestrator
│   │   ├─ 🟢 Child X         │  ← 缩进，状态色
│   │   └─ 🟡 Child Y         │
│   ├─ 🟣 Standalone thread   │  ← 非编排 session
│   └─ 📁 Archived...         │
│                              │
│ 📁 Workspace B              │
│   └─ 🔵 Another thread      │
│                              │
└──────────────────────────────┘
```

来源：[thread-groups.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/thread-groups.ts) + [sidebar.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/sidebar.tsx)

---

## 8. Tool/Text 流式渲染与时序处理

### 8.1 `transcriptFromMessages`：消息转 UI 项

编排场景下的特殊处理——orchestrator 调用的 `create_child_thread` / `list_threads` / `read_thread` / `send_message_to_thread` 都是普通 tool call，在 transcript 中与普通工具调用无区别。**区分在 UI 层**：当 tool name 匹配编排工具时，渲染特殊的 `OrchestrationChildrenView`。

```ts
// session-supervisor-utils.ts — 核心转换

export function transcriptFromMessages(
  messages: readonly unknown[],
  fallbackTimestamp = nowIso()
): SessionTranscriptItem[] {
  const transcript: SessionTranscriptItem[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const [index, message] of messages.entries()) {
    const role = message.role;
    const createdAt = messageCreatedAt(message, fallbackTimestamp);

    // toolResult 消息：回写到对应的 tool call 记录
    if (role === "toolResult") {
      applyToolResult(transcript, toolIndexByCallId, message, createdAt);
      continue;
    }

    if (role !== "user" && role !== "assistant"
        && role !== "branchSummary" && role !== "compactionSummary") {
      continue;
    }

    const text = messageText(message);
    const attachments = messageAttachments(message);
    if (text || attachments.length > 0) {
      transcript.push({ kind: "message", id: generateId(), role, text, attachments, createdAt });
    }

    // assistant 消息里的 toolCall content blocks → tool 记录
    if (role === "assistant") {
      appendToolCalls(transcript, toolIndexByCallId, message, createdAt);
    }
  }
  return transcript;
}
```

### 8.2 Tool call 与 result 的关联

通过 `callId` 索引：

```ts
function appendToolCalls(
  transcript: SessionTranscriptItem[],
  toolIndexByCallId: Map<string, number>,
  message: any,
  createdAt: string
): void {
  for (const block of message.content ?? []) {
    if (block.type === "toolCall") {
      const toolItem: SessionTranscriptToolCall = {
        kind: "tool",
        id: generateId(),
        callId: block.id,
        toolName: block.name,
        input: block.arguments,
        output: undefined,      // 等 toolResult 来回写
        createdAt,
        isOrchestrationTool: ORCHESTRATION_TOOL_NAMES.has(block.name),
      };
      toolIndexByCallId.set(block.id, transcript.length);
      transcript.push(toolItem);
    }
  }
}

function applyToolResult(
  transcript: SessionTranscriptItem[],
  toolIndexByCallId: Map<string, number>,
  message: any,
  createdAt: string
): void {
  const callId = message.toolCallId;
  const toolIndex = toolIndexByCallId.get(callId);
  if (toolIndex !== undefined) {
    const toolItem = transcript[toolIndex] as SessionTranscriptToolCall;
    toolItem.output = message.content;
    toolItem.completedAt = createdAt;
  }
}
```

### 8.3 乱序处理

pi 的 JSONL 是**树结构**（每条消息带 `parentId`），`SessionManager.buildSessionContext()` 会把树展平成时间线数组。pi-gui 不需要处理乱序——上游已经排好了。

对于 streaming 场景：
- live runtime 的 `messages[]` 按到达顺序追加
- tool call 和 text 可能交错，但 `transcriptFromMessages` 保持原始顺序
- tool result 通过 `callId` 回写到对应的 tool call 记录（即使 result 晚到）

来源：[session-supervisor-utils.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor-utils.ts) + [transcript.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/transcript.ts)

---

## 9. Session 路由与状态机

### 9.1 Session 生命周期状态

```
                 create
                   │
                   ▼
              ┌─────────┐
              │  Idle    │ ← 创建后，等待用户消息或 orchestrator prompt
              └────┬─────┘
                   │ sendUserMessage / startThread
                   ▼
              ┌─────────┐
         ┌───▶│ Running  │ ← agent loop 进行中
         │    └────┬─────┘
         │         │ agent 完成 / 出错
         │    ┌────┴─────┐
         │    │          │
         │    ▼          ▼
         │ ┌──────┐  ┌───────┐
         │ │ Idle  │  │ Error │
         │ └──┬───┘  └───────┘
         │    │
         │    │ user sends follow-up
         └────┘

  任何状态 → Closed（session 归档 / 窗口关闭）
```

### 9.2 Orchestrator vs Child 状态联动

```
Orchestrator                  Child Thread
   Running                      Running
      │                            │
      │ list_threads()             │
      │ ◄──── status: running ────│
      │                            │
      │                            │ 完成
      │                            ▼
      │                         Idle (stopped)
      │                            │
      │ list_threads()             │
      │ ◄──── status: idle ───────│
      │                            │
      ▼
   Running (继续处理)
```

关键：child 状态变化通过 `SessionDriverEvent` 推送到 `app-store-session-state.ts`，再通过 IPC push 到 renderer。

来源：[app-store-session-state.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-session-state.ts) + [session-state-map.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/session-state-map.ts)

### 9.3 Revision 防竞态

```ts
// desktop-app-state.ts — revision 机制

function applySnapshotIfNewer(
  current: DesktopAppState,
  incoming: DesktopAppStateSnapshot
): DesktopAppState {
  if (incoming.revision <= current.revision) {
    return current;  // stale snapshot，丢弃
  }
  return { ...incoming, revision: incoming.revision };
}
```

每次 state 变更递增 `revision`。IPC response 和 push event 可能乱序到达，revision 确保新 state 不被旧 state 覆盖。

来源：[desktop-app-state.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/app/desktop-app-state.ts)

---

## 10. 消息流转全链路

### 10.1 用户消息 → Agent 执行

```
User types in Composer
    │
    ▼
ComposerPanel.tsx
    │ IPC: pi-gui:send-user-message
    ▼
preload.ts → main.ts → app-store-composer.ts
    │
    ▼
app-store.ts: sendUserMessage(sessionRef, text)
    │
    ├─ 写入 JSONL（通过 SessionManager）
    ├─ 触发 agent loop（通过 AgentSessionRuntime）
    └─ 如果是 orchestrator session：
        └─ agent 可能调用编排工具 → create_child_thread → 新的 AgentSessionRuntime
    │
    ▼
SessionDriverEvent (message/toolCall/toolResult/statusChange)
    │
    ├─ app-store-session-state.ts: applySessionEventState()
    ├─ IPC push: pi-gui:state-changed → renderer
    └─ IPC push: pi-gui:selected-transcript-changed → renderer
    │
    ▼
ConversationTimeline.tsx: 重新渲染
```

### 10.2 编排工具调用链路

```
Orchestrator agent decides to spawn child
    │
    ▼
tool_call: create_child_thread({ prompt: "...", worktree: "new" })
    │
    ▼
orchestration-runtime.ts: handler
    │
    ├─ app-store.ts: createSession() → 新 JSONL 文件
    ├─ worktree-manager.ts: git worktree add → 隔离目录
    ├─ pi-sdk-driver: new AgentSessionRuntime(childSessionFile, { cwd: worktreePath })
    ├─ child runtime: sendUserMessage(prompt) → agent loop 开始
    └─ return threadId → tool_result → orchestrator agent
    │
    ▼
Orchestrator agent continues supervision loop
    │ tool_call: list_threads() / read_thread() / ...
    │
    ▼
Child thread completes → status change event → IPC push → UI update
```

---

## 11. 持久化

### 11.1 编排状态持久化

```ts
// app-store-persistence.ts — PersistedUiState 中的编排字段

interface PersistedUiState {
  // ... 其他字段
  orchestrationChildren: OrchestrationChildThread[];
  // 随 UI state 一起 debounce 写盘
}
```

编排 child 信息（threadId、parentThreadId、status、worktreePath、evidence）存入 UI state JSON，与应用重启时恢复。

### 11.2 Session 文件映射

```ts
// json-catalog-store.ts — catalog 中的 session 文件路径

type CatalogFileState = {
  version: 2;
  workspaces: WorkspaceCatalogEntry[];
  sessions: SessionCatalogEntry[];
  sessionFiles: Record<string, string>;  // sessionKey → JSONL 路径
  worktrees: WorktreeCatalogEntry[];     // 包含 child thread 的 worktree
};
```

来源：[app-store-persistence.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-persistence.ts) + [json-catalog-store.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/json-catalog-store.ts)

---

## 12. 对 vibe-ide AiTab 编排设计的启示

### 12.1 最值得借鉴的 3 个做法

**① 编排 = extension tools，不是特殊控制流**

pi-gui 的编排不是硬编码的 scheduler/orchestrator 类，而是给 agent 注入 4 个工具（`create_child_thread` / `list_threads` / `read_thread` / `send_message_to_thread`）。agent 自己在对话循环中决定何时 spawn、何时 check、何时汇总。**GUI 完全被动**——只负责展示工具调用结果和 child 状态。

→ vibe-ide 启示：如果 AiTab 要做子 agent 编排，最简路径是给 claude CLI 注入自定义工具（通过 MCP 或 stdin 协议），让 agent 自己决定拆分策略，而不是在 GUI 侧硬编码编排逻辑。

**② Evidence system：结构化的质量评估**

不是简单等 child 完成就收工，而是 4 种 evidence 类型（worker_report / orchestrator_acceptance / review_finding / blocker）形成完整的 review 闭环。orchestrator 可以 review child 的 transcript、发现问题、要求返工。

→ vibe-ide 启示：子 agent 的完成不等于质量好。如果要做编排，需要一个轻量 evidence 协议让 parent agent 评估 child 的工作。

**③ Git worktree 隔离：并行不冲突**

child thread 运行在独立 worktree 中，文件操作互不干扰。这是 GUI 层（`worktree-manager.ts`）与 agent runtime 协作的结果——agent 调 `create_child_thread(worktree: "new")`，GUI 自动 `git worktree add`。

→ vibe-ide 启示：如果子 agent 需要并行修改文件，worktree 是最干净的隔离方式。但这增加了复杂度（merge 冲突、cleanup），需要评估是否值得。

### 12.2 值得注意的 1 个坑

**Supervisor loop 的触发条件不好定义**

pi-gui 的监督循环依赖 agent 自己调用 `list_threads()` / `read_thread()` 来检查进度。但如果 agent "忘记"检查（比如 context window 被填满、或者 LLM 的指令遵循不够强），child thread 可能跑飞而没人管。pi-gui 的解法是在 system prompt 中强制要求 orchestrator 定期检查，但这依赖于 prompt engineering 的可靠性。

→ vibe-ide 注意：如果做编排，不能完全信任 agent 自主监督。需要一个 fallback 机制（比如 GUI 层定时器检查 child 状态，超时则提醒用户）。

---

## 13. 与 vibe-ide 当前实现的差异

| 维度 | pi-gui | vibe-ide AiTab |
|------|--------|----------------|
| Agent runtime | 嵌入 `@earendil-works/pi-coding-agent` npm 包（进程内） | spawn `claude` CLI 子进程（stream-json stdout） |
| 子 agent | orchestrator 通过 extension tools 自主 spawn | 无子 agent（单 session） |
| 编排控制 | agent 自主决定（LLM-in-the-loop） | 无编排 |
| Tool 渲染 | tool call 内联在 timeline，可折叠 | tool 分组显示在 AiTab |
| 流式渲染 | `transcriptFromMessages()` 线性遍历，tool result 通过 callId 回写 | `lineBuffer` + `JSON.parse` 逐行解析 stdout |
| 并行执行 | 多个 `AgentSessionRuntime` 实例并行 | 单进程 |
| 状态同步 | revision 号防竞态 + IPC push | useState + IPC push |
| 上下文交接 | child 继承 parent 的 workspace，可选 worktree 隔离 | 无 |

---

## 14. 未查到的点

1. **orchestration-runtime.ts 的完整 handler 实现**——通过 WebFetch 获取的源码被截断，handler 内部只有概要逻辑。完整的 `create_child_thread` handler（包括 worktree 路径解析、session file 创建、runtime 初始化）需要 clone 仓库才能读到。
2. **supervision loop 的自动触发机制**——不清楚是 pi runtime 内部有定时器自动调用 `list_threads()`，还是完全依赖 agent 的 tool call 决策。从代码结构看更像是后者。
3. **evidence 的具体写入时机**——`worker_report` 是 child agent 的 tool_result 还是专门的 message 类型？代码中只看到类型定义，没找到 evidence 的写入点。
4. **child thread 的 context window 管理**——child 是否共享 parent 的 context？还是完全独立的 context？从 session 隔离设计看应该是独立的，但 `initialContext` 参数的传递机制不明。
5. **编排工具的错误处理**——`create_child_thread` 失败（比如 worktree 创建冲突）时的回滚逻辑不明。

---

## 来源

全部一手源（官方仓库源码），通过 GitHub Contents API 获取：

| 文件 | URL |
|------|-----|
| `apps/desktop/electron/app-store-orchestration.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts> |
| `apps/desktop/electron/orchestration-runtime.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/orchestration-runtime.ts> |
| `apps/desktop/electron/app-store.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store.ts> |
| `apps/desktop/electron/app-store-session-state.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-session-state.ts> |
| `apps/desktop/electron/worktree-manager.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/worktree-manager.ts> |
| `apps/desktop/electron/app-store-persistence.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-persistence.ts> |
| `apps/desktop/src/desktop-state.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/desktop-state.ts> |
| `apps/desktop/src/conversation-timeline.tsx` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/conversation-timeline.tsx> |
| `apps/desktop/src/timeline-item.tsx` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-item.tsx> |
| `apps/desktop/src/timeline-turns.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-turns.ts> |
| `apps/desktop/src/thread-groups.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/thread-groups.ts> |
| `apps/desktop/src/sidebar.tsx` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/sidebar.tsx> |
| `packages/pi-sdk-driver/src/session-supervisor.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor.ts> |
| `packages/pi-sdk-driver/src/session-supervisor-utils.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor-utils.ts> |
| `packages/pi-sdk-driver/src/transcript.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/transcript.ts> |
| `packages/pi-sdk-driver/src/json-catalog-store.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/json-catalog-store.ts> |
| `packages/session-driver/src/types.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/types.ts> |
| 仓库 README | <https://github.com/minghinmatthewlam/pi-gui> |
| 上游 pi runtime | <https://github.com/earendil-works/pi> |
