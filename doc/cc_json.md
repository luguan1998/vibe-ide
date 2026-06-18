现在我有了非常全面的信息，下面给你做一个系统性的技术总结。

---

## VS Code 里 Claude Code GUI 的核心技术实现

### 一、CLI JSON 输出：`--print` + `--output-format stream-json`

VS Code 扩展通过 **子进程 (subprocess)** 方式启动 Claude Code CLI，核心命令：

```bash
claude -p "用户提示" --output-format stream-json --verbose --include-partial-messages
```

**三种输出格式：**

| 格式          | 行为                                          | 用途               |
| ------------- | --------------------------------------------- | ------------------ |
| `text`        | 纯文本，一次性输出                            | 简单脚本           |
| `json`        | 单个 JSON 对象（含 result、session_id、cost） | 程序化调用、CI     |
| `stream-json` | **逐行 JSON 事件流**                          | IDE 集成、实时 GUI |

**`stream-json` 事件类型：**

- `system/init` — 会话元数据（model、tools、MCP servers、plugins），流的第一个事件
- `stream_event` + `event.delta.type == "text_delta"` — 文本增量 token
- `system/api_retry` — API 重试事件（含 attempt、retry_delay_ms、error 等）
- `system/plugin_install` — 插件安装进度
- 工具调用事件 — 包括 `ExitPlanMode` 的 tool_use 也会作为流事件出现

**VS Code 扩展架构：**
```
VS Code Extension
    └── spawn("claude", ["-p", prompt, "--output-format", "stream-json", "--verbose"])
        └── stdout 逐行解析 JSON
            └── 渲染到 Webview（diff viewer、plan 预览 tab、工具调用 UI）
```

每行 stdout 都是一个可解析的 JSON 事件，扩展侧只需 `JSON.parse(line)` 即可驱动 UI。

---

### 二、Plan 模式：`EnterPlanMode` / `ExitPlanMode` 工具定义

#### 工具 JSON Schema

**EnterPlanMode** — 无参数，纯状态切换：
```json
{
  "name": "EnterPlanMode",
  "description": "Use this tool proactively when you're about to start a non-trivial implementation task...",
  "input_schema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  }
}
```

**ExitPlanMode** — 带 `allowedPrompts` 参数（请求实现阶段需要的权限）：
```json
{
  "name": "ExitPlanMode",
  "input_schema": {
    "type": "object",
    "properties": {
      "allowedPrompts": {
        "description": "Prompt-based permissions needed for implementation",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "tool": { "type": "string", "description": "The tool this prompt applies to" },
            "prompt": { "type": "string", "description": "Semantic description of the allowed action" }
          }
        }
      }
    }
  }
}
```

示例调用：
```js
ExitPlanMode({ allowedPrompts: [{ tool: "Bash", prompt: "run tests" }] })
```

#### 状态机（四状态变量）

```typescript
prePlanMode: PermissionMode | null  // 进入前的权限模式（用于恢复）
planFilePath: string | null         // 计划文件路径 ~/.claude/plans/plan-{sessionId}.md
baseSystemPrompt: string            // 不含 plan 注入的基础 system prompt
contextCleared: boolean             // 审批时是否清除了上下文
```

**状态转换图：**
```
[当前模式] ──EnterPlanMode──▶ [plan 模式(只读)]
     ▲                             │
     │                        探索代码 + 写 plan 文件
     │                             │
     │                       ExitPlanMode
     │                             │
     │               ┌─────────────┼─────────────┐
     │               ▼             ▼             ▼
     │        [clear+execute]  [execute]   [keep-planning]
     │         清上下文+执行   保留上下文    用户反馈修改
     │         →acceptEdits   →acceptEdits   →留 plan 模式
     └──────────────────────────────────────────┘
```

#### 双重保障架构

1. **Prompt 层**：注入 plan mode system prompt，引导模型不做写操作
2. **Permission 代码层**：`checkPermission()` 硬拦截，除 plan 文件外所有写操作直接 deny

```typescript
if (mode === "plan") {
  if (EDIT_TOOLS.has(toolName)) {
    if (filePath === planFilePath) return { action: "allow" };  // 唯一例外
    return { action: "deny", message: `Blocked in plan mode` };
  }
  if (toolName === "run_shell") return { action: "deny" };
}
```

---

### 三、多方案确认：审批回调 + 四选项

`ExitPlanMode` 执行时触发 `planApprovalFn` 回调，GUI 侧渲染 plan 内容并提供四个选项：

| 选项                   | 权限转换             | 上下文   | 场景                                  |
| ---------------------- | -------------------- | -------- | ------------------------------------- |
| **1. Clear + Execute** | → `acceptEdits`      | **清除** | plan 可靠，上下文已长，重新开始最高效 |
| **2. Execute**         | → `acceptEdits`      | **保留** | plan 可靠，Agent 已有足够上下文       |
| **3. Manual**          | → 恢复 `prePlanMode` | **保留** | 方向 OK，但用户想逐个审批编辑         |
| **4. Keep Planning**   | 留 `plan` 模式       | **保留** | plan 需要修改，用户提供反馈           |

**关键实现：回调注入模式解耦 UI**

```typescript
// CLI 侧用 readline
agent.setPlanApprovalFn((planContent) => {
  return new Promise((resolve) => {
    printPlanForApproval(planContent);
    rl.question("Enter choice (1-4): ", (answer) => {
      if (answer === "1") resolve({ choice: "clear-and-execute" });
      if (answer === "4") {
        rl.question("Feedback: ", (feedback) => {
          resolve({ choice: "keep-planning", feedback });
        });
      }
      // ...
    });
  });
});

// VS Code 扩展侧：替换为 Webview GUI 对话框
// 子 Agent 没有回调时直接退出 plan mode
```

VS Code 扩展把 `planApprovalFn` 替换为 Webview 弹窗，在 `stream-json` 事件流中检测到 `ExitPlanMode` tool_use 事件后，展示 plan 预览 tab（标题用 plan 的 heading），用户点按钮返回选择结果。

---

### 四、Plan 退出后防反复 Read：`clear-and-execute` + plan 文件持久化

**核心问题：** Plan 阶段探索了大量文件，上下文很长。执行阶段如果保留这些上下文，模型可能反复 Read 已经读过的文件。

**解决方案：`clear-and-execute` 选项（选项 1）**

```typescript
if (result.choice === "clear-and-execute") {
    this.clearHistoryKeepSystem();     // 清除所有对话消息，保留 system prompt
    this.contextCleared = true;
    // plan 文件仍在磁盘上 ~/.claude/plans/plan-{sessionId}.md
    // tool result 中重新注入完整 plan 内容
    return `User approved the plan. Context was cleared.\n\n` +
      `Plan file: ${savedPlanPath}\n\n` +
      `## Approved Plan:\n${planContent}\n\n` +
      `Proceed with implementation.`;
}
```

**为什么 plan 文件写到磁盘而不是只存在上下文中：**
1. `clearHistoryKeepSystem()` 清除上下文后，plan 内容通过磁盘文件存活
2. Agent 可以在执行阶段按需 `Read` plan 文件，而不是依赖上下文中的历史
3. `--resume` 恢复会话时也能从磁盘恢复 plan

---

### 五、上下文压缩：五层 Pipeline

Claude Code 使用五层递进式压缩策略，每次 model call 前按顺序执行：

| 层  | 名称                                           | 成本 | 作用                                                                   |
| --- | ---------------------------------------------- | ---- | ---------------------------------------------------------------------- |
| 1   | **Budget Reduction** (`applyToolResultBudget`) | 最低 | 单条 tool result 超大小限制时替换为内容引用                            |
| 2   | **Snip** (`snipCompactIfNeeded`)               | 低   | 轻量裁剪旧历史段，返回 `{messages, tokensFreed}`                       |
| 3   | **Microcompact**                               | 中低 | 细粒度压缩，支持 cache-aware 路径（利用 `cache_deleted_input_tokens`） |
| 4   | **Context Collapse** (`CONTEXT_COLLAPSE`)      | 中   | **读时投影**，不改存储历史，替换查询消息数组                           |
| 5   | **Auto-Compact** (`compactConversation`)       | 高   | 完整模型生成摘要，触发 `PreCompact/PostCompact` hooks                  |

**每层只在前面不够用时才触发**——越靠后成本越高。

**Auto-Compact 的详细流程：**
1. 触发 `PreCompact` hook（可被 hook 阻止）
2. 用 Sonnet 模型生成结构化摘要，包含：Primary Request、Key Technical Concepts、Files and Code Sections（保留完整代码片段）、Errors and Fixes、All User Messages、Pending Tasks、Current Work
3. 模型先在 `<analysis>` 标签内分析，再输出 `<summary>`
4. `buildPostCompactMessages()` 用摘要重建消息列表
5. 触发 `PostCompact` hook

**Sub-agent 隔离防膨胀：**
- `Agent` tool 启动子 agent 时，上下文完全隔离
- 子 agent 只返回 **summary 文本** 给父 agent
- 完整对话存在 **sidechain JSONL 文件** 中，不污染父 agent 上下文

**已知 Bug（Plan 模式 × 上下文压缩）：**
- [#26061](https://github.com/anthropics/claude-code/issues/26061)：压缩后模型丢失"plan 已审批"的状态，再次提示用户
- [#29956](https://github.com/anthropics/claude-code/issues/29956)：自动压缩后意外重新进入 plan 模式

---

### 六、Deferred Tool（延迟加载）节省上下文

`EnterPlanMode` 和 `ExitPlanMode` 都标记为 `deferred: true`。当 `ToolSearch` 功能启用时：

1. System prompt 中只发送工具 **名称**（不含完整 schema）
2. 模型需要时才请求完整 schema
3. 大部分会话不需要 plan mode，这样节省了 ~4300 token 的 prompt 预算

---

### 总结架构图

```
VS Code Extension (Webview GUI)
    │
    ├── spawn CLI: claude -p "..." --output-format stream-json --verbose
    │       │
    │       └── queryLoop() (AsyncGenerator)
    │           ├── Context Assembly (system prompt + CLAUDE.md + user context)
    │           ├── 5-layer Compaction Pipeline (budget→snip→micro→collapse→auto)
    │           ├── Model Call (streaming)
    │           ├── Tool Dispatch (StreamingToolExecutor)
    │           │   ├── Permission Gate (deny-first + hooks + ML classifier)
    │           │   ├── Plan Mode Check (双重保障: prompt + code)
    │           │   └── Execute Tool → tool_result
    │           └── Stop Condition (no tool_use / max turns / overflow)
    │
    └── Parse stream-json events → Render UI
        ├── text_delta → 流式文本渲染
        ├── tool_use (ExitPlanMode) → Plan 预览 Tab + 4选项审批 UI
        ├── system/api_retry → 重试进度提示
        └── 最终结果 → Diff Viewer / Inline Edit
```

Sources:
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [Dive into Claude Code (arXiv paper)](https://arxiv.org/html/2604.14228v1)
- [What Actually Is Claude Code's Plan Mode?](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [claude-code-from-scratch: Plan Mode](https://github.com/Windy3f3f3f3f/claude-code-from-scratch/blob/main/docs/10-plan-mode.md)
- [Tracing Claude Code's LLM Traffic](https://medium.com/@georgesung/tracing-claude-codes-llm-traffic-agentic-loop-sub-agents-tool-use-prompts-7796941806f5)
- [Claude Code System Prompt (Gist)](https://gist.github.com/iohub/6311c090fc7b852ee8d52e5b1b4b301c)
- [Plan mode state lost after compression #26061](https://github.com/anthropics/claude-code/issues/26061)
- [Context auto-compaction re-enters plan mode #29956](https://github.com/anthropics/claude-code/issues/29956)
- [CLASP Tool Reference](https://github.com/jedarden/CLASP/blob/main/docs/api-reference/claude-code-tools.md)
- [Implementing Plan Mode in Your Own Agent](https://yag.xyz/en/post/ai-agent-plan-mode-example/)
- [Peeking Into Claude Code](https://web.navan.dev/posts/2026-02-24-peeking-into-claude-code.html)
- [Claude Code Headless Guide](https://amux.io/guides/claude-code-headless/)
- [A Brief Analysis of Claude Code's Execution](https://weaxsey.org/en/articles/2025-10-12/)