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

> ⚠️ **本节为第一轮初判，部分被 §17 订正，以 §17 为准**：§12.1③「Git worktree 隔离」夸大——worktree 是 workspace 级特性、非 child-thread 内生，`create_child_thread` 只收 `{ prompt }`（§17.2）；§12.2「supervisor 依赖 agent 主动查进度」的坑被 runtime 60s 定时器缓解（§17.3）。

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

## 15. 补充深挖：Session / Runtime 类型层

第二轮针对 `packages/session-driver/src/types.ts`、`runtime-types.ts`、`packages/pi-sdk-driver/src/{session-schema,pi-sdk-driver,session-supervisor-utils}.ts`、`apps/desktop/electron/{app-store-timeline,app-store-session-state,session-state-map}.ts` 共 8 个文件的源码深挖。补回第 14 节里几个没讲清的点，并修正若干细节。

### 15.1 Host UI 异步请求协议（第 14 节未覆盖，强烈相关 vibe-ide）

agent runtime 不直接弹原生对话框，而是向 host GUI 发 **`HostUiRequest`**，GUI 异步回 **`HostUiResponse`**。这正是 CLAUDE.md「禁用同步弹窗，用异步 Modal」规则的同款模式。

```ts
// packages/session-driver/src/types.ts
type HostUiRequest =
  | { kind: "confirm";  title; message; defaultValue?; timeoutMs? }
  | { kind: "input";    title; placeholder?; initialValue?; timeoutMs? }
  | { kind: "select";   title; options: readonly string[]; allowMultiple? }
  | { kind: "editor";   title; initialValue? }
  | { kind: "notify";   message; level?: "info"|"warning"|"error" }
  | { kind: "status";   key; text? }
  | { kind: "widget";   key; lines?; placement?: "aboveComposer"|"belowComposer" }
  | { kind: "title";    title }
  | { kind: "editorText"; text }
  | { kind: "reset" };

type HostUiResponse =
  | { requestId; value: string }        // input 回填
  | { requestId; confirmed: boolean }   // confirm 回填
  | { requestId; cancelled: true };     // 取消
```

`SessionDriver.respondToHostUiRequest(sessionRef, response)` 是回填入口；GUI 侧通过 `hostUiRequest` 事件（`SessionDriverEvent` 的一种）接收。

→ vibe-ide：AiTab 现在弹确认/输入若用 `confirm()`/`prompt()` 就违反了规则。pi-gui 这套 request/response 协议可直接抄——定义一个 `AiHostRequest` 联合 + 一个 Modal 渲染器 + `respond(requestId, …)` 回调，与现有 `confirmAction` 状态合流。

来源：[packages/session-driver/src/types.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/types.ts)

### 15.2 `steer` / `followUp` 是 session 级概念，非编排工具专属

第 2.1 节把 `mode: steer | followUp` 写在 `send_message_to_thread` 工具里，但源码里它其实是 **`SessionMessageDeliveryMode`**，作用于所有 user→session 消息（`SessionQueuedMessage.mode`）：

```ts
type SessionMessageDeliveryMode = "steer" | "followUp";
// steer     = 当前 turn 结束时注入（打断/转向）
// followUp  = 当前 run 完成后排为下一个 user turn
```

→ vibe-ide：AiTab 的「追加输入但不发送」（`__vibeAppendInput` 通道）其实就是 `followUp` 队列的雏形；`steer` 对应「中途插话转向」。可借这两个语义把 append/steer 统一成一个 `deliveryMode` 字段，而不是两条独立通道。

来源：[packages/session-driver/src/types.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/types.ts)

### 15.3 Session 树：分支 / 压缩导航（fork）

session 不是线性数组，是**树**。节点类型：

```ts
type SessionTreeNodeKind =
  | "message" | "thinking_level_change" | "model_change"
  | "compaction" | "branch_summary" | "custom"
  | "custom_message" | "label" | "session_info";

interface SessionTreeSnapshot {
  roots: readonly SessionTreeNodeSnapshot[];   // parentId 链成树
  leafId: string | null;                        // 当前叶子
}
```

`SessionDriver.getSessionTree(ref)` / `navigateSessionTree(ref, targetId, options?)` 做树导航。**Fork**（从历史某点分叉新 session）：

```ts
type ForkPosition = "before" | "at" | "after";
interface ForkSessionOptions {
  targetWorkspace: WorkspaceRef;
  sourceMessageId?: string;
  sourceMessageIndex?: number;
  userMessageIndex?: number;
  position?: ForkPosition;     // 在某条消息 前/恰好/后 分叉
  title?: string;
}
interface ForkSessionResult {
  snapshot: SessionSnapshot;
  selectedText?: string;        // forking "before" 时回填到 composer
}
```

`validateForkSession` 先校验再 `forkSession` 执行。

→ vibe-ide：第 8.3 节说「pi 的 JSONL 是树结构，上游已排好」——这里补全了树的具体形态。若 AiTab 要做「回到某条消息重新分支」，`ForkPosition` + `sourceMessageIndex` 是现成模型。

来源：[packages/session-driver/src/types.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/types.ts)

### 15.4 SessionStatus 实际取值（修正第 9.1 节）

第 9.1 节画的 Idle/Running/Error 是示意。源码里 **session 级** 状态只有三态：

```ts
type SessionStatus = "idle" | "running" | "failed";
```

注意第 2.1 节里 `ThreadStatus = "idle" | "running" | "stopped" | "error"` 是**编排 child thread** 的状态，二者不同（child 多了 `stopped` 表示主动完成）。`statusForEvent()` 把 `SessionDriverEvent` 映射到 `SessionStatus`。

来源：[packages/session-driver/src/types.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/types.ts)

### 15.5 Schema 版本偏移检测（jsonl 前向兼容）

pi-gui 读 session JSONL 时只读头 16KB 取 schema version，对比 `runtimeSchemaVersion`，若文件由更新版 runtime 写入则 `writtenByNewerRuntime = true`，**告警而非静默丢内容**：

```ts
// packages/pi-sdk-driver/src/session-schema.ts
const RUNTIME_SCHEMA_VERSION: number = CURRENT_SESSION_VERSION; // 来自 @earendil-works/pi-coding-agent

interface SessionSchemaInfo {
  fileSchemaVersion: number | undefined;
  runtimeSchemaVersion: number;
  writtenByNewerRuntime: boolean;  // 文件比内置 runtime 新
}
function readSessionFileSchemaVersion(filePath): Promise<number | undefined>;  // 只读 header
```

→ vibe-ide：AiTab 读 claude jsonl（参考「AI configDir 全链透传」记忆）时可抄这套——头几行抽版本号，版本不匹配就提示「会话由更新版 Claude 写入，可能显示不全」，别静默截断。

来源：[packages/pi-sdk-driver/src/session-schema.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-schema.ts)

### 15.6 Thinking levels 枚举

```ts
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
// RuntimeSettingsSnapshot.defaultThinkingLevel 用同枚举
// SessionDriver.setSessionThinkingLevel(ref, level) 运行时切换
```

→ vibe-ide：若 AiTab 要暴露 thinking budget，这是 7 档枚举的现成参照（off→max）。注意 `xhigh` 在 `high` 与 `max` 之间。

来源：[packages/session-driver/src/types.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/types.ts) + [runtime-types.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/runtime-types.ts)

### 15.7 流式 / 并发 / 恢复工具函数

`session-supervisor-utils.ts` 里几个 vibe-ide 直接可抄的小工具：

```ts
// 何时该从磁盘重读 jsonl 而非信 stream
function shouldTailFromDisk({ isStreaming, diskMtimeMs, baselineMtimeMs }): boolean;

// 同 key 请求合流（避免并发重复 spawn / 重复读）
function singleFlight<T>(inFlight, key, factory): Promise<T>;

// 事件队列出错后链式恢复（不丢事件）
function chainRecoveringEventQueue(queue, work, onError): Promise<void>;

// 强制落盘当前 session
function forcePersistSession(sessionManager): void;
```

`shouldTailFromDisk` 对 vibe-ide 的 AiTab stdout 解析特别有用——当 stream 中断或 jsonl mtime 跳变时，决定是继续 parse stdout 还是回退到读 jsonl 文件。

来源：[packages/pi-sdk-driver/src/session-supervisor-utils.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor-utils.ts)

### 15.8 文件附件序列化 + RunMetrics + toolLabel

- **附件**：image/file 附件在消息文本里序列化成 `<pi-gui-file-attachments>…JSON…</pi-gui-file-attachments>` 块，`transcriptFromMessages` 解析时剥离还原成 `SessionTranscriptAttachment`。
- **RunMetrics**（`app-store-timeline.ts`）：`{ startedAt, toolCount, searchCount, fileCount }` → 渲染成第 7.1 节的 TurnMarker「Explored N files, N searches · Worked for X:XX」。
- **toolLabel()** 智能归类：search 类→"Searched {detail}"，file 类(read/glob/ls)→"Read/Explored {detail}"，thread 类→"Started/Read/Sent to child thread"。

→ vibe-ide：toolLabel 的「按工具族归类生成人类可读标签」思路，比 AiTab 现在按 tool name 原样显示更友好。

来源：[apps/desktop/electron/app-store-timeline.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-timeline.ts) + [session-supervisor-utils.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor-utils.ts)

### 15.9 SessionStateMap：per-session 运行态容器

`session-state-map.ts` 用 ~20 个 `Map<sessionKey, …>` 存每 session 的：transcript 缓存、composer 草稿/附件、queued 消息/编辑、session 配置、错误、订阅、命令、extension UI 状态、pinned 顺序、run metrics、auto-title 跟踪、活跃 assistant 消息、working activity。`prune(activeKeys)` 清掉 stale session 并 unsubscribe，`deleteSession(key)` 取消 auto-title。

→ vibe-ide：这正是 CLAUDE.md「Session 独立架构约束」要的形态——**per-session keyed 状态容器**，禁止全局单例。pi-gui 用一个类聚合了所有 per-session Map，比 vibe-ide 现在散在各 `Record<string, …>` 更集中；可参考其 `prune` / `allSessionKeys` 的清理边界与 unsubscribe 时机。

来源：[apps/desktop/electron/session-state-map.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/session-state-map.ts)

### 15.10 第二轮仍没定论的

- `SessionSupervisor`（被 `PiSdkDriver` 委托的真正核心）源码未取到——`create_child_thread` handler 的 worktree 回滚、`initialContext` 注入 child system prompt 的具体方式都在里面，需 clone 仓库。
- `chainRecoveringEventQueue` 的恢复边界（重试几次、哪些错可恢复）未细看。
- supervision loop 仍是 agent 自主触发，没发现 runtime 定时器兜底的证据（第 4.2 节判断成立）。

---

## 16. 勘误：UI 编排渲染（第 7.2/7.3 节）与实源码不符 + UI 层补充

### 16.1 ⚠️ 第 7.2 / 7.3 节的编排 UI 组件在实源码中未找到

第三轮直接抓取并通读了 `apps/desktop/src/timeline-item.tsx`、`thread-groups.ts`、`conversation-timeline.tsx`、`timeline-turns.ts`、`timeline-types.ts`、`App.tsx`、`sidebar.tsx`、`composer-surface.tsx` 的实际源码，**未发现**第 7.2 节的 `OrchestrationChildrenView` / `ChildThreadCard`，也未发现第 7.3 节的 `groupThreadsByOrchestration` / `session.parentThreadId`。这两节的具体组件代码与源码不符，应视为**不准确**——疑似第一轮基于 `orchestration-runtime.ts` 的工具定义推演出的示意，并非真实存在的组件。

实际源码结论：

- `timeline-item.tsx` 只有 **5 种 item kind**：`message` / `activity` / `tool` / `summary` / `turn-marker`，**无编排专用的子 agent 分组面板**。
- **编排工具调用（`create_child_thread` / `list_threads` / `read_thread` / `send_message_to_thread`）在 UI 上就是普通 tool row**，与 read/grep/bash 同等渲染，不特殊。第三轮综述原话：「没有显式的 sub-agent 分组——所有 messages/tools/activities 在同一个线性 timeline 中，通过 `kind` 区分样式」。
- `thread-groups.ts` 的 `buildThreadGroups` 按 **workspace** 聚合（primary workspace → linked worktrees → 各自 sessions），分 **pinned / active / archived** 三段，**不按 parentThreadId 分组**。

→ 对 vibe-ide 的影响（重要）：你 AiTab 现有的「子 agent 分组显示」其实是 pi-gui **没有**的功能。第一轮「抄 `OrchestrationChildrenView`」的建议基于不存在的代码，请忽略。pi-gui 编排全在 runtime/tool 层，GUI 层是「被动线性 timeline」——可参考的点是「编排工具当普通 tool 渲染」的克制，不是嵌套分组面板。

> 注：编排 **tool 层**已由第四/五轮深读源码确认属实（§17.1）；但 §2.1 的 `worktree`/`title`/`initialContext` 参数与 §5 的 worktree 隔离叙事**与源码不符**，已被 §17.2 订正。以 §17/§18 为准。

来源：[timeline-item.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-item.tsx) + [thread-groups.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/thread-groups.ts)（第三轮实源码通读）

### 16.2 Timeline 渲染层（实源码，vibe-ide 可抄）

- **虚拟化**（`conversation-timeline.tsx`）：`VIRTUALIZATION_THRESHOLD = 80`，超过 80 项才启用自定义虚拟化；`ResizeObserver` 逐项测高缓存进 `measuredHeightsRef`，`findStartIndex`/`findEndIndex` 二分定位可见窗口，`OVERSCAN_PX = 720` 上下缓冲，`translateY` 绝对定位。**例外**：含 >2000 字文本或附件的 message 判为 `hasUnreliableVirtualizedHeights`，禁用虚拟化改全量渲染（避免测高不准）。→ AiTab 流式长输出可抄这套阈值+例外。
- **Turn marker**（`timeline-turns.ts` 的 `buildDisplayTimelineItems`）：纯函数，在每个 user message 后插一个 `turn-marker` 显示「Worked for Ns」；持续 < `MIN_WORKED_DURATION_MS = 1000` 不显示；时长取 turn 内所有 item `createdAt` 的最大值。Codex 风格。
- **5 种 item kind**（`timeline-types.ts`）：`message`(user/assistant/branchSummary/compactionSummary) / `activity`(tone: neutral/success/warning/error) / `tool`(status: running/success/error，带 input/output) / `summary`(presentation: inline/divider) / `turn-marker`。`DisplayTimelineItem = TranscriptMessage | TimelineTurnMarker`，turn-marker 是纯视图层不持久化。
- **Write 工具内联 diff**（`timeline-item.tsx`）：`isWriteTool` 判定后，展开体用 `InlineDiff` + `extractDiffFromOutput`，`countDiffStats` 显示 `+added -removed`。其他工具展开显示 JSON input/output。
- **toolGlyph**：按工具族选图标——DiffIcon(write) / TerminalIcon(bash) / FileIcon(read) / SparkIcon(default)，配 `buildCompactLabel`（如「Edited path/to/file」）。
- **Fork 按钮**：assistant message 底部有 Fork，回调 `onForkFromMessage(messageIndex, preview)`——对应 §15.3 的 `ForkSessionOptions`。

来源：[conversation-timeline.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/conversation-timeline.tsx) + [timeline-turns.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-turns.ts) + [timeline-types.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-types.ts) + [timeline-item.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-item.tsx)

### 16.3 Sidebar / Composer（实源码，vibe-ide 可抄）

- **Sidebar 拖拽排序**（`sidebar.tsx`，`@dnd-kit/core` + `sortable`）：workspace 组与 pinned thread 都可拖拽；`headerCollision` 只在行头 ~30px 命中（避免误触）；`applyOptimisticReorder` 先本地更新再 IPC 提交，失败回滚。thread 分 pinned / active / archived（archived 折叠）。session 状态点：running(脉冲) / failed(红) / unseen(蓝)。worktree session 显 WorktreeIcon。
- **Composer**（`composer-surface.tsx`）：纯展示组件（40+ props 全传入）；**两段式 slash 命令**（先选 command 再选 option，如 `/model gpt-4`）；**`@` mention** 支持 extensions + files 两类；附件拖放用 `dragDepthRef` 计数解决 dragEnter/Leave 冒泡；**queued messages** 可 edit/remove/steer（改排队消息）——对应 §15.2 的 `SessionQueuedMessage`。
- **App.tsx 状态**：`useDesktopAppState()` 全局 snapshot，所有 session 态按 `selectedSessionKey` 索引；`useComposerDraftSync` 按 session key 存/恢复输入框草稿；`useTimelineScroll` 管虚拟滚动+底部固定+跳转。切 session 时 `flushComposerDraft()` + 存滚动状态。

来源：[sidebar.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/sidebar.tsx) + [composer-surface.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/composer-surface.tsx) + [App.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/App.tsx)

---

## 17. 深挖勘误与补全（第四轮实源码，权威）

第四轮直接通读了 `app-store-orchestration.ts`(1874 行)、`orchestration-runtime.ts`、`app-store.ts`、`packages/pi-sdk-driver/src/session-supervisor.ts`(2555 行)、`runtime-supervisor.ts`、`transcript.ts` 的实际源码。**本节订正前几轮若干不准处，并补全第一轮 §14 列的未查点。以本节为准。**

### 17.1 ✅ 编排 tool 层确认属实

`orchestration-runtime.ts` 确实定义了 4 个工具，走 **Bridge 模式**解耦定义与实现：

```ts
// orchestration-runtime.ts
export const createChildThreadToolName = "create_child_thread";
export const createChildThreadAction   = "pi_gui_create_child_thread";
// list_threads / read_thread / send_message_to_thread 同理

interface OrchestrationRuntimeBridge {
  createChildThread(ctx, input: { prompt, toolCallId }): Promise<AgentToolResult<CreateChildThreadToolDetails>>;
  listThreads(ctx): Promise<AgentToolResult<ListThreadsToolDetails>>;
  readThread(ctx, threadId): Promise<AgentToolResult<ReadThreadToolDetails>>;
  sendMessageToThread(ctx, input: { threadId, message }): Promise<AgentToolResult<SendMessageToThreadToolDetails>>;
}
// createOrchestrationRuntimeExtension(bridge) 注册到 ExtensionAPI
```

`app-store-orchestration.ts` 实现 `OrchestrationRuntimeBridge`，由 `app-store.ts` 的 `handleSessionEvent` 在 tool result 到达时分发（`handleOrchestrationThreadToolResult`）。

来源：[orchestration-runtime.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/orchestration-runtime.ts) + [app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

### 17.2 ⚠️ 重大订正：`create_child_thread` 只收 `prompt`，无 worktree/title/initialContext

两轮深读均确认 `create_child_thread` 工具参数 = **`{ prompt: string }`** 仅此一项。§2.1 给的 `CreateChildThreadInputSchema`（含 `worktree?` / `title?` / `initialContext?`）与源码不符，应视为不准。

内部 `SpawnChildThreadInput = { parentWorkspaceId, parentSessionId, prompt, sourceToolCallId? }`——同样无 worktree。`createChildThreadRecord`（app-store-orchestration.ts L68-196）创建 child 的方式是 `store.driver.createSession()`——**一个新 session，不是 git worktree**。

⇒ **§5「Git Worktree 隔离实现真正并行」与 §12.1③ 作为编排核心机制是夸大的**。pi-gui 的 child thread 是 **session 隔离**（独立 JSONL、独立 runtime），但**与 parent 共用同一工作目录**——多个 child 并行改文件会冲突。worktree 在 pi-gui 里是**另一个独立特性**（workspace 级，`ThreadEnvironmentMeta: "local"|"worktree"`，sidebar 显示 `rootWorkspace / worktreeName`），不是 child-thread 编排的内生部分。

→ 对 vibe-ide：别照「worktree-per-child」实现并行隔离——pi-gui 没这么做。若要并行改文件不冲突，得自己加 worktree（pi-gui 的 worktree-manager 可作 workspace 级参考，但 `create_child_thread` 本身不触它）。

来源：[orchestration-runtime.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/orchestration-runtime.ts) + [app-store-orchestration.ts L68-196](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

### 17.3 ✅ 订正 §4.2 / §12.2 的「坑」：supervision 有 runtime 定时器兜底

§4.2/§12.2 说「supervisor loop 完全依赖 agent 主动调 `list_threads()`，LLM 忘了查就跑飞」——**不准**。源码有 runtime 定时器：

```ts
// app-store-orchestration.ts
const DEFAULT_SUPERVISION_INTERVAL_MS = 60_000;   // 默认 60s
const MIN_SUPERVISION_INTERVAL_MS = 250;
// 可用 PI_APP_ORCHESTRATION_SUPERVISION_INTERVAL_MS 环境变量覆盖

function reconcileDueSupervisionLoops(store, now) // L577-617，定时 tick 入口
function projectSupervisionLoop(loop, status, nowIso) // L923-960，状态机
function advanceSupervisionLoop(loop, status, now)
```

`app-store.ts` 用 `scheduleOrchestrationSupervision` / `runOrchestrationSupervisionTick` 调度。状态机：

```
OrchestrationSupervisionStatus = "monitoring" | "attention" | "stopped"
OrchestrationSupervisionGate    = "continue"  | "wake"     | "stop"

monitoring + continue  → 每 intervalMs(60s) 推进一次，检查 child
child 变 complete/failed → 切 attention + gate=wake + 清 nextRunAt（停表，等父看）
gate=stop → cancelChildRun() 中止 child
```

⇒ 第一轮的「坑」被这个定时器缓解：哪怕 LLM 忘了主动 `list_threads()`，runtime tick 也会在孩子完成/失败时把 loop 切到 `attention` 唤醒父线程。

→ 对 vibe-ide：若做编排，这 60s tick + attention/wake 状态机就是现成的「不信任 agent 自主监督」兜底，直接抄。

来源：[app-store-orchestration.ts L577-617, L923-960](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts) + [app-store.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store.ts)

### 17.4 ✅ 订正 child 状态枚举（§2.1 ThreadStatus / §15.4）

`desktop-state.ts` 的 child 状态实为 5 态（非 §2.1 的 4 态 `idle|running|stopped|error`）：

```ts
type OrchestrationChildThreadStatus = "queued" | "running" | "waiting" | "complete" | "failed";

// toOrchestrationStatus (L1779-1800):
//   有 queued msg        → "waiting"
//   session failed       → "failed"
//   session running      → "running"
//   从未启动过 run       → "queued"（防假 complete）
//   否则                  → "complete"
```

来源：[desktop-state.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/desktop-state.ts) + [app-store-orchestration.ts L1779-1800](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

### 17.5 ✅ 补全 evidence 系统（订正 §6 的 4 种 → 实为 7 种 + 派生机制）

§6 列了 4 种 evidence，实际是 7 种 kind + 6 种 status，且 evidence **不是某刻写入的，而是每次 supervision tick 从父子 transcript 派生出来的**：

```ts
type OrchestrationEvidenceKind =
  | "worker_report"           // child 的 assistant 消息
  | "orchestrator_acceptance" // parent 显式接受（消息含 "orchestrator-accepted: <childId> <detail>"）
  | "orchestrator_observation"// parent 调 read_thread
  | "orchestrator_action"     // parent 调 send_message_to_thread
  | "command"                 // child 执行的 tool 调用
  | "review_finding"          // child 消息含 [P0-P3] 标记
  | "blocker";                // child "BLOCKER:" 开头 或 status=failed

type OrchestrationEvidenceStatus = "reported" | "accepted" | "running" | "passed" | "failed" | "blocked";
```

派生函数：`evidenceFromChildTranscript`（child assistant → worker_report/review_finding/blocker；tool → command）、`evidenceFromParentTranscript`（read_thread → observation；send_message → action；accepted 文本 → acceptance）、`blockerEvidenceFromChildStatus`（failed → blocker）。上限 `MAX_EVIDENCE_RECORDS_PER_CHILD = 80`，优先留 blocked/failed/orchestrator-accepted。

⇒ 订正 §14.3「evidence 写入时机不明」：evidence **不持久写入某条消息**，而是从 transcript **派生**，每次 tick 重算，持久化时 strip（见 §17.8）。

来源：[app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

### 17.6 ✅ 补全 child 创建与错误处理（订正 §14.1/14.4/14.5）

`createChildThreadRecord`（L68-196）+ `launchInitialChildPrompt`：

1. 校验 parent session/workspace 在
2. `pendingCreateChildThreadToolCalls` Set 防并发重复创建
3. 按 `sourceToolCallId` 幂等：已有且 failed → throw；已有且未 failed → ensureReady 重发 prompt
4. `store.driver.createSession()` 建新 session
5. 初始化 transcript cache + 订阅事件
6. 建 `OrchestrationChildThread`，初始 evidence `orchestrator_acceptance: "Child thread created"`
7. `launchInitialChildPrompt`：Promise+事件订阅，`CHILD_START_TIMEOUT_MS=10_000` 超时，听 `runFailed`/`sessionClosed`，`CHILD_RUNNING_FAILURE_GRACE_MS=1_000` 宽限，resolve `"running"`/`"responded"`

⇒ 订正 §14.4「initialContext 注入方式不明」：**没有 initialContext**——prompt 即全部上下文，`submitComposerToSession` 直接发。§14.5「worktree 冲突回滚」：无 worktree 故无此逻辑；错误处理靠幂等 + 10s 超时 + 1s 宽限 + 重复创建守卫。测试佐证：初始 prompt 投递失败 → child `status: "failed"` + evidence `{ title: "Initial prompt delivery failed", status: "failed" }`。

来源：[app-store-orchestration.ts L68-196](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

### 17.7 ✅ 新增：agent 事件 → SessionDriverEvent 映射（vibe-ide 直接可抄）

`session-supervisor.ts` 的 `mapAgentEvent` 把 pi runtime 原始事件映射成 GUI 用的 `SessionDriverEvent`——**这正是 vibe-ide AiTab 解析 claude stream-json stdout 要做的事的现成参照**：

| pi runtime 事件 | → SessionDriverEvent |
|---|---|
| `agent_start` / `turn_start` | `sessionUpdated` |
| `message_start` / `message_end` | 归队 queued msg + 更新 preview |
| `message_update` | `assistantDelta`（文本增量） |
| `tool_execution_start` | `toolStarted` |
| `tool_execution_update` | `toolUpdated` |
| `tool_execution_end` | `toolFinished` |
| `agent_end` | `runCompleted` 或 `runFailed` |

`SessionTranscriptToolCall.status = "success" | "error"`，其中 `"error"` 还覆盖**结果永不到达**的 interrupted run。

来源：[session-supervisor.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor.ts) + [transcript.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/transcript.ts)

### 17.8 ✅ 新增：session lease（advisory 单写者）+ 持久化 rehydrate

- **Session lease**：`assertSessionNotForeignLeased` / `acquireSessionLease` / `releaseSessionLease`——基于 PID+TTL 的 advisory 锁，防两个进程同时写同一 JSONL。`getTranscript` 在 stream 中断时用 `shouldTailFromDisk` 决定回退读盘。
- **持久化**：`toPersistedOrchestrationChildren` 对有 `childSessionId` 的 child **strip 掉 transcript/evidence**（盘上只留骨架），`hydrateVisibleOrchestrationChildren` 在可见时按需从 disk rehydrate。evidence 不持久化（每次 tick 重算，§17.5）。

→ vibe-ide：jsonl 多 session 并发写可抄 lease 思路；持久化别把派生数据（transcript/evidence）写盘，存骨架 + 按需 rehydrate 更省。

来源：[session-supervisor.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor.ts) + [app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

### 17.9 ✅ 新增：HostUiRequest 的服务端 + 取消级联

- **服务端**（`createExtensionUiContext`）：extension 通过 `select`/`confirm`/`input`/`notify`/`editor` 异步请求，挂起在 `pendingHostUiRequests: Map<id, {resolve, reject}>`，对应 §15.1 的 `HostUiRequest` 事件；GUI `respondToHostUiRequest` 回填即 resolve promise。`custom()` 抛 unsupported（pi-gui 不渲染 TUI 组件）。
- **取消级联**：取消 parent run → `cancelChildRunsForParent` 中止所有 child；`setChildSupervisionLoopGate("stop")` → `cancelChildRun()`。

来源：[session-supervisor.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor.ts) + [app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts)

### 17.10 thinking level 枚举小歧义

`runtime-types.ts` 的 `RuntimeSettingsSnapshot.defaultThinkingLevel` 含 `"minimal"`（§15.6）；但 `session-supervisor.ts` 的 `THINKING_LEVEL_ORDER = ["off","low","medium","high","xhigh","max"]` 不含 `minimal`。两者来自不同文件，疑似版本/作用域差异——以 `THINKING_LEVEL_ORDER` 为 clamp 顺序的权威，`minimal` 仅在 settings 默认值层面出现。

---

## 18. 最终画面（第五轮确认：后端完整，前端未建）

第五轮专门核验 orchestration 的 UI 渲染，结论与 §16.1 一致并强化：

> **pi-gui 的 orchestration 是「后端完整、前端未建」的系统。**

- **后端完整**：4 工具 + 5 态 child status + 7 种 evidence(+status) + supervision loop(60s 定时器) + IPC 控制 API + 持久化 rehydrate——全在 state 与 main process 里跑通。
- **前端未建**：搜索确认**无 `renderOrchestrationChildren()`、无 `OrchestrationChildThreadRendering` 类型**。timeline 是扁平列表，编排工具调用当普通 tool row 渲染；child 作为**独立 session 出现在侧边栏**，靠 status dot 区分（`session-row__status--running/failed/unseen`）；evidence/supervision 数据**只在内存 state，无专门 UI**；IPC 控制 API 有但**无 UI 控件消费**。

→ 对 vibe-ide 的战略含义（重要）：pi-gui 是个**前车之鉴**——orchestration 后端做完了，UI 没做完就停了。所以：

1. **别抄 pi-gui 的 orchestration UI**——它没有。你 AiTab 现有的「子 agent 分组显示」反而比 pi-gui 走得远，应保留并自成一派。
2. **可抄后端模型**：tool-based 编排 + supervision 状态机(60s tick + attention/wake) + evidence 派生 + session lease + `mapAgentEvent` 事件映射。
3. 若做 child-thread，**侧边栏独立 session + status dot** 是 pi-gui 唯一做出来的 UI 形态，可作最低实现。

### 18.1 新增：IPC 控制 API（无 UI 消费）

```ts
// ipc.ts
sendChildThreadFollowUp: "pi-gui:send-child-thread-follow-up"
setChildSupervisionLoop:  "pi-gui:set-child-supervision-loop"

interface SendChildThreadFollowUpInput { childThreadId: string; text: string }
interface SetChildSupervisionLoopInput  { childThreadId: string; gate: "continue" | "stop" }
```

→ vibe-ide 若做编排，IPC 命名可照此：`<app>:send-child-thread-follow-up` / `<app>:set-child-supervision-loop`。

### 18.2 新增：evidence 记录带 severity + git ref

```ts
interface OrchestrationEvidenceRecord {
  id; childThreadId; kind; source; status; title; detail?;
  command?: string; toolName?: string;
  severity?: "P0" | "P1" | "P2" | "P3";   // review_finding 的严重度
  parentSessionId?; childSessionId?;
  git?: OrchestrationEvidenceGitRef;       // 关联 git 提交/分支
  createdAt; updatedAt?;
}
// 另有 OrchestrationEvidenceSource（"worker-reported"|...|"blocker"）与 kind 平行
```

→ vibe-ide：若做 evidence，severity(P0-P3) + git ref 让 evidence 能直接挂到提交/分支，review 时定位准。

来源：[desktop-state.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/desktop-state.ts) + [ipc.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/ipc.ts) + [sidebar.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/sidebar.tsx)（第五轮实源码 + 测试断言）

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
| `packages/session-driver/src/runtime-types.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/runtime-types.ts> |
| `packages/pi-sdk-driver/src/session-schema.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-schema.ts> |
| `packages/pi-sdk-driver/src/pi-sdk-driver.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/pi-sdk-driver.ts> |
| `packages/pi-sdk-driver/src/runtime-supervisor.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/runtime-supervisor.ts> |
| `apps/desktop/electron/app-store-timeline.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-timeline.ts> |
| `apps/desktop/electron/ipc.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/ipc.ts> |
| `apps/desktop/src/timeline-types.ts` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-types.ts> |
| `apps/desktop/src/App.tsx` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/App.tsx> |
| `apps/desktop/src/composer-surface.tsx` | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/composer-surface.tsx> |
| 仓库 README | <https://github.com/minghinmatthewlam/pi-gui> |
| 上游 pi runtime | <https://github.com/earendil-works/pi> |
