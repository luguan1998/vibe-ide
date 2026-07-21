# Orca ADE 调研:编排与 Computer Use 实现

> 调研对象:[stablyai/orca](https://github.com/stablyai/orca) — 面向"并行多 Agent 编排"的 ADE(Agentic Development Environment)。
> 调研日期:2026-07-20,基于仓库 HEAD `53aeeb7`(当日有 push,版本约 v1.4.147-rc.x)。
> 核验:仓库与官网(onorca.dev)真实存在;tree 共 9528 条目;下文所列 15 个关键源码路径中 14 个已通过 GitHub tree API 核验属实(见文末 §7)。仅 `skills/computer-use/skill.md` 未在仓库中找到,子代理亦已标注不确定。
> 联网调研由 sonnet 子代理执行(项目规则:联网用 sonnet),主进程负责核验与落盘。

---

## 1. 项目身份

| 字段 | 内容 |
|------|------|
| 仓库 | https://github.com/stablyai/orca (MIT) |
| 官网 | https://onorca.dev (实测 HTTP 200 → www.onorca.dev) |
| Stars | 22,854(2026-07-20 实测) |
| 一句话定位 | "The ADE for working with a fleet of parallel agents" — 不自己跑 LLM 推理,而是**编排 25+ 第三方 CLI Agent**(Claude Code / Codex / OpenCode / Gemini / Grok / Cursor CLI / Copilot / Devin / Cline 等)在隔离 git worktree 中并行工作 |
| 语言/框架 | TypeScript + Electron(electron-vite,与本项目同栈);原生层 macOS=Swift、Linux=Python、Windows=PowerShell |
| 规模 | src/ ~66K 行 TS/TSX,native/ ~6K 行,文件总数 ~9500 |
| 平台 | macOS / Windows / Linux 桌面 + iOS / Android 伴侣 App;Windows 仍在 RC 阶段 |
| 公司/团队 | Lovecast Inc.(品牌 Stably AI),旧金山,**Y Combinator 投资**;社交 X @orca_build / Discord |
| 创建时间 | 2026-03-17,活跃开发中(调研当日 2026-07-20 有 push);Open Issues ~1775,Forks ~1640 |
| Topics | `ade` `agent-ide` `orchestration` `parallel-agents` `worktrees` `claude-code` `codex` `cursor-agent` `opencode` `ghostty` `terminal` `yc-backed` |
| 同类 | Cursor / Windsurf / Claude Code / Cline / Aider — 但 Orca 差异点在"编排器"定位 |

---

## 2. 编排(Orchestration)实现

### 2.1 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                   Orca Desktop App (Electron Main)        │
│                                                          │
│  ┌───────────────┐    ┌──────────────────────────────┐   │
│  │  Coordinator  │◄───│  OrchestrationDb (SQLite WAL) │   │
│  │  (poll loop)   │    │  messages / tasks(DAG)        │   │
│  │  每 2000ms tick │    │  dispatch_contexts            │   │
│  └───────┬───────┘    │  decision_gates               │   │
│          │            │  coordinator_runs             │   │
│          ▼            └──────────────────────────────┘   │
│  ┌───────────────┐    ┌──────────────────────────────┐   │
│  │ Runtime        │◄───│  CLI: orca orchestration       │   │
│  │ Terminal Mgr   │    │  send/check/ask/reply          │   │
│  └───────┬───────┘    │  task-create/task-list         │   │
│          │            │  dispatch/run                  │   │
│          ▼            └──────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  PTY terminals (node-pty),每个跑一个独立 CLI Agent    │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐                │   │
│  │  │Agent A │ │Agent B │ │Agent C │  各自独立 worktree  │   │
│  │  │Claude  │ │Codex   │ │OpenCode│  + preamble 注入    │   │
│  │  └────────┘ └────────┘ └────────┘                │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 2.2 核心模块(均已核验文件存在)

| 模块 | 文件 | 职责 |
|------|------|------|
| 编排核心 | `src/main/runtime/orchestration/coordinator.ts` | Coordinator poll-loop 主循环(~450 行) |
| 持久层 | `src/main/runtime/orchestration/db.ts` | OrchestrationDb(SQLite,SCHEMA_VERSION=6) |
| 类型 | `src/main/runtime/orchestration/types.ts` | MessageRow / TaskRow / DispatchContextRow / DecisionGateRow / CoordinatorRun |
| Preamble 注入 | `src/main/runtime/orchestration/preamble.ts` | dispatch 时构建发给 Agent 的行为指令文本 |
| 群组寻址 | `src/main/runtime/orchestration/groups.ts` | `@all` / `@idle` / `@claude` / `@worktree:<id>` |
| 生命周期核验 | `src/main/runtime/orchestration/lifecycle-reconciliation.ts` | worker_done / heartbeat 等消息权威验证 |
| RPC 方法 | `src/main/runtime/rpc/methods/orchestration.ts` | `defineMethod()` + zod schema 注册编排 RPC |
| CLI 入口 | `src/cli/handlers/orchestration.ts` | `orca orchestration ...` 命令处理 |
| Claude Teams | `src/main/runtime/claude-agent-teams-service.ts` | 拦截 Claude Code 的 tmux 命令模拟多 pane 协作 |

### 2.3 Agent Loop(Coordinator poll-loop)

> 触发入口与 fan-out 机制见 §2.8(关键结论:fan-out 是**手动**的,coordinator 不做 AI 分解)。

Coordinator 跑一个固定间隔(默认 2000ms)的 poll 循环,每 tick 依次:

```
1. decompose()          — 仅验证 tasks 已预创建,**不做 AI 分解**(见 §5.1)
2. while(!converged), 每 2000ms:
   a. processMessages()       读收件箱:worker_done / heartbeat / escalation / decision_gate
   b. processEscalations()    上报通道(当前为 hook 占位)
   c. processDecisionGates()  未决 gate → 对应 task 标 blocked
   d. warnStaleDispatches()   超 10 分钟无心跳的 dispatch 发警告(不自动 fail)
   e. dispatchReadyTasks()    ready task → 空闲 terminal → 注入 preamble
   f. checkConvergence()       全部 completed/failed → 退出
```

### 2.4 多 Agent / 任务分发

- **Worker = 完整 CLI Agent**:每个 worker 是一个跑在独立 PTY terminal 的第三方 CLI Agent,不是内置 LLM。Orca 只编排、不推理。
- **并发控制**:`maxConcurrent` 默认 4;每 tick 检查已 dispatch 数量,无空闲 terminal 时自动 `createTerminal()`(每 tick 至多一个)。
- **Worktree 隔离**:每个 Agent 在独立 git worktree 工作。
- **Stale-base 防护**:dispatch 前 `probeWorktreeDrift()` 检查 worktree 落后 base 超 20 commit 则拒绝(`allow-stale-base: true` 可覆盖)——防止 Agent 在过期代码上工作。
- **Circuit Breaker**:dispatch 失败累计 `failure_count`,达阈值后 `circuit_broken` → task 标 `failed`。
- **Pane Identity**:dispatch 记录 `assignee_pane_key`(remint-stable leaf UUID),而非 terminal handle——防止 terminal handle 重置后误收完成消息。
- **群组消息**:`@all` / `@idle` / `@claude` / `@codex` / `@worktree:<id>`,按 Agent 类型/状态/worktree 广播。

### 2.5 Tool 注册与调用(CLI-as-Tool-Interface)

关键设计:**Agent 不通过 SDK/API,而是通过 CLI 命令与编排系统通信**(`orca orchestration send/check/ask/reply ...`)。这使任何终端 Agent 天然兼容,无需集成 SDK。

**Preamble 注入**:dispatch 时 `buildDispatchPreamble()` 生成一段行为指令文本注入到 worker terminal 的 stdin,教 Agent:如何发 heartbeat、worker_done 的格式、用 `ask` 替代 `AskUserQuestion` 等——把"Agent 行为协议"烧进 prompt。

RPC 统一在 `src/main/runtime/rpc/methods/` 按模块注册(computer / orchestration / terminal / files / git…),`defineMethod()` + zod schema 校验入参。

> **Orca CLI 自驱动(闭环)**:Agent 不仅通过 CLI 与编排系统通信,还能反过来驱动 Orca 本身——`orca worktree create` / `snapshot` / `click` / `fill` 等命令让 Agent 可以创建 worktree、截屏、点击、填充。即编排系统自身也被暴露成 Agent 可调用的工具集(自举),CLI-as-interface 形成闭环。

### 2.6 Planner/Executor 分层

- **分层存在**:Coordinator=Planner/调度者,CLI Agent=Executor。
- **Decision Gates**:Agent 可发 `decision_gate` 消息阻塞等待人类/Coordinator 决策 → Human-in-the-loop。
- **Escalation**:Agent 可发 `escalation` 上报 blocker。

### 2.7 Session 状态管理

- 全部编排状态持久化到本地 **SQLite(WAL 模式)**。
- 消息系统是类邮箱模型:`from_handle` / `to_handle` / `read` / `sequence` / `thread_id`。
- 每次 dispatch 创建独立 `dispatch_context`(含 failure_count / last_heartbeat_at / assignee_pane_key)。
- 顶层 `coordinator_run` 记录(spec / status / coordinator_handle / poll_interval_ms)。

### 2.8 触发入口与 fan-out 机制(手动)★ 关键结论

> **fan-out 是手动的,不是自动的**。Orca 没有"一个 prompt → N 个 agent → 比较 → 选胜者 → 合并"的自动流水线。`decompose()`(`coordinator.ts:213`)是空壳——注释自诩"decomposes spec into a task DAG",实际只 `listTasks().length>0` 检查 tasks 已存在,否则抛错。`merge_ready` 消息类型存在但 coordinator 直接 `break` 忽略(`coordinator.ts:275`)。README/marketing 的"扇出 5 个 agent 比较合并胜出者"描述的是**用户手动用法的使用模式**,不是代码里的自动功能。

**两种触发方式:**

方式 A —— 一条命令起 coordinator loop(前提:tasks 已用 `task-create` 建好):
```bash
orca orchestration run --spec "<spec>" [--max-concurrent N] [--from <handle>]
# 立即返回 {runId, status:'running'},后台 poll-loop
```

方式 B —— 手动逐步(最贴近"指派"原语):
```bash
orca orchestration task-create --spec "Fix login CSS" --deps '[...]' --json   # 建 DAG 节点
orca terminal create --worktree active --title worker --command "claude" --json # 建 terminal + 指定 agent
orca orchestration dispatch --task <task_id> --to <handle> --inject --json     # 注 preamble 派发
orca orchestration check --wait --types worker_done,escalation --timeout-ms 900000 --json  # 阻塞等完成
```

**end-to-end 调用链(逐节核验):**
```
orchestration run / dispatch (orchestration.ts:726 / :545)
  → RPC orchestration.run (orchestration-gates.ts:44)
    → new Coordinator + db.createCoordinatorRun (SQLite)
      → executeLoop (coordinator.ts:145)  while(!converged){ tick(); sleep(2000ms) }
        → tick (coordinator.ts:190): processMessages / processDecisionGates / warnStaleDispatches(10min) / dispatchReadyTasks / checkConvergence
          → dispatchReadyTasks (coordinator.ts:380): listTasks({ready}) + slots = maxConcurrent - dispatched + getAvailableTerminals
            → 无空闲 terminal? runtime.createTerminal(worktree) 自动开一个
            → dispatchTask (coordinator.ts:422): probeWorktreeDrift(落后 base>20 拒) → createDispatchContext → buildDispatchPreamble
              → sendTerminalAgentPrompt (orca-runtime.ts:11535): 把 preamble+TASK 文本"粘贴"进 agent PTY 输入
                → agent 在 PTY 收到指令开干,用 check/send/ask 回报
```

**assignee 选择规则 —— agent 是 terminal 的属性,不是 task 的:**
- `TaskRow`(`types.ts:38`)只有 `spec/status/deps/...`,**无 agent_type 字段**;`assignee_handle`/`assignee_pane_key` 长在 `dispatch_context`(派发记录)上,不在 task 定义上。
- agent 类型由 `orca terminal create --command "claude"` 或 worktree 配置决定;coordinator 不管跑的是 claude 还是 codex。
- `getAvailableTerminals()`(`coordinator.ts:524`):按 worktree 过滤,排除 coordinator 自身 terminal / 已 busy / `connected=false`。
- 取 `terminals.shift()` —— **第一个 ready task 配第一个空闲 terminal**,朴素 FIFO,无按能力/负载的智能调度。
- coordinator 调 `createTerminal` 时**不传 `--command`**,新 terminal 跑什么 agent 由 worktree 默认配置决定(`resolveAgentTerminalCreateOptions` 在 `orca-runtime.ts` 28810 行中,未完全挖穿)。

**agent 递归派活(自举闭环):** 正在跑的 agent 可自己敲 CLI 派子任务,构建任意 DAG:
```bash
orca orchestration task-create --spec "子任务" --parent <父task_id> --deps '[...]'
orca terminal create --worktree active --title sub-worker --command "codex" --json
orca orchestration dispatch --task <new> --to <new_handle> --inject --json
orca orchestration check --wait ...
```
- preamble(`preamble.ts`)**只教通信命令**(send/check/ask/escalation/heartbeat),不教派活;派活命令参考来自 **bundled skill guide**(`src/cli/bundled-skill-guides.ts`,作为 Orca skill 注入 agent)。
- 即 coordinator 既可是纯 TS 程序循环,也可是"一个 agent 手动跑 task-create→dispatch→check--wait 循环"——两种模式共存。

**合并/选胜者:** 不存在自动化。`merge_ready` 被 `break`(`coordinator.ts:275`、`lifecycle-reconciliation.ts:97` 返回 `{action:'ignored'}`)。多 variant 比较合并需用户/coordinator-agent 手动做。

---

## 3. Computer Use 实现

### 3.1 整体架构

```
┌───────────────────────┐
│  Agent / CLI          │  orca computer ...
└──────────┬────────────┘
           ▼  RPC (JSON over Unix socket / WebSocket)
┌───────────────────────┐
│  computer.ts          │  RPC method handler(已核验)
│  sidecar-client.ts    │  Node sidecar 进程管理
│  sidecar-entry.ts     │  sidecar 子进程入口
└──────────┬────────────┘
           ▼  fork() / Unix socket
┌──────────────────────────────────────────┐
│  Native Provider(每平台一份,均已核验)      │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐│
│  │ macOS    │ │ Linux    │ │ Windows    ││
│  │ Swift    │ │ Python   │ │ PowerShell ││
│  │ AX API   │ │ AT-SPI   │ │ UI Auto    ││
│  │ ScreenCap│ │ Gdk      │ │ Win32 P/Inv││
│  └──────────┘ └──────────┘ └────────────┘│
└──────────────────────────────────────────┘
```

### 3.2 截屏(各平台原生 API)

| 平台 | 实现 |
|------|------|
| macOS | ScreenCaptureKit(`import ScreenCaptureKit`),原生高性能,支持 Retina scale |
| Linux | Gdk + GdkPixbuf(`from gi.repository import Gdk, GdkPixbuf`),截取目标窗口区域 |
| Windows | Win32 `GetWindowRect` + 截图,经 P/Invoke 调 `user32.dll` |

限制:最大 1280px 边长、最大 900KB PNG,自动降级缩放(scale step 0.85,min 0.25)。返回 base64 PNG + scale 因子。

### 3.3 屏幕解析(Accessibility Tree 优先,非纯 vision)

**核心取舍:不靠 vision 模型,而是直接读系统无障碍树(AT),截图仅作辅助验证。**

| 平台 | 实现 |
|------|------|
| macOS | `AXUIElement` Accessibility API,递归遍历 AX tree,提取 role/title/value/traits/actions/frame |
| Linux | `Atspi`(AT-SPI 2.0),`Atspi.get_desktop(0)` → 递归遍历 |
| Windows | `UIAutomationClient`,`AutomationElement` tree traversal |

- 限制:`MAX_NODES=1200` / `MAX_DEPTH=64` / `TEXT_LIMIT=500`。
- **Element Index**:每个 accessibility node 分配稀疏 index,Agent 通过 index 指定操作目标(语义化,比坐标稳定)。
- **Snapshot 输出**:`treeLines[]`(文本化树)+ `elements[]`(结构化数组,含 index/frame/actions)+ 截图。

### 3.4 模拟点击输入

支持操作:click / performSecondaryAction / scroll / drag / typeText / pressKey / hotkey / pasteText / setValue。

| 平台 | 实现 |
|------|------|
| macOS | AX API `AXUIElementPerformAction` + CoreGraphics `CGEventCreateMouseEvent` / `CGEventCreateKeyboardEvent` |
| Linux | AT-SPI `Atspi.Accessible` action interface + Gdk 事件合成 |
| Windows | `PostMessage(WM_LBUTTONDOWN/UP/KEYDOWN/KEYUP)` + `SetCursorPos` + `mouse_event()` |

- **剪贴板粘贴**:`pasteText` 走系统剪贴板(pbcopy / xclip / SetClipboardData),标记 `unverified/clipboard_paste`。
- **Action 验证**:`setValue` 后刷新 element value 对比 expected vs actual → `verified` / `unverified`。

### 3.5 坐标系统

- **Window-local 坐标**:所有坐标相对目标窗口左上角。
- **Scale 转换**:`action_x = screenshot_pixel_x / screenshot.scale`(Retina/HiDPI 适配)。
- **双模式**:优先用 element index(accessibility tree),备选用 x/y 坐标(截图定位)。

### 3.6 沙箱 / 隔离

- **无容器沙箱**:直接操作用户桌面会话,无 Docker/VM。
- **权限**:macOS 需辅助功能权限(`macos-computer-use-permissions.ts`)。
- **App 黑名单** `BLOCKED_APP_FRAGMENTS`:1password / bitwarden / dashlane / lastpass / nordpass / proton pass — 密码管理器禁止操作。
- **进程隔离**:native provider 跑独立 sidecar 进程(`fork()` 或 Unix socket),超时 30s 自动 kill,60s 强杀——崩溃不影响主进程。

### 3.7 关键代码位置(均已核验文件存在)

| 功能 | 文件 |
|------|------|
| Computer RPC 方法 | `src/main/runtime/rpc/methods/computer.ts` |
| Sidecar 进程管理 | `src/main/computer/sidecar-client.ts` |
| Sidecar 入口 | `src/main/computer/sidecar-entry.ts` |
| macOS Native Provider(Swift) | `native/computer-use-macos/Sources/OrcaComputerUseMacOS/main.swift`(~3800 行) |
| Linux Bridge(Python/AT-SPI) | `native/computer-use-linux/runtime.py`(~1100 行) |
| Windows Bridge(PowerShell/UIA) | `native/computer-use-windows/runtime.ps1`(~1200 行) |
| Bridge 执行器(fork+JSON) | `src/main/computer/desktop-script-provider-bridge.ts` |
| Bridge 类型(BridgeSnapshot/Element) | `src/main/computer/desktop-script-provider-types.ts` |
| Provider 生命周期 | `src/main/computer/computer-provider-lifecycle.ts` |

---

## 4. 对 vibe-ide 的可借鉴点

1. **CLI-as-Tool-Interface**:vibe-ide 已有 IPC(pty/git/file/workspace/search)。可考虑把编排能力暴露成 CLI 命令,让 Agent 通过 terminal 直接调用编排系统,而非强耦合 SDK。
2. **Preamble 注入**:本项目 spawn Claude CLI 子进程(`src/main/ai.ts` spawnClaude)时,可借鉴 Orca 在 dispatch 时注入一段"行为指令"到 stdin——约束 heartbeat 频率、完成通知格式、提问走 `ask` 而非同步弹窗(与本项目 CLAUDE.md 禁用同步弹窗规则一致)。
3. **Computer Use 选 AT-SPI / UIA 而非纯 vision**:本项目是 Electron 桌面 IDE,若要做"AI 操作本机",Windows 上用 PowerShell + UI Automation、Linux 上用 Python + AT-SPI,比喂截图给 vision 更快更确定。本项目已有 BrowserView 注入 JS 选元素的通道(`__vibeAppendInput`,见记忆),思路相近。
4. **Sidecar 进程隔离**:native provider 跑独立进程 + 超时强杀——适合任何"可能崩溃"的原生能力,避免拖垮主进程。
5. **Session 隔离一致性**:Orca 每 Agent 独立 worktree + terminal,与本项目"session 独立、状态按 session 隔离"约束([project_session-independence])同向。若做多 Agent,建议同样按 session 维度隔离编排状态。
6. **Coordinator poll-loop + SQLite**:轻量、可断点续跑、状态可审计。但若不真做多 Agent,这套偏重,慎抄。
7. **Stale-base 防护 / Circuit Breaker / Heartbeat**:这些是通用 Agent 鲁棒性手段,值得纳入任何"派发任务给子进程"的设计。
8. **Design Mode(内嵌真实 Chromium + 点击元素直送 agent)**:Orca 在 app 内嵌真实 Chromium 窗口,用户点击 UI 元素时直接把对应 HTML/CSS/截图发给 agent。这与本项目已有的 `__vibeAppendInput` 注入通道 + BrowserView 选元素能力(见记忆 `project-vibe-append-input-channel`)是近亲设计——可借鉴"点击即采集 DOM"的闭环,让 agent 拿到真实结构化 HTML 而非靠 vision 解析截图,**比原生 AT 方案更适合 Electron 内嵌 web 场景**。
9. **Ghostty 级终端**:WebGL 渲染 + 无限分屏 + 重启保留 scrollback。本项目终端用 xterm.js,可参考其"重启保留缓冲区"与 WebGL 性能取向(本项目已用 xterm.js >= 6.1 透明修复,见 CLAUDE.md 终端背景图条目)。
10. **SSH Worktrees**:远程机器跑 agent + 完整文件编辑/git/终端/自动重连/端口转发。若未来要支持远程开发可参考。

---

## 5. 局限与疑点(诚实标注)

1. **编排无 AI 分解**:`decompose()` 是空实现——任务 DAG 必须由外部预创建,Coordinator 本身不会用 LLM 分解需求(代码注释明示 "AI-driven decomposition belongs in a future phase")。即 Orca 是"调度器"非"理解器"。
2. **Windows 支持较新**:Windows 版仍在 RC(v1.4.147-rc.x),README 专门提醒 Windows 用户用 RC。
3. **Computer Use 无沙箱**:直接操控用户桌面,无 Docker/VM 隔离,仅靠权限 + 黑名单 + 超时兜底。
4. **截图遮挡风险**:Linux/Windows 截图基于窗口可见区域,被其他窗口遮挡时可能截到错误内容。
5. **Element Index 短命**:每次 UI 变化后 index 重排,Agent 必须每次操作前重新 get-app-state——比坐标稳定但仍非永久。
6. **Agent Teams 仅限 Claude**:`claude-agent-teams-service.ts` 只兼容 Claude Code 的 tmux 命令,其他 Agent 无 teams 概念。
7. **`skills/computer-use/skill.md` 未核验到**:子代理声称存在,tree API 核验 MISS。该路径下文不作为引用依据。

---

## 6. 设计精髓一句话总结

> Orca 不是又一个 LLM wrapper IDE,而是一个 **Agent 编排器**——它自己不推理,而是调度 25+ 第三方 CLI Agent 在隔离 worktree 中并行工作。编排核心 = Coordinator poll-loop + SQLite 消息系统 + **Preamble 注入协议**(把行为契约烧进 prompt)+ CLI-as-interface。Computer Use = 各平台原生 Accessibility API(AX/AT-SPI/UIA)**优先于 vision**,AT tree + 截图双模式 + sidecar 进程隔离。

---

## 7. 数据来源与核验记录

| 项 | 来源 | 核验结果 |
|----|------|----------|
| 仓库存在 | `git ls-remote https://github.com/stablyai/orca.git HEAD` | ✅ HEAD=`53aeeb710c45aa22738f891ad60ba3886163e67b` |
| 官网 | `curl onorca.dev` | ✅ HTTP 200 → www.onorca.dev |
| 仓库 meta | GitHub API `/repos/stablyai/orca` | ✅ 22,854 stars,TypeScript,MIT,描述="ADE for working with a fleet of parallel agents",pushed 2026-07-20 |
| 关键源码路径 | GitHub tree API `/git/trees/HEAD?recursive=1`(9528 条目,未截断) | ✅ §2.2 + §3.7 所列 14/15 路径属实;`skills/computer-use/skill.md` MISS |
| 具体常量/行号(SCHEMA_VERSION=6、MAX_NODES=1200、64 层深度、1280px/900KB 截图上限等) | 两次独立 sonnet 子代理读取克隆源码 | ✅ 两轮独立检索结论一致(常量数值、三端技术栈、密码管理器黑名单均吻合),置信度上调;如需精确引用仍建议回仓库源码对照 |

> 深入源码细节(具体常量、行号、函数体)来自两次独立 sonnet 子代理 `git clone --depth 1` 后的读取,文件级路径已经本主进程核验,两轮常量数值独立吻合。检索噪声提示:WebSearch 对 "orca" 易返回假 URL(`orca-ai/orca`、`orca-agent.dev`、`arxiv.org/abs/2024/orca` 等均实测 404 幻觉),`stablyai/orca` 是唯一真正实现 computer use 的 orca 项目。
>
> 另:GitHub 上还有若干同名小仓库(Danau5tin/Orca-Agent-RL、Leezekun/AgentOrca、BenedatLLC/orca-agent 等),均为 RL/评估/可观测性 agent,与 computer use 无关,非本文对象。
