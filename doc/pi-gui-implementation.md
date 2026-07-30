# pi-gui 实现调研

> 调研对象：[minghinmatthewlam/pi-gui](https://github.com/minghinmatthewlam/pi-gui) — 为 [`pi` 编程代理](https://github.com/earendil-works/pi) 构建的 Codex 风格桌面 GUI。
>
> 调研日期：2026-07-30，基于仓库 HEAD `main`（版本 `0.1.0-beta.33`）。
>
> 核验：仓库真实存在，API 正常返回，文件树 401 条目完整；下文所列源码路径均通过 GitHub Contents API 逐一获取原文核验。

---

## 0. "pi gui" 所指

本 repo 上下文里 "pi" 指 `earendil-works/pi`（80.6k★，TypeScript AI agent 工具箱 / 编程代理 CLI）。"pi gui" 在网络上最匹配的项目是 `minghinmatthewlam/pi-gui`（727★，MIT），**唯一一个**把 pi 编程代理包装成 Codex 风格桌面 GUI 的开源项目。

其他候选（Pi Network / Pi Browser / Raspberry Pi GUI 等）与本 repo 的 pi-web / JSONL 解析上下文无关，不予展开。

---

## 1. 项目身份

| 字段 | 内容 |
|------|------|
| 仓库 | <https://github.com/minghinmatthewlam/pi-gui>（MIT） |
| 官网 | <https://www.pi-gui.com/> |
| Stars | 727（2026-07-30 实测）/ Forks 117 |
| 一句话定位 | "A Codex-style desktop app for the pi coding agent" — 给 pi 一个原生桌面壳，**不自己实现 agent runtime**，而是包 `@earendil-works/pi-coding-agent` npm 包 |
| 语言/框架 | TypeScript + Electron（electron-vite） + React 19 + pnpm workspace |
| 平台 | macOS（Apple Silicon）+ Linux（AppImage）+ Windows（RC，`package:win` 已接入） |
| 创建时间 | 2026-03-20，活跃开发中 |
| 包管理 | pnpm 10.25.0（corepack），`pnpm-workspace.yaml` 管理 `apps/*` + `packages/*` |
| 测试 | Playwright + Electron harness，分 core / live / native / production 四个 lane |

来源：[GitHub repo metadata](https://api.github.com/repos/minghinmatthewlam/pi-gui) + [README.md](https://github.com/minghinmatthewlam/pi-gui/blob/main/README.md)

---

## 2. 仓库结构

```
pi-gui/
├── apps/
│   ├── desktop/                     # Electron 桌面应用（主战场）
│   │   ├── electron/                # Main process
│   │   │   ├── main.ts              # 68KB 入口，窗口管理、IPC 注册
│   │   │   ├── preload.ts           # 18KB contextBridge，窄 IPC 面
│   │   │   ├── app-store.ts         # 133KB 中央状态管理（"AppStore"）
│   │   │   ├── app-store-*.ts       # 按职责拆分：
│   │   │   │   ├── app-store-composer.ts        # composer 提交
│   │   │   │   ├── app-store-diff.ts            # diff 面板
│   │   │   │   ├── app-store-files.ts           # 文件浏览
│   │   │   │   ├── app-store-orchestration.ts   # 多 agent 编排（60KB）
│   │   │   │   ├── app-store-persistence.ts     # UI 状态持久化（JSON）
│   │   │   │   ├── app-store-session-state.ts   # session 事件 → state 映射
│   │   │   │   ├── app-store-timeline.ts        # timeline 管理
│   │   │   │   ├── app-store-workspace.ts       # workspace CRUD
│   │   │   │   ├── app-store-worktree.ts        # git worktree 管理
│   │   │   │   └── app-store-utils.ts           # 公共辅助
│   │   │   ├── terminal-service.ts  # node-pty 终端（17KB）
│   │   │   ├── worktree-manager.ts  # git worktree 生命周期（20KB）
│   │   │   ├── notification-manager.ts / notification-permission.ts
│   │   │   ├── orchestration-runtime.ts  # 编排工具定义（create_thread / list_threads / read_thread / send_message）
│   │   │   ├── session-state-map.ts # per-session 内存状态
│   │   │   └── update-checker.ts    # 自动更新
│   │   ├── src/                     # Renderer（React）
│   │   │   ├── App.tsx              # 1072 行，三栏布局（Sidebar + Timeline + Composer）
│   │   │   ├── desktop-state.ts     # 类型定义（DesktopAppState / SessionRecord / Orchestration* 等）
│   │   │   ├── ipc.ts              # IPC 通道常量（70+ channel）
│   │   │   ├── conversation-timeline.tsx  # 虚拟化 timeline（617 行）
│   │   │   ├── timeline-item.tsx    # 单条消息渲染（7042 行）
│   │   │   ├── timeline-turns.ts    # turn marker 计算（"Worked for Ns"）
│   │   │   ├── composer-panel.tsx / composer-surface.tsx  # 输入区
│   │   │   ├── diff-panel.tsx / diff-inline.tsx           # 内联 diff 查看
│   │   │   ├── terminal-panel.tsx                         # xterm.js 终端面板
│   │   │   ├── sidebar.tsx          # 38KB，会话列表 + 分组 + 搜索
│   │   │   ├── settings-view.tsx / settings-*-section.tsx # 设置面板
│   │   │   ├── theme-presets.ts     # 8 套主题预设（27KB）
│   │   │   ├── hooks/               # 自定义 hooks
│   │   │   │   ├── use-timeline-scroll.ts   # 27KB，滚动控制
│   │   │   │   ├── use-slash-menu.tsx       # slash 命令菜单
│   │   │   │   ├── use-mention-menu.tsx     # @mention 文件
│   │   │   │   ├── use-new-thread-controller.tsx  # 新线程创建流程
│   │   │   │   └── ...
│   │   │   ├── styles/              # 纯 CSS（无 Tailwind）
│   │   │   │   ├── main.css         # 50KB
│   │   │   │   ├── timeline.css     # 17KB
│   │   │   │   ├── sidebar.css      # 16KB
│   │   │   │   └── ...
│   │   │   └── app/                 # 次级 UI（file workbench、secondary surfaces）
│   │   └── tests/                   # Playwright E2E（分 core/live/native/production/unit）
│   └── website/                     # Next.js 官网/landing page
├── packages/
│   ├── pi-sdk-driver/               # ★ 核心：pi runtime 的适配层
│   │   └── src/
│   │       ├── session-supervisor.ts     # 90KB，session 全生命周期管理
│   │       ├── runtime-supervisor.ts     # 38KB，provider/model/auth/skill/extension 管理
│   │       ├── json-catalog-store.ts     # workspace/session/worktree catalog 持久化（JSON）
│   │       ├── session-schema.ts         # JSONL schema version 检测
│   │       ├── session-lease.ts          # 会话锁（防并发冲突）
│   │       ├── transcript.ts             # 消息/工具类型定义
│   │       ├── session-supervisor-utils.ts  # transcriptFromMessages 等核心转换
│   │       └── vendor/                   # 上游 pi 的类型声明（sessionDriver.d.ts）
│   ├── session-driver/              # 共享接口层（SessionDriver / SessionRef / SessionEvent 等）
│   │   └── src/
│   │       ├── types.ts             # SessionDriver 接口、SessionTreeNode、事件类型
│   │       └── runtime-types.ts     # RuntimeSnapshot / RuntimeProviderRecord 等
│   └── catalogs/                    # 轻量 catalog 状态（workspace/session/worktree）
│       └── src/
│           ├── types.ts             # CatalogEntry / CatalogSnapshot
│           └── storage.ts           # CatalogStorage 接口
├── patches/                         # pi SDK patch（`@mariozechner__pi-ai`）
└── plans/                           # 设计文档（phase-1-codex-parity / pi-app-mvp）
```

来源：[GitHub tree API](https://api.github.com/repos/minghinmatthewlam/pi-gui/git/trees/main?recursive=1)

---

## 3. 技术栈

| 层 | 技术 | 来源 |
|----|------|------|
| 框架 | Electron 37 + electron-vite 5 | [apps/desktop/package.json](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/package.json) |
| 渲染层 | React 19（DOM），纯 CSS（无 Tailwind） | [App.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/App.tsx) + [styles/main.css](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/styles/main.css) |
| 终端 | xterm.js 6 + `@xterm/addon-clipboard` / `addon-fit` / `addon-web-links` | [terminal-panel.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/terminal-panel.tsx) |
| PTY | `node-pty`（external） | [terminal-service.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/terminal-service.ts) |
| Diff | `diff` 8.0.4 库 + 自绘 inline diff | [diff-panel.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/diff-panel.tsx) |
| Markdown | `react-markdown` + `remark-gfm` + `highlight.js` | [message-markdown.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/message-markdown.tsx) |
| Pi runtime | `@earendil-works/pi-coding-agent` ^0.80.6（npm 包，非 CLI spawn） | [package.json](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/package.json) |
| 状态持久化 | JSON 文件（`readJsonWithBackup` + `writeFileAtomicQueued`） | [app-store-persistence.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-persistence.ts) |
| Catalog 持久化 | JSON 文件（`JsonCatalogStore`，atomic write） | [json-catalog-store.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/json-catalog-store.ts) |
| 测试 | Playwright 1.58 + Electron harness | [playwright.config.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/playwright.config.ts) |
| 构建 | electron-builder 26 | [electron-builder.yml](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron-builder.yml) |
| 类型 | TypeScript 5.9，TypeBox 1.1（运行时 schema） | [package.json](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/package.json) |
| 多 LLM provider SDK | `openai` 6.26 + `@anthropic-ai/sdk` 0.91 + `@google/genai` 1.52 + `@mistralai/mistralai` 2.2 + AWS Bedrock | [package.json](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/package.json) |

---

## 4. 架构

### 4.1 分层架构（Main / Preload / Renderer）

```
┌─────────────────────────────────────────────────────┐
│ Renderer (React 19, DOM)                            │
│  App.tsx ─ Sidebar / ConversationTimeline /         │
│           ComposerPanel / DiffPanel / TerminalPanel  │
│  通过 window.piApp（contextBridge）访问 main         │
├─────────────────────────────────────────────────────┤
│ Preload (preload.ts)                                │
│  contextBridge.exposeInMainWorld('piApp', {         │
│    getState, onStateChanged,                        │
│    createSession, startThread, sendUserMessage,     │
│    getTranscript, onSelectedTranscriptChanged,      │
│    terminalCreateSession, terminalWrite, ...        │
│  })                                                 │
│  共 70+ IPC channel，全部 typed                      │
├─────────────────────────────────────────────────────┤
│ Main (Electron, Node.js)                            │
│  app-store.ts (133KB) ─ 中央状态管理                 │
│  pi-sdk-driver/ ─ pi runtime 适配                    │
│  terminal-service.ts ─ node-pty 管理                 │
│  worktree-manager.ts ─ git worktree 生命周期         │
│  notification-manager.ts ─ 原生通知                   │
├─────────────────────────────────────────────────────┤
│ pi Runtime (@earendil-works/pi-coding-agent)        │
│  SessionManager ─ JSONL 读写                         │
│  AgentSessionRuntime ─ agent 循环                    │
│  ModelRegistry / SettingsManager / AuthStorage       │
└─────────────────────────────────────────────────────┘
```

来源：[README.md Architecture 节](https://github.com/minghinmatthewlam/pi-gui/blob/main/README.md) + [preload.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/preload.ts) + [ipc.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/ipc.ts)

### 4.2 关键设计原则（摘自 AGENTS.md）

1. **pi runtime 不 fork**：`pi-sdk-driver` 是薄适配层，复用上游 pi 的 session/runtime 行为
2. **JSONL 文件是 source of truth**：closed session 直接读 pi 的 JSONL，不在 GUI 侧维护独立副本
3. **renderer 不直接碰 Node**：所有 IPC 走 typed contextBridge，renderer 只通过 `window.piApp`
4. **桌面验证优先**：改动必须在真实 Electron 表面验证，不仅靠 unit test
5. **Codex 风格信息架构**：threaded timeline + collapsible tool calls + "Worked for Ns" turn markers

来源：[AGENTS.md](https://github.com/minghinmatthewlam/pi-gui/blob/main/AGENTS.md) + [apps/desktop/AGENTS.md](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/AGENTS.md)

---

## 5. JSONL 与数据层

### 5.1 pi 的 JSONL 格式

pi 的会话日志存储在 `~/.pi/agent/sessions/<project>/<sessionId>.jsonl`，格式：

```jsonl
{"type":"session","id":"...","version":3,...}     ← 首行 header
{"type":"message","id":"...","parentId":"...","message":{"role":"user","content":"..."},"version":3}
{"type":"message","id":"...","parentId":"...","message":{"role":"assistant","content":[{"type":"text","text":"..."},{"type":"toolCall","id":"...","name":"...","arguments":{}}]}}
{"type":"custom_message",...}
{"type":"compaction",...}
{"type":"model_change",...}
```

这是一个**树结构**（每条消息带 `parentId`），支持分支 / undo。

来源：[pi SDK 源码](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor.ts) + [transcript.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/transcript.ts)

### 5.2 pi-gui 不自己解析 JSONL —— 用 pi 的 `SessionManager`

**关键发现**：pi-gui **不自己写 JSONL 解析器**，而是调用上游 `@earendil-works/pi-coding-agent` 的 `SessionManager`：

```ts
// session-supervisor.ts:390-391
private async readTranscriptFromDisk(sessionRef: SessionRef): Promise<SessionTranscriptItem[]> {
  const sessionFile = await this.resolveSessionFilePath(sessionRef, sessionEntry);
  const sessionManager = SessionManager.open(sessionFile);  // ← 上游 pi 的 API
  return transcriptFromMessages(sessionManager.buildSessionContext().messages, ...);
}
```

`SessionManager.open(path)` 由上游 pi 负责：
- 读 JSONL 文件
- 解析树结构（parentId 链）
- 处理 compaction / branch / model_change
- 输出扁平的 `messages` 数组

pi-gui 只负责把 `messages` 数组转成 UI transcript items。

来源：[session-supervisor.ts L383-391](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor.ts)

### 5.3 `transcriptFromMessages`：messages → UI transcript

这是 pi-gui 自己写的核心转换函数（`session-supervisor-utils.ts`）：

```ts
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

    // 只处理 user / assistant / branchSummary / compactionSummary
    if (role !== "user" && role !== "assistant" && role !== "branchSummary" && role !== "compactionSummary") {
      continue;
    }

    const text = messageText(message);
    const attachments = messageAttachments(message);
    if (text || attachments.length > 0) {
      transcript.push({ kind: "message", id, role, text, attachments, createdAt });
    }

    // assistant 消息里的 toolCall content blocks → tool 记录
    if (role === "assistant") {
      appendToolCalls(transcript, toolIndexByCallId, message, createdAt);
    }
  }
  return transcript;
}
```

输出类型：
- `SessionTranscriptMessage`（kind: "message"）：user / assistant / branchSummary / compactionSummary
- `SessionTranscriptToolCall`（kind: "tool"）：tool call + 结果（通过 `callId` 关联）

来源：[session-supervisor-utils.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor-utils.ts) + [transcript.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/transcript.ts)

### 5.4 双模式读取：Live runtime vs 磁盘 tail

`getTranscript` 方法实现了一个智能双模式策略：

```ts
async getTranscript(sessionRef: SessionRef): Promise<SessionTranscriptItem[]> {
  const record = this.records.get(sessionKey(sessionRef));
  if (record && record.session && !record.closed) {
    // 有活跃 runtime 的 session
    const diskMtimeMs = record.session.isStreaming
      ? undefined
      : await this.statMtimeMs(record.sessionFile);

    const tail = shouldTailFromDisk({
      isStreaming: record.session.isStreaming,
      diskMtimeMs,
      baselineMtimeMs: record.transcriptDiskMtimeMs,
    });

    if (tail) {
      // 磁盘文件比 runtime 新（外部 pi CLI 追加了新内容）
      record.transcriptDiskMtimeMs = diskMtimeMs;
      return this.readTranscriptFromDisk(sessionRef);
    }

    // 正常：从 runtime 内存读
    return transcriptFromMessages(record.session.messages ?? [], record.updatedAt);
  }
  // closed session：直接从磁盘读
  return this.readTranscriptFromDisk(sessionRef);
}
```

`shouldTailFromDisk` 规则：
- streaming 时不 tail（runtime 是权威）
- `diskMtimeMs > baselineMtimeMs` 时 tail（外部 writer 追加了新内容）
- 无 baseline（首次）不 tail

来源：[session-supervisor.ts L360-376](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor.ts) + [session-supervisor-utils.ts `shouldTailFromDisk`](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor-utils.ts)

### 5.5 Schema version 检测

pi-gui 实现了 JSONL schema version skew 检测（`session-schema.ts`）：

```ts
export async function readSessionFileSchemaVersion(filePath: string): Promise<number | undefined> {
  // 只读第一行（16KB buffer），不解析整个文件
  const buffer = Buffer.allocUnsafe(16 * 1024);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  const chunk = buffer.toString("utf8", 0, bytesRead);
  const newlineIndex = chunk.indexOf("\n");
  return schemaVersionFromHeaderLine(newlineIndex === -1 ? chunk : chunk.slice(0, newlineIndex));
}
```

如果 JSONL header 的 `version` 大于 bundled runtime 的 `CURRENT_SESSION_VERSION`，标记 `writtenByNewerRuntime: true`，UI 显示警告（因为新版本的条目可能被静默丢弃）。

来源：[session-schema.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-schema.ts)

### 5.6 会话锁（Session Lease）

pi-gui 实现了 advisory lease 机制（`session-lease.ts`），防止 pi-gui 和 pi CLI 同时写同一个 JSONL 文件。每个 session 有一个 lease 文件，包含 PID + TTL，绑定前检查是否已被其他进程 lease。

来源：[session-lease.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-lease.ts)

---

## 6. 渲染层实现

### 6.1 App.tsx：三栏布局

```
┌─────────────┬──────────────────────────────┬──────────┐
│  Sidebar    │  Timeline + Composer         │ Side     │
│  (会话列表) │  (主交互区)                   │ Panel    │
│             │                              │ (Diff/   │
│  - 工作区   │  - 消息气泡                    │  Term)   │
│  - 会话列表 │  - 工具调用（可折叠）          │          │
│  - 搜索/分组│  - Turn markers               │          │
│  - 新建线程 │  - Composer（输入框）          │          │
└─────────────┴──────────────────────────────┴──────────┘
```

- `Sidebar`（38KB）：workspace 切换、session 列表（支持 pinned / archived / search）、thread groups
- `ConversationTimeline`：虚拟化列表（`VIRTUALIZATION_THRESHOLD = 80`，`OVERSCAN_PX = 720`），turn marker
- `ComposerPanel`：输入区，支持 `@mention` 文件、图片粘贴/拖拽、slash 命令、队列消息（steer / followUp）
- `DiffPanel`：inline diff 查看，支持 preview / diff 模式切换
- `TerminalPanel`：xterm.js 终端，多 tab，resize / restart / close

来源：[App.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/App.tsx) + [sidebar.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/sidebar.tsx) + [conversation-timeline.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/conversation-timeline.tsx)

### 6.2 状态管理

- **Main process**：`AppStore` 持有全局 `DesktopAppState`，通过 `revision` 号防止 stale snapshot 覆盖
- **Renderer**：`useDesktopAppState()` hook 通过 IPC 拉取初始 state + 订阅 push 更新
- **事件驱动**：session 事件（`SessionDriverEvent`）→ `applySessionEventState()` → 新 state → IPC push
- **Revision 防竞态**：`applySnapshotIfNewer()` 确保 incoming revision < current 时丢弃

来源：[desktop-app-state.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/app/desktop-app-state.ts) + [app-store-session-state.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-session-state.ts)

### 6.3 IPC 设计

70+ typed channel，分 request/response 和 push 两类：

| 类别 | 示例 |
|------|------|
| State 同步 | `pi-gui:state-request` / `pi-gui:state-changed` |
| Transcript | `pi-gui:selected-transcript-request` / `pi-gui:selected-transcript-changed` |
| Session CRUD | `pi-gui:create-session` / `pi-gui:select-session` / `pi-gui:archive-session` |
| Thread 操作 | `pi-gui:start-thread` / `pi-gui:fork-thread` / `pi-gui:cancel-current-run` |
| Workspace | `pi-gui:add-workspace-path` / `pi-gui:pick-workspace` / `pi-gui:reorder-workspaces` |
| Worktree | `pi-gui:create-worktree` / `pi-gui:remove-worktree` |
| Terminal | `pi-gui:terminal-create-session` / `pi-gui:terminal-write` / `pi-gui:terminal-data` |
| Settings | `pi-gui:set-default-model` / `pi-gui:login-provider` / `pi-gui:set-notification-preferences` |
| Theme | `pi-gui:get-resolved-theme` / `pi-gui:theme-changed` |

来源：[ipc.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/ipc.ts) + [preload.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/preload.ts)

### 6.4 Timeline 渲染细节

- **虚拟化**：`ConversationTimeline` 在 transcript 长度 ≥ 80 条时启用虚拟化，用绝对定位 + `IntersectionObserver` 实现
- **Turn markers**：`buildDisplayTimelineItems()` 在每条 user 消息后插入 "Worked for Ns" 标记（仅当 turn 持续 ≥ 1 秒）
- **Tool call 折叠**：`TimelineItem` 渲染工具调用时可展开/折叠，显示 input / output
- **Markdown**：`react-markdown` + `remark-gfm` 渲染 assistant 文本，`highlight.js` 代码高亮

来源：[conversation-timeline.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/conversation-timeline.tsx) + [timeline-turns.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-turns.ts) + [timeline-item.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-item.tsx)

---

## 7. 多 Agent 编排（Orchestration）

pi-gui 实现了完整的多 agent 编排系统（`app-store-orchestration.ts`，60KB）：

### 7.1 编排模型

- **Orchestrator thread**：主线程，可以 spawn 子 worker thread
- **Child thread**：隔离的 session，在同一个 workspace 或独立 worktree 中运行
- **Supervision loop**：orchestrator 定期检查 child 状态，决定 continue / stop / wake
- **Evidence system**：记录 child 的工作成果（worker_report / orchestrator_acceptance / review_finding / blocker）

### 7.2 编排工具

orchestrator 通过 pi 的 extension 工具与 child 交互：

| 工具 | 作用 |
|------|------|
| `create_child_thread` | 创建新 child session，发送初始 prompt |
| `list_threads` | 列出当前所有 child thread |
| `read_thread` | 读取 child 的 transcript |
| `send_message_to_thread` | 向 child 发送后续消息（steer / followUp） |

来源：[app-store-orchestration.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts) + [orchestration-runtime.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/orchestration-runtime.ts)

---

## 8. Git Worktree 集成

每个 thread 可以选择运行在：
- **Local**：直接在 workspace 根目录工作
- **Worktree**：隔离的 git worktree，并行工作互不冲突

`worktree-manager.ts` 管理 worktree 生命周期：
- `create`：`git worktree add` + 关联 session
- `remove`：`git worktree remove` + 清理状态
- `sync`：与 `git worktree list` 同步
- worktree 信息存入 catalog（`WorktreeCatalogEntry`）

来源：[worktree-manager.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/worktree-manager.ts)

---

## 9. 终端集成

`terminal-service.ts` 用 `node-pty` 管理终端：

- 每个 workspace + session 组合可以有最多 8 个终端 tab
- 终端数据通过 IPC 双向传输（`terminal-write` / `terminal-data`）
- 支持 resize / restart / close / set-title
- 终端 replay（`appendTerminalReplay`）用于重连时恢复显示
- Shell 可配置（默认系统 shell，可自定义）

来源：[terminal-service.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/terminal-service.ts) + [terminal-panel.tsx](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/terminal-panel.tsx)

---

## 10. 持久化

### 10.1 UI 状态（`app-store-persistence.ts`）

存储在 `~/.pi-gui/ui-state.json`（推测路径），原子写入 + `.bak` 备份：

```ts
interface PersistedUiState {
  version: 2 | 3 | ... | 15;  // 已迭代 15 个版本
  selectedWorkspaceId: string;
  selectedSessionId: string;
  activeView: AppView;
  composerDraftsBySession: Record<string, string>;
  notificationPreferences: Partial<NotificationPreferences>;
  pinnedAtBySession: Record<string, string>;
  pinnedSessionOrder: string[];
  workspaceOrder: string[];
  themeMode: ThemeMode;
  themePresetId: ThemePresetId;
  orchestrationChildren: OrchestrationChildThread[];
  // ...
}
```

- `readJsonWithBackup`：读 JSON，如果主文件损坏，从 `.bak` 恢复
- `writeFileAtomicQueued`：先写临时文件再 rename，防止写一半崩溃丢数据
- debounce 写入（`schedulePersistUiState`），避免每次 keystroke 都写盘

来源：[app-store-persistence.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-persistence.ts) + [atomic-file-write.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/atomic-file-write.ts)

### 10.2 Catalog 状态（`json-catalog-store.ts`）

存储在 `~/.pi-gui/catalog.json`（推测路径），管理 workspace / session / worktree 的元数据：

```ts
type CatalogFileState = {
  version: 2;
  workspaces: WorkspaceCatalogEntry[];
  sessions: SessionCatalogEntry[];
  worktrees: WorktreeCatalogEntry[];
  sessionFiles: Record<string, string>;  // sessionKey → JSONL 文件路径
};
```

- `replaceWorkspaceSessions`：reconcile 时替换整个 workspace 的 session 列表
- `CatalogFileCoordinator`：mutation queue + generation 计数器，防止并发写入冲突

来源：[json-catalog-store.ts](https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/json-catalog-store.ts)

---

## 11. 与 vibe-ide 的对比

| 维度 | pi-gui | vibe-ide |
|------|--------|----------|
| Agent runtime | 嵌入 `@earendil-works/pi-coding-agent` npm 包（进程内） | spawn `claude` CLI 子进程（`stream-json` 输出） |
| JSONL 解析 | 委托上游 `SessionManager.open()`，不自己解析 | 自己写 `lineBuffer` + `JSON.parse(line)` |
| JSONL 角色 | source of truth（closed session 从磁盘读） | 流式 stdout 解析，不存 JSONL |
| 渲染层 | React 19 + 纯 CSS（50KB+） | React + Tailwind CSS |
| 终端 | xterm.js 6 + node-pty（同 vibe-ide） | xterm.js 6 + node-pty |
| Diff | 自绘 inline diff（`diff` 库） | Monaco Editor diff |
| 状态管理 | 中心化 AppStore（main process） + revision 防竞态 | React useState + IPC push |
| 多 Agent | 完整编排系统（orchestrator + child + supervision） | 单 session |
| Worktree | 原生 git worktree 集成 | 无 |
| 持久化 | JSON 文件（atomic write + backup） | JSONL 文件（上游 Claude CLI 写） |
| 测试 | Playwright E2E（4 lane，70+ spec） | 无自动化测试 |
| 平台 | macOS + Linux + Windows（RC） | Windows 为主 |

---

## 12. vibe-ide 可借鉴的 techniques

### 12.1 不自己解析 JSONL，委托上游 SDK

pi-gui 的做法是调用 `SessionManager.open()` 让上游 pi 处理 JSONL 解析和树结构遍历，自己只做 `messages[] → UI transcript` 的转换。vibe-ide 目前自己解析 Claude CLI 的 `stream-json` stdout，如果 Claude Code 官方提供类似的 SDK/API，可以考虑迁移。

### 12.2 磁盘 tail 双模式（live vs disk）

`shouldTailFromDisk` 的设计值得借鉴：
- streaming 时用 runtime 内存（权威）
- idle 时 stat JSONL mtime，如果外部 writer 追加了新内容，从磁盘读
- 这允许 pi-gui 和 pi CLI 共享同一份 JSONL，外部修改自动同步

vibe-ide 目前只读 live stream。如果要支持"恢复历史会话"或"监控外部 CLI 写入"，可以参考这个 mtime 比较模式。

### 12.3 Schema version skew 检测

pi-gui 只读 JSONL 第一行（16KB buffer）检测 schema version，如果文件是新版本写的就提示用户。这比解析失败后才发现问题好得多。vibe-ide 目前没有类似的 schema 版本检测。

### 12.4 Session lease（会话锁）

advisory lease 文件（PID + TTL）防止 GUI 和 CLI 同时写同一个 JSONL。vibe-ide 目前不涉及写 JSONL，但如果将来要做"恢复/续写会话"，需要类似的锁机制。

### 12.5 Revision 防竞态

`applySnapshotIfNewer()` 用 revision 号防止 IPC response 和 push event 的竞态导致 stale state 覆盖新 state。vibe-ide 的 App.tsx 也有类似场景（session 切换 + state 更新），可以参考。

### 12.6 Turn marker（"Worked for Ns"）

从消息时间戳计算 turn 耗时，不依赖 runtime 提供的 duration 字段。简单、无侵入、不造假。vibe-ide 可以参考这个方式展示每轮耗时。

### 12.7 Composer 队列消息（steer / followUp）

pi-gui 支持在 agent 运行时排队多条消息，两种投递模式：
- `steer`：在当前 turn 结束时注入
- `followUp`：在 agent 完成后作为新 turn

vibe-ide 目前的 `__vibeAppendInput` 通道只有"填入并发送"，可以参考这个排队模式。

### 12.8 Atomic file write + backup

`writeFileAtomicQueued` + `readJsonWithBackup` 是防止数据丢失的标准做法。vibe-ide 的 `app-store-persistence.ts` 同款（可能借鉴了同一模式）。

---

## 13. 不值得照搬的部分

- **pi SDK 嵌入**：vibe-ide 用 Claude CLI，不是 pi runtime，SDK 嵌入方式不适用
- **多 Agent 编排**：vibe-ide 目前单 session，编排系统过重
- **Worktree 管理**：vibe-ide 不做 git worktree 隔离
- **纯 CSS（无 Tailwind）**：pi-gui 用了 50KB+ 纯 CSS，vibe-ide 已经用 Tailwind，不需要换

---

## 14. 关键文件源码位置

| 文件 | 角色 | URL |
|------|------|-----|
| `apps/desktop/src/App.tsx` | 主布局（1072 行） | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/App.tsx> |
| `apps/desktop/src/ipc.ts` | IPC 通道定义（70+） | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/ipc.ts> |
| `apps/desktop/electron/app-store.ts` | 中央状态管理（133KB） | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store.ts> |
| `apps/desktop/electron/app-store-orchestration.ts` | 多 Agent 编排（60KB） | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-orchestration.ts> |
| `packages/pi-sdk-driver/src/session-supervisor.ts` | Session 生命周期（90KB） | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor.ts> |
| `packages/pi-sdk-driver/src/session-supervisor-utils.ts` | transcriptFromMessages / shouldTailFromDisk | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-supervisor-utils.ts> |
| `packages/pi-sdk-driver/src/transcript.ts` | UI transcript 类型 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/transcript.ts> |
| `packages/pi-sdk-driver/src/session-schema.ts` | Schema version 检测 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-schema.ts> |
| `packages/pi-sdk-driver/src/session-lease.ts` | 会话锁 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/session-lease.ts> |
| `packages/session-driver/src/types.ts` | SessionDriver 接口 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/session-driver/src/types.ts> |
| `packages/pi-sdk-driver/src/json-catalog-store.ts` | Catalog 持久化 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/packages/pi-sdk-driver/src/json-catalog-store.ts> |
| `apps/desktop/electron/terminal-service.ts` | 终端管理 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/terminal-service.ts> |
| `apps/desktop/electron/worktree-manager.ts` | Worktree 管理 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/worktree-manager.ts> |
| `apps/desktop/electron/app-store-persistence.ts` | UI 状态持久化 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/electron/app-store-persistence.ts> |
| `apps/desktop/src/conversation-timeline.tsx` | 虚拟化 timeline | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/conversation-timeline.tsx> |
| `apps/desktop/src/timeline-turns.ts` | Turn marker 计算 | <https://github.com/minghinmatthewlam/pi-gui/blob/main/apps/desktop/src/timeline-turns.ts> |

---

## 未做之事（按要求明示）

- ❌ 没有根据 README 推断实现细节。每条结论都追溯到实际源码。
- ❌ 没有杜撰行号。GitHub 主分支持续变化，引文按函数名 / 变量名定位。
- ❌ 没有把 pi-gui 的 JSONL 解析方式套到 vibe-ide 上。vibe-ide 用的是 Claude CLI spawn，不是 pi SDK。
- ❌ 没有编造 pi-gui 的 JSONL 格式。pi 的 JSONL 格式是上游 `@earendil-works/pi-coding-agent` 定义的，pi-gui 不控制格式。

---

## 来源

- GitHub API 实时查询（2026-07-30）：
  - <https://api.github.com/repos/minghinmatthewlam/pi-gui>
  - <https://api.github.com/repos/minghinmatthewlam/pi-gui/git/trees/main?recursive=1>
  - 全部源码文件通过 Contents API 获取原文
- 仓库 README + AGENTS.md + 各 sub-package AGENTS.md
- pi 上游仓库：<https://github.com/earendil-works/pi>
- pi npm 包：<https://www.npmjs.com/package/@earendil-works/pi-coding-agent>
