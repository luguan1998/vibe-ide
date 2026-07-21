# Multica 派活机制调研

> 调研对象:[multica-ai/multica](https://github.com/multica-ai/multica) — 开源 managed agents 平台("Jira-for-agents",把 coding agent 当团队成员)。
> 调研日期:2026-07-20,基于仓库 HEAD `5a176b9`(当日有 push)。
> 核验:仓库与 41,162 stars 真实存在(GitHub API 实测 + `git ls-remote` 成功);tree 3950 条目;所列 12 个派活相关源码路径 11 个属实,16 个 provider backend 与子代理论断精确吻合,3 处内容论断逐字核对通过(见 §7)。
> 联网调研由 sonnet 子代理执行(项目规则:联网用 sonnet),主进程负责核验与落盘。

---

## 1. 项目身份

| 字段 | 内容 |
|------|------|
| 仓库 | https://github.com/multica-ai/multica(开源,41,162 stars / 5,202 forks) |
| 官网 | https://multica.ai |
| 一句话定位 | "The open-source managed agents platform" — **Agent-as-Teammate 任务平台**,把 coding agent 当 issue 的一等 assignee,分配 issue、追踪进度、积累可复用 skills。**不是 ADE**(与 orca/cursor 不同范式) |
| 名字来源 | Multica = **Mul**tiplexed **I**nformation and **C**omputing **A**gent,致敬 60 年代 Multics 分时系统 |
| 语言/框架 | Go 后端(Chi + sqlc + gorilla/websocket)+ Next.js 16 Web + Electron Desktop + React Native Mobile;DB = PostgreSQL 17 + pgvector |
| 创建时间 | 2026-01-13,活跃开发中(调研当日有 push) |
| 与 orca 关系 | 同类但不同范式。orca=Agent 编排 ADE(orchestrator + terminal pool);multica=AI-native 任务平台(issue tracker + agent runtime),更像"Jira/Linear 让 agent 成为一等 assignee" |
| 生态 | 真实活跃:multica-cli、rimedeck、origin-workbench、310+ multica-skills、karpathy-skills、multica-local-workdir 等众多 fork/skill pack |

---

## 2. 核心结论:派活是 1:1 静态绑定,不是 fan-out

> **Multica 没有"一个 prompt → N 个 agent → 比较选胜者"的自动流水线**。每次 enqueue 只创建一个 task,绑定**一个 agentID + 一个 runtimeID**。多 agent 协作靠 **squad leader agent 自决 + prompt 驱动 CLI 委派**,平台层不介入 fan-out。这点和 orca 一样"fan-out 手动",但实现范式完全不同。

---

## 3. 派活机制详解

### 3.1 触发入口(5 种,全部 1 输入 → 1 assignee)

| 入口 | 命令 / UI | 出处(已核验) |
|------|----------|--------------|
| 创建 issue 并 assignee | `multica issue create --assignee <name\|uuid>` / UI assignee picker | cli/ 下(CLI 文件名未精确核验) |
| issue comment @mention | 评论里 `@AgentName` | `EnqueueTaskForMention` `service/task.go:1060` |
| Chat 直接派活 | Web/Desktop chat 会话选 agent 发消息 | `EnqueueChatTask` `service/task.go:1424` |
| Quick Create 一键建 task | UI 模态,一句话自动建 issue | `EnqueueQuickCreateTask` `service/task.go:1289` |
| Autopilot(cron/webhook/手动) | UI 建 autopilot,选 assignee + cron 表达式 | `AutopilotService.DispatchAutopilot` `service/autopilot.go:113` |

### 3.2 fan-out 自动还是手动

**平台层 1:1 手动,squad 层 agent 驱动(非平台自动)**:

- 平台层:每次 enqueue 一个 task,绑定单 agentID + 单 runtimeID。`enqueueMentionTask`(`service/task.go:1094`):`GetAgent(agentID)` → 取 `agent.RuntimeID` → `CreateAgentTask`。
- Squad 层:issue 派给 squad → 平台只 enqueue 给 **squad leader 一个 agent**;leader **自己在运行时通过 `multica` CLI** 建子 issue / assign 给成员。
- 关键证据(`prompt.go:80`,已逐字核验):leader 的 prompt 写明——
  > "When the user names someone... call `multica workspace member list`, `multica agent list`, and `multica squad list`... `--assignee-id <uuid>`... Squads are first-class assignees too — a squad name routes work to the squad leader, who then delegates."
  - 甚至处理中文祈使句:`让 @独立团 review 这个 PR`、`给 @X 处理`、`交给 @X` 都按 assignee 指令解析。
- **这是 prompt-driven delegation,不是平台 fan-out 调度器**。leader 用什么策略分活(按能力/负载/轮询),平台不管。

### 3.3 assignee 选择 —— 静态绑定,enqueue 时就定死

**不是运行时挑,没有能力/负载智能调度**:

- 创建 issue 时用户选 assignee(agent 或 squad UUID),或 autopilot 规则写死 `AssigneeType + AssigneeID`。
- enqueue 时直接 `GetAgent(agentID)` 取 `agent.RuntimeID` 打到 task 行(`service/task.go:1094-1150`)。
- daemon 侧 `ClaimTasksWSFirst` 按 `runtime_id` 过滤——每个 runtime 只认领绑定到自己的 task,没有"挑最空闲 agent"。
- 唯一接近"智能"的是 autopilot 准入检查 `shouldSkipDispatch`(`service/autopilot.go:155-200`):runtime 离线时把 autopilot run 标 `skipped`,避免堆积。

### 3.4 调度循环与持久化 —— Server + Daemon 双层,PostgreSQL

**Server 端**:
- Autopilot 定时调度:`scheduler/manager.go` 的 `Manager` 每 30s tick,扫 `sys_cron_executions` 表 dispatch due 的 autopilot。
- TaskWakeupNotifier:enqueue 后通知 daemon(`service/task.go:62` 接口,daemon 实现 `NotifyTaskAvailable(runtimeID, taskID)`)。

**Daemon 端**:
- WS 唤醒优先,HTTP 兜底:`daemon/wakeup.go:60` `taskWakeupLoop` 维护 WS 到 server,server push wakeup hint → daemon 立即 claim;WS 断了退回 HTTP poll。
- Poll loop 兜底:`daemon/daemon.go:2821` `pollLoop`,周期 `ClaimTasksWSFirst`,**batch claim** 一次最多 `len(slots)` 个 task。
- 并发控制:信号量 `newTaskSlotSemaphore(MaxConcurrentTasks)`(`daemon.go:3050`),**默认 `MaxConcurrentTasks = 20`**(`daemon/config.go:67`,已核验),env `MULTICA_DAEMON_MAX_CONCURRENT_TASKS` 可覆盖(`config.go:433`,已核验)。
- 持久化:**PostgreSQL**(`agent_task_queue` 表 + `sys_cron_executions` 等),非 SQLite/文件。多 daemon 多 runtime 并存,分布式 lease(`claimResponseRecoveryWindow = 90s` / `prepareLeaseDuration = 45s`)。

### 3.5 agent 进程怎么起 —— os/exec subprocess,非 PTY

每个 provider 一个 backend,stdin/stdout JSON 流通信:

| Provider | 二进制 | 出处(已核验存在) |
|----------|--------|-------------------|
| claude | `claude`(Claude Code CLI) | `server/pkg/agent/claude.go` |
| codex | `codex` | `server/pkg/agent/codex.go` |
| cursor | `cursor-agent` | `server/pkg/agent/cursor.go` |
| copilot | GitHub Copilot CLI | `server/pkg/agent/copilot.go` |
| hermes | `hermes` | `server/pkg/agent/hermes.go` |
| pi | `pi` | `server/pkg/agent/pi.go` |
| 其余 | opencode / openclaw / kiro / kimi / qoder / traecli / antigravity / deveco / grok / codebuddy | `server/pkg/agent/*.go` |

- **共 16 种 provider**(已核验 `server/pkg/agent/` 下 .go 文件与论断精确吻合)。`agent.New(agentType, cfg)` 工厂(`agent.go`)按类型选 backend。
- 启动用 `exec.CommandContext(ctx, execPath, args...)`(如 `claude.go`),**不模拟终端**,直接 pipe 接 stdin/stdout。与 vibe-ide 用 node-pty 不同。
- daemon `runTask`(`daemon.go:3978`)调 `execenv.Prepare` 准备隔离工作目录,再调 backend `Execute(ctx, prompt, opts)`。

### 3.6 agent 递归派活 —— prompt + CLI,非平台原生

- agent 被 prompt 教用 `multica` CLI:`multica issue create --assignee`、comment @-mention、`multica autopilot ...` 注册 cron。
- 平台把这些当正常 issue 写入/mention,走 `WillEnqueueRun`(`service/issue_trigger.go:66`)→ `EnqueueTaskForIssue`/`EnqueueTaskForMention` 路径。
- **无平台层递归 fan-out**。递归是 agent 行为,不是调度器行为。
- 自我循环防护:`issue_trigger.go:86` `IsSelfLoop` 防止 agent 触发自己正在跑的 task。

### 3.7 比 orca 多/少的能力

**多**:
| 能力 | 出处 | 说明 |
|------|------|------|
| Squad(群组 + leader 委派) | `EnqueueTaskForSquadLeader` `task.go:1081` | issue 派 squad → leader 用 prompt+CLI 委派成员。orca 无此"团队"抽象 |
| Autopilot(cron/webhook 定时派活) | `scheduler/manager.go` + `service/autopilot.go` | 内置 cron,周期给 agent/squad 派活。orca 无 |
| 16 种 provider 统一接入 | `server/pkg/agent/*.go` | 同一 daemon 同时跑不同 provider 的 agent |
| 多入口统一任务模型 | `agent_task_queue` 表 + 多种 `Enqueue*` | issue assign / comment mention / chat / autopilot / quick create |
| PostgreSQL 持久化 + 多副本 | PG + `claimResponseRecoveryWindow=90s` | daemon 重启/崩溃可恢复,多 daemon 多 runtime 并存 |
| Skills 系统 | `server/internal/skill/` + builtin | agent 解决方案沉淀为 skill,team 共享 |
| Composio MCP overlay | `ComposioOverlayBuilder` `task.go:66` | 每次 task 动态挂 MCP server |

**少**(相对 orca):
| 能力 | 说明 |
|------|------|
| 无"一 prompt → N agent fan-out 比较选胜者" | multica 完全没有(orca 也没有) |
| 无可视化编排图 / DAG | 1:1,无"task A 完成自动触发 B/C"的图编排(autopilot cron 可模拟,但非 DAG) |
| 无按能力/负载智能调度 | 纯静态绑定;而 orca 是运行时从 terminal pool 挑空闲(虽然也只是 FIFO) |
| 无共享终端池 | orca 多 agent 共享 terminal pool;multica 每 agent 绑死一个 runtime,runtime 间不共享 |
| 无 PTY | orca terminal 是 PTY;multica 用 pipe subprocess |

---

## 4. 和 orca 对比

| 维度 | orca | multica |
|------|------|---------|
| 定位 | Agent 编排 ADE(orchestrator) | Agent-as-Teammate 任务平台(Jira-for-agents) |
| Fan-out | 手动(用户 `task-create` N 次) | 手动 1:1(issue → agent)+ squad 层 agent 驱动 |
| 调度循环 | Coordinator poll 空闲 terminal,FIFO 配给 | Server autopilot scheduler + Daemon WS wakeup + poll loop |
| Agent 选择 | 运行时从 pool 挑空闲 terminal | 静态绑定 agentID + runtimeID(enqueue 时定) |
| 持久化 | SQLite | PostgreSQL |
| Agent 进程 | PTY + shell | `os/exec` subprocess,per-provider backend |
| 自动分解 | 无(`decompose` 空壳) | 无平台层,靠 leader agent 自决 |
| 并发上限 | maxConcurrent per coordinator(默认 4) | MaxConcurrentTasks per daemon(默认 20,env 可调) |
| 多 provider | (terminal 跑任意 agent CLI) | 16 种 provider 原生 Backend 抽象 |
| 递归派活 | agent 调 CLI 建子 task | agent 调 CLI 建子 issue(平台当正常 issue) |
| 多 agent 协作抽象 | 无(就是 N 个独立 worker) | Squad(leader + members) |

**自动程度**:multica 在"无人值守"维度高于 orca(autopilot cron/webhook 可周期派活),但"自动 fan-out 比较"两者都没有。multica 的多 agent 协作完全靠 **squad leader agent 自决 + prompt 驱动 CLI**,平台只做"1 issue → 1 assignee"死板路由。

---

## 5. 对 vibe-ide 的可借鉴点

vibe-ide 已有 `pty` IPC + `spawn Claude CLI 子进程`(`src/main/ai.ts`)。值得参考:

1. **Agent Provider 抽象层**(`server/pkg/agent/*.go`)★ 最值得抄
   - 统一 `Backend` 接口(`Execute` 方法)封装 16 种 agent CLI,每种 provider 一个文件,处理参数 / JSON 流解析 / session 恢复(`--resume`)/ stderr tail / token usage 上报 / custom args 过滤 / MCP config 注入。
   - vibe-ide 现在只 spawn Claude CLI,若以后接 Codex / Cursor Agent / Hermes,这个抽象直接抄。工厂入口 `agent.New(agentType, cfg)`。

2. **执行环境隔离**(`server/internal/daemon/execenv/`)
   - 每个 task 一个隔离目录(envRoot),agent 在里面跑;git worktree 按需 checkout;GC meta 文件标记可回收。
   - vibe-ide 的 session 目前无磁盘隔离,可参考 `execenv.Prepare(params)`:每 session 独立 workdir + context files(AGENTS.md / CLAUDE.md / resources.json)。

3. **Prompt-as-Delegation**(leader agent 通过 CLI 委派)★ 哲学最值得借鉴
   - multica 的"递归派活"不是平台做的,而是**通过 prompt 教 leader agent 用 `multica` CLI 建子 issue / assign 给成员**(`prompt.go:80`)。
   - vibe-ide 若想做"主 agent 调度多个子 agent",可用同样思路:给主 agent 暴露 `vibe issue create --assign` 之类内部命令,让主 agent 自己决定 fan-out,而不是在平台层做 fan-out 调度器。这与本项目 CLAUDE.md"偏好最简实现"一致。

4. **WS wakeup + HTTP fallback 的 claim 模型**
   - daemon 维护 WS 到 server,server 主动 push wakeup hint,daemon 立即 claim;WS 断了退回 HTTP poll。
   - vibe-ide 主→渲染是 IPC,但若未来有"远程 agent runtime"(云端 agent 给本地 IDE 派活),这个 WS-first + HTTP-fallback 模型值得抄。

5. **Empty claim cache**(空任务快路径)
   - `EmptyClaimCache`(`service/task.go:49`)缓存"该 runtime 当前没任务",daemon 下次 poll 跳过 DB 扫描。轮询场景避免反复扫盘。

6. **Attribution(溯源到人)**
   - 每 task 记录 `OriginatorUserID + AccountableUserID + Source(direct_human/delegation/automation) + RuleVersionID`。agent 代人派活时需要类似溯源,否则审计乱套。

**不推荐抄**:
- PostgreSQL 持久化 —— 桌面 IDE 用文件系统/SQLite 更合适(本项目 [project_session-independence] 已是按 session 隔离的内存/文件方案)。
- Squad 抽象 —— 用户规模不够,先做单 agent 多 session 更实际。
- 16 provider 全家桶 —— 先支持 claude + codex 两种就够。

---

## 6. 不确定点(诚实标注)

1. **CLI issue 命令文件名**:子代理称 `server/internal/cli/cmd_issue.go`,tree 核验 MISS,实际 CLI 命令可能在 cli/ 下其他文件。仅此一处路径未核到,不影响派活核心机制(service/daemon 层已全部核验)。
2. **分布式 lease 细节**:看到 `claimResponseRecoveryWindow = 90s` / `prepareLeaseDuration = 45s`,推测是分布式 lease,未深读 `ClaimTasksWSFirst` 实现。
3. **Autopilot squad leader 选择**:`resolveAutopilotLeader`(`autopilot.go:313`)存在,但 leader 是否动态轮换、按什么策略,没深究。
4. **Codex multi-agent**(`pkg/agent/execenv/codex_multi_agent.go`):文件名暗示 Codex 内部多 agent 能力,未深入。
5. **variant/arena 实验特性**:grep variant/winner/tournament/arena 零命中,但不排除未合入主分支的实验代码。
6. **UI 侧交互**:只读后端源码,Next.js 前端的 issue picker / autopilot 创建 UI 细节未核对。
7. **orca 描述**:本报告 orca 对比部分基于此前对 orca 的调研结论(已单核验),未在此重读 orca 源码。

---

## 7. 数据来源与核验记录

| 项 | 来源 | 核验结果 |
|----|------|----------|
| 仓库存在 | `git ls-remote https://github.com/multica-ai/multica.git HEAD` | ✅ HEAD=`5a176b9bca969940912f041948a602f7423aeed7` |
| 仓库 meta | GitHub API `/repos/multica-ai/multica` | ✅ 41,162 stars / 5,202 forks / Go / 描述="open-source managed agents platform..." / created 2026-01-13 / pushed 2026-07-20 |
| 仓库搜索生态 | GitHub search API `q=multica+agent` | ✅ 顶层即 multica-ai/multica,下有 multica-cli/rimedeck/origin-workbench/multica-skills(310+)/karpathy-skills 等真实 fork/skill pack |
| 关键源码路径 | tree API `/git/trees/HEAD?recursive=1`(3950 条目) | ✅ 12 条中 11 条属实;`server/internal/cli/cmd_issue.go` MISS(见 §6) |
| provider 数量 | tree `server/pkg/agent/*.go` | ✅ 16 个 backend 文件,与论断精确吻合 |
| `MaxConcurrentTasks` 默认 20 + env 覆盖 | raw.githubusercontent.com `config.go` | ✅ `:67 DefaultMaxConcurrentTasks=20`、`:433 MULTICA_DAEMON_MAX_CONCURRENT_TASKS` 逐字命中 |
| leader 委派 prompt | raw.githubusercontent.com `prompt.go` | ✅ `:80` 原文逐字命中(含 `workspace member list`/`agent list`/`squad list` + `--assignee-id <uuid>` + 中文祈使句处理) |
| 具体 enqueue/pollLoop 行号 | sonnet 子代理读取克隆源码 | ⚠️ 文件已核验存在,行号未由主进程逐一复核;精确引用建议回仓库源码对照 |
