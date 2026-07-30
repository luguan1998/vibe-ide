# Trajex JSONL 解析源码调研

> 目标：深读 `wutongyuonce/Trajex` 的实际源码，提炼它解析 Claude Code / Codex / Kimi Code / pi 的 JSONL 会话日志的 techniques，给 vibe-ide 参考借鉴。
>
> 调研日期：2026-07-30。全部引文来自 GitHub 主分支 `main` 的原始文件，非 README 二次描述。

---

## 1. 仓库概况

- **仓库**：<https://github.com/wutongyuonce/Trajex>
- **确认存在**：API `api.github.com/repos/wutongyuonce/Trajex/git/trees/main?recursive=1` 正常返回，commit SHA `dee045e7`，文件树完整。
- **语言**：TypeScript（ESM，`.ts` 文件直接 import `.ts`，走 Node 22 的 TS 支持或编译）。
- **结构**：
  - `packages/core/` — 与 UI 解耦的纯解析 / 持久化核心（CLI 与 Electron App 共用）。
  - `packages/cli/` — 命令行入口（`trajex.ts`）。
  - `app/` — Electron 桌面应用（Vite + Vue），包含 session 展示、活动账本、recap 等。
  - `tests/` — 大量 `.test.mjs`，覆盖每种 provider 的解析器（`claude-parse.test.mjs` / `codex-parse.test.mjs` / `kimi-parse.test.mjs` / `pi-parse.test.mjs`）。
- **核心依赖**：`node:sqlite`（CLI）/ `better-sqlite3`（App），共享同一套 `prepare/run/get` 接口。

---

## 2. Trajex 处理的 JSONL 格式

Trajex 抽象出 `ProviderAdapter` 接口，每种 AI CLI 是一个 provider。四个 provider 的文件目录与日志形态：

| Provider | 根目录 | JSONL 路径模式 | 顶层字段 |
|----------|--------|----------------|----------|
| `claude` | `~/.claude` | `projects/<project-slug>/<sessionId>.jsonl`；subagent 在 `projects/<slug>/<sessionId>/subagents/<agentId>.jsonl`；workflow 在 `subagents/workflows/<runId>/<agentId>.jsonl` | `{type:'user'\|'assistant'\|'system', uuid, parentUuid, timestamp, message:{role,content,usage}, gitBranch, version, cwd, ...}` |
| `codex` | `~/.codex` | `sessions/<date-subdirs>/<threadId>.jsonl`（按日期分层，递归枚举） | `{type:'session_meta'\|'event_msg'\|'response_item'\|'turn_context', payload:{...}}` |
| `kimi` | `~/.kimi-code/sessions` | `<workspace>/<session>/agents/<agentId>/wire.jsonl`（main + 子 agent 各一个文件） | `{type:'context.append_message'\|'context.append_loop_event'\|'context.undo'\|..., time, event:{...}}` |
| `pi` | `~/.pi/agent/sessions` | `<project>/<sessionId>.jsonl` | `{type:'session'\|'message'\|'custom_message'\|'compaction'\|'model_change', id, parentId, message:{role,content,usage}, version}` |

**Claude 子 agent 与 workflow 分层**：`discoverJsonlFiles` 遍历 `projects/` 时，除识别主 `.jsonl` 外，还会递归进入 `<sessionId>/subagents/` 与 `subagents/workflows/<runId>/`，产出 `ClaudeJsonlFile` 并带上 `isSubagent` / `agentId` / `workflowRunId`（见 `parsing.ts` `discoverJsonlFiles`）。vibe-ide 目前只读主 JSONL，未索引 subagent / workflow 文件。

**Codex 的 guardian thread 检测**：`readCodexGuardianThreadInfo` 预读头几行，根据 `payload.source.subagent.other === 'guardian'` 或模型名 `codex-auto-review` 判断是否 auto-review thread，若是则 `parse()` 第一行 yield `{kind:'delete-session'}`，由 persist 级联删除（见 `codex.ts` `parse()`）。

---

## 3. 读取策略（行缓冲 / 流式 / 容错）

### 3.1 `readLines`：固定 64 KB buffer 的同步流式行读

核心位于 `packages/core/src/parsing.ts` 的 `readLines`：

```ts
function readLines(filePath: string, callback: (line: string) => boolean | void): void {
  const fd = fs.openSync(filePath, 'r');
  const bufSize = 64 * 1024;
  const buf = Buffer.alloc(bufSize);
  let remainder = '';
  let bytesRead;
  try {
    while ((bytesRead = fs.readSync(fd, buf, 0, bufSize)) > 0) {
      const chunk = remainder + buf.toString('utf8', 0, bytesRead);
      const lines = chunk.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line && callback(line) === false) return;
      }
    }
    if (remainder) callback(remainder);
  } finally {
    fs.closeSync(fd);
  }
}
```

关键特性：
- **同步 `fs.readSync`** + 固定 buffer，避免一次性读整个大文件进内存。
- **跨 chunk 行连续**：未闭合的行留在 `remainder` 里，下一轮 buffer 拼接继续。
- **callback 返回 `false` 提前终止**：用于「找到 session_meta 即停」、「找到 guardian 标记即停」等场景。
- **空行过滤**：`if (line && ...)` 跳过空行。
- **末尾 remainder 也回调**：处理不以 `\n` 结尾的文件。

Claude / Codex 两个 provider 都走 `readLines`。Pi 与 Kimi 走 `fs.readFileSync(...).split('\n')` 一次性全读（Pi 注释说 "Full replay is required because the current Pi transcript is a tree path"，必须全量才能做树路径遍历）。

### 3.2 畸形行 / 截断行的处理

两种策略并存，视 provider 而定：

- **静默跳过**（Claude / Codex，宽容模式）：
  ```ts
  // claude.ts parse()
  readLines(unit.key, (line: string) => {
    lineNum++;
    let obj: any;
    try { obj = JSON.parse(line); } catch { return; }  // ← 解析失败直接 return，继续下一行
    ...
  });
  ```
  Codex 同款：`try { records.push({ lineNum, obj: JSON.parse(line) }); } catch { /* skip malformed */ }`。

- **严格抛错**（Pi / Kimi，末尾除外）：
  ```ts
  // pi.ts parse()
  try { parsed.push(JSON.parse(line)); } catch (error) {
    if (index === lines.length - 1 && !raw.endsWith('\n')) break;  // 末尾不完整行宽容
    throw new Error(`Pi session: corrupted line ${index + 1} in ${unit.key}`, { cause: error });
  }
  ```
  Kimi 的 `readWire` 同款：非末尾的畸形行抛 `corrupted line` 中断索引。

**设计意图**：Claude Code 的 JSONL 是 CLI 流式追加写入，进程崩溃或文件未刷新都可能留下半行，必须宽容。Pi / Kimi 是一次性完整写入的 snapshot，半行意味着文件损坏。

### 3.3 增量恢复 cursor

所有 provider 的 cursor 都编码为 `${mtimeMs}:${linesProcessed}`，存进 SQLite `index_state` 表：

```ts
// claude.ts
function cursorToSkip(cursor: Cursor): number {
  if (!cursor) return 0;
  const n = Number(cursor.split(':')[1]);
  return Number.isFinite(n) ? n : 0;
}
// 在 parse 中：
if (lineNum <= skip) return;  // 跳过 cursor 已消费的行
```

**mtime 比较**：`discover()` 阶段先看 `cursor` 里的 mtime 与 `fs.statSync(path).mtimeMs` 对比，mtime 没变就跳过该文件，连 `parse` 都不调用：

```ts
// claude.ts discoverAt()
const cursor = ctx.lastCursor(file.path);
return historyChanged
  || forcedPaths.has(normalizedPath)
  || cursor === null
  || Number(cursor.split(':')[0]) < fs.statSync(file.path).mtimeMs;
```

**delta vs total 两种计数模式**：Claude 增量 resume，每次 parse 只 yield 新行，persist 做 `message_count += delta`；Codex 全量重放（因为 `event_msg ↔ response_item` 需要双向去重），每次 yield 全量，persist 用本次数覆盖（见 `persist.ts`）。

---

## 4. Claude JSONL 解析的具体细节

### 4.1 行 schema（`packages/core/src/providers/claude.ts` `parse()`）

逐行 `JSON.parse` 后，按 `obj.type` 分发：

| `obj.type` | 处理 |
|------------|------|
| `'user'` / `'assistant'` | 主流程：`extractText(message.content)` 取文本；`extractContentType` 判断 text/thinking/tool_use/tool_result；提取 `tool_use` / `tool_result` 块 |
| `'system'` + `subtype === 'away_summary'` | 产出 `summary` 记录 |
| `'system'` + `subtype === 'turn_duration'` | 产出 `message-turn-duration`（patch 已有消息的 `turn_duration_ms`） |
| `'aiTitle'` (顶层字段 `obj.aiTitle`) | 更新 session 标题 |

字段提取：
- **uuid / parentUuid**：`obj.uuid`、`obj.parentUuid`，构成消息树。
- **文本**：`extractText(message.content)` — 串起 `content` 数组里所有 `text` 和 `thinking` 块。
- **content_type**：`extractContentType` 看 content 数组里块的 type 集合。
- **is_meta**：`extractMessageIsMeta` 用 `COMMAND_ENVELOPE_RE = /^\s*(<command-name>...|<(?:task-notification|system-reminder)\b|<local-command(?:\b|-))/` 判断系统注入的消息；另用 `SKILL_INSTRUCTIONS_RE` 识别 skill 说明并标记 `content_type = 'skill_instructions'`。
- **tool_use**：`if (obj.type === 'assistant' && Array.isArray(msg.content))` 遍历 content，取 `type === 'tool_use'` 的块，`id` 作去重键。
- **tool_result**：`obj.type === 'user'` 时遍历 content 找 `type === 'tool_result'`，用 `b.tool_use_id` 与 tool_use 关联。`b.content` 既可能是 string 也可能是 content 数组。
- **file_path**：仅对 `Read / Edit / Write / NotebookEdit` 取 `input.file_path`。
- **token 计数**：`totalInputTokens(usage)` 把 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` 加起来（Claude 的 cache 命中/创建也要算进输入）。
- **sidechain**：`obj.isSidechain ? 1 : 0`。
- **cwd / model / version / gitBranch**：`obj.cwd` / `msg.model` / `obj.version` / `obj.gitBranch`。
- **skill**：`obj.attributionSkill`。

### 4.2 Subagent 元数据（`.meta.json`）

主 JSONL 解析完后，如果是 subagent 文件，再读同目录的 `<agentId>.meta.json`，提取 `agentType` / `description` / `toolUseId`，产出 `subagent` 或 `workflow_agent` 记录（见 `claude.ts` parse 末尾）。

### 4.3 Workflow JSON

独立于 JSONL 的 `.json` 文件（位于 `<sessionId>/workflows/<runId>.json`）。`parseWorkflow` 读整个 JSON，扫描 `workflowProgress` 数组里 `type === 'workflow_agent'` 的项。`workflowParentToolUseId` 会回头扫描主 transcript，找到主会话里 `name === 'Workflow'` 的 tool_use 块，用 `runId` 匹配，恢复 parent-child 关系。

### 4.4 Session 聚合

解析完所有行后 yield 一条 `session` 记录，`started_at` / `ended_at` 取所有消息时间戳的 min/max，`message_count` 用 user/assistant 计数，`countMode: 'delta'`（增量）。

---

## 5. Codex JSONL 解析的关键技巧

Codex 最复杂，因为它的消息有两种可能重叠的镜像：`event_msg`（高层抽象）和 `response_item`（原始 OpenAI 协议）。

- **双向去重**：
  ```ts
  // codex.ts parse()
  // 第一遍：收集所有可见 event_msg 的 (role, text) key
  const eventMessageKeys = new Set<string>();
  for (const { obj } of records) {
    if (obj?.type !== 'event_msg') continue;
    const payload = obj.payload || {};
    if (payload.type !== 'user_message' && payload.type !== 'agent_message') continue;
    const text = codexEventText(payload);
    if (text === null) continue;
    eventMessageKeys.add(codexVisibleMessageKey(payload.type === 'user_message' ? 'user' : 'assistant', text));
  }
  // 第二遍：response_item 的 message 若 (role, text) 已在 eventMessageKeys 里就丢
  ```
  这是 Codex 必须"全量重放"的根本原因：event_msg 与 response_item 的相对顺序可能错位 ±1 行，必须两遍才能双向去重。

- **Guardian / auto-review thread 过滤**：`readCodexGuardianThreadInfo` 预读头几行，若发现 `payload.source.subagent.other === 'guardian'` 或 `payload.model === 'codex-auto-review'`，`parse()` yield `{kind:'delete-session', sessionId}`，persist 级联删除该 session 所有行。

- **turn_context 事件**：每轮切换 cwd / model 时发出，用 `currentCwd` / `currentModel` 状态变量承接，下一条消息继承。

- **subagent spawn**：`payload.type === 'collab_agent_spawn_end'` 时，用 `codexDbId(payload.new_thread_id)` 给新 thread 命名空间化，作为后续 thread 的 `agentId`，主 thread 用 `codexDbId(parent_thread_id)` 聚合子 agent 消息。

- **token_count 回写上一条 assistant 消息**：Codex 的 token 计数是单独 event，用 `sm.lastTextAssistantUuid` 找到上一条文本 assistant 消息回填 `input_tokens` / `output_tokens`。

---

## 6. Pi JSONL 解析：树结构遍历

Pi 的 transcript 不是线性流，而是一棵由 `parentId` 串起来的树（用户可分支 / undo）。核心技巧：

- **从末尾反向遍历 parentId 找 active 路径**：
  ```ts
  // pi.ts parse()
  const activeIds = new Set<string>();
  let active = entries.at(-1);
  while (active && !activeIds.has(active.id as string)) {
    activeIds.add(active.id as string);
    active = typeof active.parentId === 'string' ? byId.get(active.parentId) : undefined;
  }
  // 后续消息 is_sidechain 标记 = activeIds.has(entry.id) ? 0 : 1
  ```

- **finalMessage 递归查找父链上最后一条可见消息**：用作 `parent_uuid`，把树结构投影为线性 parent_uuid 链。

- **assistant 消息的 content 多块拆分**：每个 `text` / `thinking` / `toolCall` 块单独成 message 记录，用 `suffix = :index` 区分同一 entry 拆出的多条消息的 uuid。

- **header 校验**：第一行必须 `type === 'session' && version === 3 && typeof id === 'string'`，否则整文件丢弃。

---

## 7. Kimi JSONL 解析：wire event replay

Kimi 的 wire 文件是事件流（不是消息流），需要 `projectSession` 把事件投影为消息：

- **多 agent wire 文件**：`listWireFiles` 找 `agents/<agentId>/wire.jsonl` 与 legacy 的 `wire.jsonl`，main agent 优先排序。
- **context.undo 撤回**：按"真实用户消息数"计数，反向 splice 掉消息、对应的 tool_call / tool_result、turn-duration。`injectionMessageUuids` 集合里的是注入消息（skill / plugin），撤回时跳过它们。
- **context.clear**：重置 `undoFloor`，后续 undo 不会撤到更早的消息。
- **context.append_loop_event** 里的 `step.begin` / `content.part` / `tool.call` / `tool.result` / `step.end`：逐步投影成消息与工具记录。`step.end` 时把 usage 回填到 step 的最后一条消息。
- **subagent 关联**：`tool.result` 里若有 `agent_id: <id>` 模式，记录到 `childParentCalls` map，最后生成 subagent 记录时回查。
- **原子性保护**：parse 开始与结束各算一次 cursor，不一致就抛 `Kimi session changed while indexing`，防止索引中途文件被改写。

---

## 8. SQLite 摄入（`persist.ts`）

### 8.1 统一记录流

所有 provider 的 `parse()` 都 yield `TranscriptRecord`，一个 discriminated union，kind 字段取值：

`'session' | 'message' | 'tool_call' | 'tool_result' | 'summary' | 'subagent' | 'workflow' | 'workflow_agent' | 'message-turn-duration' | 'delete-session'`

persist 用 `switch(r.kind)` 分发，每种 record 对应一个 prepared statement：

```ts
// persist.ts statements()
msg: INSERT INTO messages ... ON CONFLICT(uuid) DO UPDATE SET ...
tc:  INSERT OR REPLACE INTO tool_calls ...
tr:  INSERT OR REPLACE INTO tool_results ...
sub: INSERT INTO subagents ... ON CONFLICT(agent_id) DO UPDATE SET
     parent_tool_use_id=COALESCE(excluded.parent_tool_use_id, subagents.parent_tool_use_id), ...
wa:  INSERT INTO workflow_agents ... ON CONFLICT(agent_id) DO UPDATE SET ... COALESCE
turn: UPDATE messages SET turn_duration_ms=? WHERE uuid=?
```

### 8.2 去重与合并

- **message / tool_call / tool_result**：用自然主键（`uuid` / `id` / `tool_use_id`）`ON CONFLICT DO UPDATE`，幂等。
- **session**：`getSession` 先查旧行，`started_at = MIN(prev, new)`，`ended_at = MAX(prev, new)`，`message_count` 根据 `countMode` 累加或覆盖，其他字段 `COALESCE(new, prev)`。
- **subagent / workflow_agent**：两个独立来源可能各贡献一半字段（如 subagent 的 `.meta.json` 提供 `agent_type`，workflow run JSON 提供 `phase/label/model`），用 `COALESCE(excluded.col, table.col)` 按列合并。
- **delete-session**：级联删除 8 张表所有相关行（`tool_results / tool_calls / messages / subagents / workflow_agents / workflows / summaries / sessions`），按 `session_id` 或 `agent_id` 全清。

### 8.3 Cursor 持久化

```ts
if (cursor != null) {
  const [mtime, lines] = cursor.split(':');
  st.idx.run(unit.key, Number(mtime), Number(lines));
}
```

cursor 是 provider 私有协议，persist 只负责存到 `index_state(jsonl_path, mtime, lines_processed)`，下次 `discover()` 取回。

### 8.4 FTS 同步

`messages_fts` 用 FTS5 content-backed 虚表 + 三个触发器（AFTER INSERT / DELETE / UPDATE）自动同步 `messages` 表。索引末尾跑一次 `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` 强制重建 FTS，确保一致性。

### 8.5 Project path 推导

`refreshSessionProjectPaths` 在所有 provider 写完后统一跑：对每个 session，从 `messages.cwd` 取众数（出现次数最多 + 首次出现最早）回填 `sessions.project_path`。这避免 provider 的 project slug 不准的问题。

---

## 9. 会话重建（conversation reconstruction）

Trajex 把"重建"拆成两层：

**底层（provider）**：产出扁平的 message 记录流，每条带 `uuid / parent_uuid / type / role / content_type / is_sidechain / agent_id`。
- Claude：直接读 `obj.uuid / obj.parentUuid`，原样透传。
- Codex：自己合成 uuid（`codex:${threadId}:${lineNum}`），parent_uuid 用 `sm.lastMessageUuid` 顺序串。
- Pi：`finalMessage(parentId)` 递归查父链上最后一条可见消息。
- Kimi：`previousUuid` 顺序串，undo 时回滚。

**上层（session-detail-assembly，app 端）**：按 `uuid / parent_uuid` 重建消息树，处理 sidechain（子代理）、tool_use ↔ tool_result 配对、thinking 块展开等。vibe-ide 的 `src/main/ai.ts` 当前只读流式 stdout 事件，还没做消息树重建，可以参考。

**tool_call ↔ tool_result 配对**：
- Claude：通过 `tool_use.id === tool_result.tool_use_id`（同一 user 消息的 content 数组里）。
- Codex：`codexCallId(threadId, call_id)` 命名空间化 tool_id，`callMessageUuids` map 反查。
- Kimi：`namespacedToolId`，`callMessageUuids` map。
- Pi：`piId(sessionRawId, part.id)`，tool_result 带 `toolCallId`。

**thinking blocks**：
- Claude：content 数组里 `type === 'thinking'` 的块，`extractText` 把它与 text 块合并（Trajex 在 message 层合并为单字符串，同时用 `extractContentType` 标 `content_type = 'thinking'` 如果全是 thinking）。
- Codex：`event_msg` 的 `agent_reasoning` 类型，`contentType: 'thinking'` 单独成消息。
- Pi：assistant content 里 `type === 'thinking'` 的块拆成独立 message，`content_type = 'thinking'`。
- Kimi：wire 的 `content.part` 里 `part.type === 'think' | 'thinking'`。

---

## 10. 值得 vibe-ide 借鉴的 techniques

### 10.1 增量 tail 解析（最值钱）

vibe-ide 当前 `src/main/ai.ts` 是 live stream，每次跑都完整解析。如果要做"恢复历史会话"，可以参考 Trajex 的 cursor 模式：

```
index_state.jsonl_path → (mtimeMs, linesProcessed)
```

下次只 parse `lineNum > linesProcessed` 的行。`mtimeMs` 用来快速判断文件是否变过，避免打开文件。

vibe-ide 的 JSONL 也是追加写，这个模式完全适用。可以做一个 `~/.claude/projects/<hash>/*.jsonl` 的 watcher，新增行时增量解析。

### 10.2 readLines 的 buffer 流式 + 跨行连续

vibe-ide 现在 `src/main/ai.ts` 用 `lineBuffer` 做行缓冲（因为 spawn stdout 是流）。读文件时可以直接抄 `readLines`：64 KB buffer + `remainder` 拼接，比 `fs.readFileSync().split('\n')` 更省内存，对大文件（几百 MB 的会话）友好。

### 10.3 末尾半行宽容

`if (index === lines.length - 1 && !raw.endsWith('\n')) break;` —— Pi 的这个技巧适合 vibe-ide：AI CLI 进程崩溃时最后一条 JSONL 经常是半行，读文件时静默丢弃末尾不完整行。

### 10.4 is_meta 与 visibility 二分

Trajex 把"系统注入的、不该给用户看的消息"用两个字段标记：
- `is_meta`：命令信封（`<command-name>...`、`<system-reminder>`、`<task-notification>`）、skill 说明。
- `visibility: 'visible' | 'hidden'`：Codex 的 `<environment_context>` 包裹的用户消息。

vibe-ide 的 `cleanText` 现在是用正则洗掉这些标签，会丢信息。可以参考 Trajex 保留原文但打标记，UI 层决定是否折叠。

### 10.5 token 计数合并 cache

`totalInputTokens(usage)` 把 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` 加起来。vibe-ide 现在可能只算 `input_tokens`，会低估成本。

### 10.6 turn_duration_ms 延迟填充

Claude 的 `system` + `subtype === 'turn_duration'` 事件在 turn 结束才发出，Trajex 用 `message-turn-duration` record 做 targeted UPDATE 回到原消息。vibe-ide 如果要做"每轮耗时"展示，可以参考这个延迟填充模式，而不是在流式阶段实时算。

### 10.7 project_path 众数推导

Trajex 不信任单条 cwd，而是从 messages 里取出现次数最多的 cwd 作为 session 的 project_path。vibe-ide 在 session 列表展示 cwd 时可以用同样技巧，避免首条 cwd 不准。

### 10.8 Subagent / workflow 独立文件索引

vibe-ide 目前只读主 JSONL。Trajex 把 `<sessionId>/subagents/*.jsonl` 与 `subagents/workflows/<runId>/*.jsonl` 都独立索引，消息带 `agent_id` / `is_sidechain`。如果 vibe-ide 想展示完整的多 agent 会话，必须做这层发现。

### 10.9 provider 抽象 + TranscriptRecord 联合类型

把"JSONL 解析"和"写入存储"解耦成两个独立层，中间用 discriminated union 传数据。vibe-ide 的 `AiMessage / AiToolUse / AiToolResult` 可以演进为类似的 union，方便以后支持更多 AI CLI。

### 10.10 严格 vs 宽容解析按 provider 切

Claude / Codex 流式追加 → 宽容（静默跳过坏行）。
Pi / Kimi 完整 snapshot → 严格（坏行抛错，除末尾半行）。
vibe-ide 只解析 Claude 一种，用宽容策略即可。

---

## 11. vibe-ide 当前实现 vs Trajex 的差距

| 维度 | vibe-ide (`src/main/ai.ts`) | Trajex |
|------|------------------------------|--------|
| 解析范围 | Live stdout 流式 | 历史 JSONL 文件全量 / 增量 |
| 行缓冲 | `lineBuffer` + `JSON.parse(line)` | `readLines` 64KB buffer + remainder |
| 容错 | 无显式 try/catch per line | try/catch 跳过坏行 |
| Subagent 文件 | 未读 | 完整索引 |
| Workflow JSON | 未读 | 完整索引 + 反查主 transcript 的 Workflow tool_use |
| is_meta 标记 | 用 `cleanText` 洗标签 | 保留原文 + `is_meta` / `visibility` 字段 |
| Token 计数 | 单字段 `input_tokens` | cache 合并 |
| turn_duration | 未实现 | 延迟 UPDATE |
| Session 列表展示 cwd | 单条 | 众数推导 |
| Cursor / 增量 | 无（每次重跑） | `mtime:lines` cursor，可 resume |
| SQLite 索引 | 无（vibe-ide 用 JSONL 直读） | 完整 schema + FTS5 |

---

## 12. 关键文件源码位置

| 文件 | 角色 | URL |
|------|------|-----|
| `packages/core/src/parsing.ts` | 公共解析辅助（readLines / extractText / 文件发现） | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/parsing.ts> |
| `packages/core/src/providers/types.ts` | TranscriptRecord union / ProviderAdapter 接口 / Cursor / IndexUnit | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/providers/types.ts> |
| `packages/core/src/providers/claude.ts` | Claude Code provider：discover + parse + raw | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/providers/claude.ts> |
| `packages/core/src/providers/codex.ts` | Codex provider，含 event_msg ↔ response_item 双向去重 | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/providers/codex.ts> |
| `packages/core/src/providers/pi.ts` | Pi provider，树结构遍历 + active path 反查 | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/providers/pi.ts> |
| `packages/core/src/providers/kimi.ts` | Kimi provider，wire event replay + undo | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/providers/kimi.ts> |
| `packages/core/src/persist.ts` | TranscriptRecord → SQLite 统一写入 | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/persist.ts> |
| `packages/core/src/indexer.ts` | 索引编排（writer lease / 事务重试 / FTS rebuild） | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/indexer.ts> |
| `packages/core/src/provider-indexing.ts` | provider 计划生成 + 版本标记 | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/provider-indexing.ts> |
| `packages/core/src/schema.sql` | SQLite schema（含 FTS5 触发器 / B-Tree 索引） | <https://github.com/wutongyuonce/Trajex/blob/main/packages/core/src/schema.sql> |

---

## 13. 给 vibe-ide 的具体改造建议

按优先级：

1. **增量 tail**：在 `src/main/ai.ts` 或新模块里加一个 `parseJsonlIncremental(path, lastCursor)`，用 `mtime:lines` cursor，配合 `chokidar` / Electron 的 `fs.watch` 监听 `~/.claude/projects/` 变更，做实时会话历史同步。
2. **末尾半行宽容**：读文件解析时，`if (i === lines.length - 1 && !raw.endsWith('\n'))` 跳过。
3. **is_meta 标记替代 cleanText**：保留原文，UI 层折叠 system-reminder / command-name / task-notification。
4. **token 计数合并 cache**：`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`。
5. **Subagent 文件发现**：遍历 `<sessionId>/subagents/` 与 `subagents/workflows/`，消息带 `agent_id`。
6. **turn_duration_ms**：读 `type === 'system' && subtype === 'turn_duration'` 行，回填到上一条 assistant 消息。
7. **Project path 众数**：session 列表展示 cwd 时取消息里出现最多的 cwd。

不需要抄的部分：
- SQLite 层：vibe-ide 已经用 JSONL 直读 + 内存索引，不需要搬 SQLite。
- Provider 抽象：vibe-ide 目前只支持 Claude Code，等真的要做多 CLI 时再拆。
- FTS5：用不到，vibe-ide 的搜索走 ripgrep。

---

## 未做之事（按要求明示）

- ❌ 没有根据 README 推断解析细节。每条结论都追溯到 `parsing.ts` / `claude.ts` / `codex.ts` / `pi.ts` / `kimi.ts` / `persist.ts` 的实际代码。
- ❌ 没有杜撰行号。GitHub 主分支持续变化，行号会过期，所以引文按函数名 / 变量名 / 正则模式定位，不按行号。
- ❌ 没有把 Trajex 的 SQLite 层吹成 vibe-ide 必须抄的架构。vibe-ide 用 JSONL 直读，SQLite 对它不是必要的。
