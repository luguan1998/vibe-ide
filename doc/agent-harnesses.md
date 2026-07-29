# Agent Harness 新颖仓库调研

> 调研对象:类似 multica 的 agent harness / 多 agent 编排 GitHub 仓库,偏新颖(2025 下半年至 2026 年涌现)。
> 调研日期:2026-07-29。
> 核验:下文 14 个仓库全部通过 WebFetch 一手访问其 GitHub 仓库页面验证存在并提取 README 内容。
> 与已有报告关系:multica-ai/multica 与 stablyai/orca 已有独立报告(`doc/multica-research.md`、`doc/orca-ade-research.md`),本报告不重复,只在对比处引用。
> "multica" 澄清:用户说的 "multica" 指 [multica-ai/multica](https://github.com/multica-ai/multica)(41K+ stars,managed agents 平台)。搜索 `multica-ai/agent-harness` 返回 404,不存在此仓库。

---

## 1. 总览表

| # | 仓库 | Stars | 语言 | 一句话定位 | 核心新颖点 |
|---|------|-------|------|------------|------------|
| 1 | [wshobson/agents](https://github.com/wshobson/agents) | 38.3K | Markdown | Multi-harness agentic plugin marketplace(5 工具 × 94 plugins × 203 agents) | 单一源 → 5 种 harness 原生产物;PluginEval 三层评估;5 级模型阶梯 |
| 2 | [Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) | 38.2K | TypeScript | Teams-first multi-agent orchestration for Claude Code | 10+ 编排模式(Ralph/Ultrawork/CCG…);tmux 跨 provider worker;skill 自动提取 |
| 3 | [jnMetaCode/agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | 18.5K | Shell | 268 个即插即用 AI 专家角色(18 工具 × 20 部门) | 单 agent 定义 → 18 工具格式自动转换;中国市场 53 原创;DAG 并行编排器 |
| 4 | [Untrivial-ai/agent-orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) | 8.6K | TypeScript/Electron | Meta-harness agent IDE(23 worker + 3 reviewer harness) | 桌面 IDE 管 agent 舰队;CI/review/merge conflict 自动反馈回对应 agent;git worktree 隔离 |
| 5 | [omnigent-ai/omnigent](https://github.com/omnigent-ai/omnigent) | 7.9K | Python | Meta-harness 框架(Claude Code/Codex/Cursor/Pi/Hermes/…)| YAML 定义 agent + harness;三层 policy 栈;跨设备 session 同步;Polly/Debby 模式 |
| 6 | [stellarlinkco/myclaude](https://github.com/stellarlinkco/myclaude) | 2.7K | Go | Multi-backend 编排(Codex/Claude/Gemini/OpenCode)| Orchestrator/Executor 分离;codeagent-wrapper 屏蔽 4 种 CLI 差异 |
| 7 | [yohey-w/multi-agent-shogun](https://github.com/yohey-w/multi-agent-shogun) | 1.4K | Shell | 武士阶层(Shogun→Karo→Ashigaru)× tmux | YAML 文件当消息总线 + inotifywait 事件驱动零轮询;Bloom 分类法路由;底部向上 skill 发现 |
| 8 | [Danau5tin/multi-agent-coding-system](https://github.com/Danau5tin/multi-agent-coding-system) | 1.4K | Python | Stanford TerminalBench #13(曾超 Claude Code)| 三角色层级(Orchestrator/Explorer/Coder)+ Context Store 累积知识;Orchestrator 永不直接读代码 |
| 9 | [jayminwest/overstory](https://github.com/jayminwest/overstory) | 1.3K | TypeScript | Pluggable runtime adapters(11 种)× SQLite 邮箱 | 两层 agent 定义(HOW base + WHAT overlay);三级 watchdog;headless-first + tmux 逃生口 |
| 10 | [ChesterRa/cccc](https://github.com/ChesterRa/cccc) | 1.1K | Python | IM 群聊隐喻的多 agent 协作 | append-only ledger.jsonl;IM 级消息语义(已读回执/ACK/@mention);Group Bridge 分层信任 |
| 11 | [gastownhall/gascity](https://github.com/gastownhall/gascity) | 1.0K | Go | Composable orchestration SDK(City/Rig/Session/Beads) | K8s 风格声明式 reconciliation;Beads 工作跟踪原语;6 种 runtime provider(tmux/subprocess/ACP/K8s/…) |
| 12 | [unohee/OpenSwarm](https://github.com/unohee/OpenSwarm) | 830 | TypeScript | 自主 AI 开发团队 + Discord 控制 + Linear 集成 | 混合模式(前沿诊断 + 轻量实现);L0–L6 难度阶梯成本路由;认知记忆(相似度/重要性/时效/频率混合检索) |
| 13 | [sipyourdrink-ltd/bernstein](https://github.com/sipyourdrink-ltd/bernstein) | 746 | Python | 确定性编排器(协调环无 LLM,40+ CLI adapter) | 调度是纯 Python(可重放);HMAC 审计链 + Merkle seal;per-task worktree + merge gate |
| 14 | [QoderAI/better-harness](https://github.com/QoderAI/better-harness) | 647 | Node.js | Agent 工作流评估框架(不评 diff,评工作环) | 5 维 Agent Work Loop 评估;3 个独立证据 agent + 1 个主导 agent;认识论诚实(不观察即不打分) |

---

## 2. 每仓库深入分析

### 2.1 wshobson/agents — Multi-harness plugin marketplace

**是什么**:单一 Markdown 源同时产出 5 种 coding harness(Claude Code / Codex CLI / Cursor / OpenCode / Gemini CLI)的原生产物。94 plugins、203 agents、175 skills、109 commands、16 orchestrators。

**harness 设计独到之处**:
- **One source, five outputs**:[`plugins/`](https://github.com/wshobson/agents/tree/main/plugins) 是 single source-of-truth,每种 harness adapter 输出 idiomatic 原生格式(Claude Code 的 `marketplace.json`、Cursor 的 `.cursor/rules/`、Gemini 的 TOML 等),不是最低公约数翻译。
- **5 级模型阶梯**:Tier 0(Fable 5,长自主任务)→ Tier 1(Opus,架构/安全)→ Tier 2(inherit)→ Tier 3(Sonnet,文档/测试)→ Tier 4(Haiku,快速操作),成本感知路由。
- **PluginEval 三层评估**:静态分析 + LLM 四维 judge + Monte Carlo 模拟(50–100 runs)认证 plugin 质量。
- **Context isolation**:安装一个 plugin 只加载它的组件,不把整个 marketplace 塞进上下文。

**架构**:目录即注册。`plugins/<domain>/<plugin>/` 下放 `.claude-plugin/plugin.json` + `agents/` + `commands/` + `skills/`,auto-discover。
**活跃度**:530 commits / 4.1K forks / 308 watchers,MIT。

**来源**:[github.com/wshobson/agents](https://github.com/wshobson/agents)

---

### 2.2 oh-my-claudecode (OMC) — Teams-first 编排

**是什么**:零配置自然语言驱动 Claude Code 多 agent 编排层。npm 包名 `oh-my-claude-sisyphus`,TypeScript。

**harness 设计独到之处**:
- **10+ 编排模式**:Team(staged pipeline `plan→prd→exec→verify→fix`)、CCG(三模型顾问 `/ask codex` + `/ask antigravity` → Claude 综合)、Autopilot、Ultrawork、Ralph(验证不通过不放弃)、UltraQA(QA 循环到门禁通过)、Pipeline、Deep Interview(Socratic 需求澄清)、Autoresearch。
- **tmux 跨 provider worker**:`omc team N:codex "..."` 在 tmux pane 里起真正的 `codex` / `claude` / `gemini` / `antigravity` / `grok` / `cursor-agent` 进程,按需启停。
- **Skill 自动提取**:从 session 中提取可复用模式存为 `.omc/skills/` 的 markdown,下次上下文匹配时自动注入。
- **19 specialized agents + 模型阶梯**:Haiku 简单 → Opus 复杂,宣称 30–50% token 节省。
- **双表面**:CLI(`omc ...`)+ 会话内 slash(`/team`),同一逻辑两种入口。
- **Magic keywords**:`ralph` / `ulw` / `ralplan` / `deepsearch` / `ultrathink` / `autopilot`。

**架构**:`.omc/` 状态目录 / `.omc/skills/` 团队共享 skill / `.omc-workspace` 多 repo 状态共享;autopilot 命名工作流用 Linux `flock` 做可恢复互斥锁。
**活跃度**:3,440 commits / 3.4K forks / MIT。

**来源**:[github.com/Yeachan-Heo/oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)

---

### 2.3 jnMetaCode/agency-agents-zh — 268 agent × 18 工具

**是什么**:中文社区 fork(上游 [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)),268 个即插即用 AI 专家角色(215 译 + 53 中国原创),18 工具,20 部门。

**harness 设计独到之处**:
- **单 agent → 18 工具格式转换**:`scripts/convert.sh` 把同一 markdown 自动转为 Claude Code(`~/.claude/agents/`)、Cursor(`.mdc` rules)、Copilot(`~/.github/agents/`)、Gemini CLI、Hermes、Kiro、Trae、Qwen Code、OpenCode、Codex CLI、Aider 等原生格式。
- **中国市场原创**:53 个针对小红书/抖音/微信/B 站/快手/微博/知乎/飞书/钉钉的 agent,以及跨境、ToG、医疗合规、Qt 工控、机械设计、养殖记录审计等垂直领域。
- **OpenClaw 三文件分解**:每个 agent 拆为 `SOUL.md`(身份/记忆/风格)+ `AGENTS.md`(使命/交付/工作流)+ `IDENTITY.md`(名字/简介),多 agent 协作更清晰。
- **DAG 并行编排器**:`agency-orchestrator`(npm/桌面 app)把自然语言任务 → 选 agents → 建依赖图 → 并行派发;支持断点续跑。
- **NEXUS 战略框架**:`strategy/` 有完整 Phase 0–6 playbook(Discovery → Operate)+ agent 激活 prompt + handoff 模板。

**活跃度**:212 commits / 3.1K forks / 101 watchers / MIT。

**来源**:[github.com/jnMetaCode/agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)

---

### 2.4 Untrivial-ai/agent-orchestrator — Meta-harness 桌面 IDE

**是什么**:Electron 桌面 app,agent 舰队的控制平面。23 worker agent harness(claude-code/codex/aider/opencode/grok/cursor/qwen/copilot/goose/cline/kimi/kiro/…) + 3 reviewer harness。

**harness 设计独到之处**:
- **Meta-harness 模式**:不是 agent,而是 harness 的 harness——包在现有 agent CLI 外面加编排,不改 agent 本身。
- **自动反馈闭环**★ 核心差异点:CI 失败 / code review comment / merge conflict **自动路由回创建该 PR 的 agent session**。把"fire and forget"变成"managed, self-correcting"。
- **Git worktree 隔离**:每 session 独立 worktree + terminal + branch + PR 状态。
- **Live terminal attach**:桌面 UI 直接 attach 到任意 agent 的 worker terminal,同时看 summary / PR 状态 / 后续动作。
- **In-app browser preview**:预览 session 本地跑的 app。
- **CDC(Change Data Capture)**:daemon 用事件驱动追踪 session / repo 状态变化,非轮询。
- **Adapter pattern**:23 种 agent CLI 统一接口,"If it runs in a terminal, it runs on Agent Orchestrator"。

**架构**:`backend/`(daemon/持久化/状态推导)+ `frontend/`(Electron)+ `packages/`(共享库 + agent adapters)+ `skills/bug-triage/`。macOS/Windows/Linux 桌面构建;旧 npm CLI `@aoagents/ao` 冻结在 v0.10.0。
**活跃度**:1,918 commits / 1.3K forks / Apache-2.0。

**来源**:[github.com/Untrivial-ai/agent-orchestrator](https://github.com/Untrivial-ai/agent-orchestrator)

---

### 2.5 omnigent-ai/omnigent — Meta-harness 框架

**是什么**:Python meta-harness,统一编排 Claude Code / Codex / Cursor / OpenCode / Hermes / Pi / 自定义 agent。跨设备 session 同步(终端 / 浏览器 / 手机 / macOS 桌面 app)。

**harness 设计独到之处**:
- **Meta-harness 抽象**:YAML 定义 agent(prompt + executor/harness + tools),同一 agent 定义可跑在 claude-sdk / codex / cursor / hermes / pi / openai-agents 之上,换 harness 不改定义。
- **Polly 模式**:"tech lead" agent 规划 → 委派给 coding sub-agent(各自独立 worktree)→ diff 发给**不同厂商**的 reviewer agent。
- **Debby 模式**:双头脑暴(同一 agent 同时用 Claude + GPT,`/debate` 互评)。
- **三层 policy 栈**:server-wide → per-agent → per-session,可暂停高风险操作 / 限花费 / 限工具。
- **Co-driving + forking**:多用户实时共驱同一 session,或 fork 独立分支。
- **Managed hosts**:server 可按 session 起一次性云沙箱(Modal/Daytona/E2B/CoreWeave/K8s/OpenShell/Boxlite/Databricks),开发者笔记本不用常开。
- **Tools 三类型**:`function`(本地 Python)+ `mcp`(MCP server)+ `agent`(sub-agent),支持层级 agent 架构。

**架构**:Client-server;`omnigent server` 暴露 web UI :6767;host 是注册的执行机;Docker Compose / Render / Railway / Fly.io / HF Spaces / Modal / Cloudflare(serverless scale-to-zero)/ Databricks Apps。Alpha 状态。
**活跃度**:1,889 commits / 1.2K forks / Apache-2.0。

**来源**:[github.com/omnigent-ai/omnigent](https://github.com/omnigent-ai/omnigent)

---

### 2.6 stellarlinkco/myclaude — Multi-backend 编排

**是什么**:`npx github:stellarlinkco/myclaude` 安装,在 Claude Code 之上做 4 后端(Codex / Claude / Gemini / OpenCode)编排。Go workspace + Python installer + Shell。

**harness 设计独到之处**:
- **Orchestrator/Executor 分离**:Claude Code 当 planner(规划/上下文/验证),`codeagent-wrapper`(Go 二进制)当 executor(实际代码生成),wrapper 屏蔽 4 种 CLI 的流式 JSON / resume 差异。
- **模块化**:do(5 阶段特性开发)/ omo(智能路由多 agent)/ bmad(6 agent 敏捷)/ sparv(Specify→Plan→Act→Review→Vault)/ essentials(11 核心命令)/ course + claudekit(composite)。
- **Hook 注入**:`claudekit` 装全局 hook(pre-bash / inject-spec / log-prompt)到 Claude Code 环境层。
- **Workflow 选择矩阵**:特性开发 → `/do`、bug 调查 → `/omo`、企业 → `/bmad-pilot`。

**活跃度**:AGPL-3.0(有商业选项)。

**来源**:[github.com/stellarlinkco/myclaude](https://github.com/stellarlinkco/myclaude)

---

### 2.7 yohey-w/multi-agent-shogun — 武士阶层 × tmux

**是什么**:Shell 写的编排系统,通过 tmux 协调 7 种 CLI(Claude Code / Codex / Copilot / Kimi Code / OpenCode / Cursor / Antigravity),日本封建主题命名。v5.1.0 "Karo Traffic Control"。

**harness 设计独到之处**:
- **YAML 文件当消息总线 + inotifywait 事件驱动**★ 核心创新:消息内容存 YAML 文件,只通过 tmux `send-keys` 发"你有邮件"短 nudge;`inotifywait` 阻塞在内核事件,零 CPU 空转;`flock` 串行化写,零丢失。
- **封建层级**:Shogun(1,接收命令)→ Karo(1,分解/质控/dashboard)→ Ashigaru(7,并行执行)+ Gunshi(1,深度分析)。
- **Bloom 分类法路由**:L1–L3(记忆/理解/应用)→ Ashigaru;L4–L6(分析/评价/创造)→ Gunshi。`capability_tiers` 把每个模型映射到最大 Bloom 等级,自动路由。
- **底部向上 skill 发现**:Ashigaru 完成任务后自动识别可复用模式提名为 skill 候选,显示在 dashboard 等人工批准。
- **统一指令构建**:`instructions/` → `scripts/build_instructions.sh` 一次性生成 7 种 CLI 的指令文件,改一处全部同步。
- **手机集成**:ntfy 双向——手机 → Shogun(`ntfy_listener.sh` 流式接收);Karo → 手机(dashboard 更新直推)。配套 Android app(SSH + 语音 + 9 格监控)。
- **4 层上下文**:Layer 1 Memory MCP(跨项目)→ Layer 2 Project → Layer 3 YAML Queue → Layer 4 Session;`/clear` 后恢复成本 ~6,800 tokens。

**活跃度**:MIT / 292 forks。

**来源**:[github.com/yohey-w/multi-agent-shogun](https://github.com/yohey-w/multi-agent-shogun)

---

### 2.8 Danau5tin/multi-agent-coding-system — Context Store 模式

**是什么**:Python,Stanford TerminalBench #13(曾超 Claude Code),Apache-2.0。

**harness 设计独到之处**:
- **严格三角色 + 强制委派**★:
  | 角色 | 访问 |
  |------|------|
  | Orchestrator | **不读不写代码**,只在架构层 |
  | Explorer | 只读(file/grep/bash/临时脚本) |
  | Coder | 全读写 |
  Orchestrator 架构上不能走捷径,必须委派 + 验证。
- **Context Store**★ 核心创新:Orchestrator 显式告诉 subagent 要返回什么知识产物;产物累积为持久上下文;新任务只注入相关部分 → "每个 action 都建立在之前所有发现之上,subagent 从不需要重复发现同一信息"。
- **信任校准**:简单任务给 coder 高自主,复杂任务迭代分解为原子可验证步骤 + 大量 explorer 验证。
- **时间意识编排**:born from 观察复杂任务因 subagent 过多而超时 → "front-load precision"(花时间写精确描述)/ "over-provide context" / "tight scoping"。
- **双层记忆**:Context Store(知识)+ Task Manager(尝试过什么/失败为什么)→ 智能重试。

**性能**:Claude Sonnet-4 37.0% 成功率 / $263.56 / 93.2M tokens;Qwen-3-Coder-480B 19.7% / $217.83 / 14.7M tokens。后续 Orca-Agent-v0.1 用 RL 训练 14B 模型在此框架内,TerminalBench 相对提升 160.71%。

**来源**:[github.com/Danau5tin/multi-agent-coding-system](https://github.com/Danau5tin/multi-agent-coding-system)

---

### 2.9 jayminwest/overstory — Runtime adapter 抽象

**是什么**:npm `@os-eco/overstory-cli`,TypeScript/Bun。11 种 agent runtime adapter(Claude Code / Pi / Gemini / Aider / Goose / Amp / Copilot / Codex / Cursor / Sapling / OpenCode)。**已归档只读**,后继项目 Warren。

**harness 设计独到之处**:
- **`AgentRuntime` 接口**:真正的运行时抽象层,换 CLI 不改编排。每个 adapter 处理 spawning / config 部署 / guard 执行 / 就绪检测 / transcript 解析。
- **两层 agent 定义**:base `.md` 定义 HOW(工作流),per-task overlay 定义 WHAT(任务范围)。Base 自动注入到 overlay。
- **Instruction overlay + tool-call guard**:机械地阻止非实现 agent 修改文件,阻止所有 agent 的危险 git 操作。
- **Runtime-specific guard**:`settings.local.json` hooks(Claude Code)/ `.sapling/guards.json` / `.pi/extensions/` guard extensions / OS-level sandbox(Codex)。
- **SQLite 邮箱**:WAL 模式 ~1-5ms/query,8 种协议消息类型,广播(`@all` / `@builders`)。
- **FIFO merge queue**:SQLite-backed,4 级冲突解决 + sentinel-file locking。
- **三级 watchdog**:Tier 0(机械 daemon)→ Tier 1(AI 辅助 triage)→ Tier 2(monitor agent 持续舰队巡逻)。
- **Headless-first + tmux 逃生口**:反转常规——agent 默认作为 subprocess 跑,通过 web UI 看结构化事件;要交互才 `tmux attach`。
- **Gateway provider**:model 路由走 `provider/model-id` 格式,改 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 透明走代理。
- **Crash recovery**:session checkpoint + `ov sling --recover` 跳过 workable-status 检查重派。

**活跃度**:1,712 commits / MIT / os-eco 生态。

**来源**:[github.com/jayminwest/overstory](https://github.com/jayminwest/overstory)

---

### 2.10 ChesterRa/cccc — IM 群聊隐喻

**是什么**:Python,16 种 runtime(Claude Code / Codex / Copilot / Cursor / Devin / Kiro / Kilo / Antigravity / ChatGPT Web / Grok / Hermes / Droid / Amp / Auggie / Kimi / OpenCode + custom)。Apache-2.0。

**harness 设计独到之处**:
- **IM 群聊隐喻**★ 核心创新:把 agent 当群聊参与者。消息有路由(`@all` / `@peers` / `@foreman` / 特定 actor ID)、已读游标、attention ACK、reply-required 义务、结构化 `reply_to` + 引用上下文。
- **Append-only ledger**:状态存 `ledger.jsonl`,永不修改;可重放可审计;无数据库无 broker。
- **Single-writer daemon**:所有状态变更过单进程,消除竞态;Web UI(:8848)/ CLI / MCP / IM bridge 都是无状态前端。
- **Tracked send**:普通 `send` 是聊天;`tracked-send` 建持久委派工作项(title + outcome criteria + delivery tracking + acceptance trail)。
- **Group Bridge**:跨机器/团队连可信远程 CCCC 组,分层访问 messages-only → read(查本地上下文/repo/git via remote MCP)→ full(编辑/执行)。显式 per-connection 信任。
- **ChatGPT Web 当本地 actor**:通过浏览器投递 + remote MCP connector,ChatGPT Web/GPT-5.x 可作为真正群参与者(需 Cloudflare Tunnel / ngrok 公网 HTTPS)。
- **IM bridge**:Telegram / Slack / Discord / 飞书 / 钉钉 / 企微 / 微信,钉钉/企微支持流式回复。

**架构**:`CCCC_HOME` 运行时状态(默认 `~/.cccc/`),不在 repo 里;actor 可跑 PTY(嵌入终端)或 headless(结构化 I/O);MCP 工具给 agent 看 13 个"协作核心" + 按需更多。
**活跃度**:1,168 commits / 86 forks。

**来源**:[github.com/ChesterRa/cccc](https://github.com/ChesterRa/cccc)

---

### 2.11 gastownhall/gascity — Composable SDK

**是什么**:Go SDK,把 Gas Town 项目的基础设施抽成可配置工具箱。MIT。

**harness 设计独到之处**:
- **城市隐喻**:City(顶层,`city.toml` 声明)→ Rig(项目/workspace)→ Session(每个 agent)。
- **Beads 工作跟踪原语**:beads = work items + mail + convoys + formulas + molecules + waits;默认后端 Dolt(版本化 SQL),可切文件(`GC_BEADS=file`)。
- **K8s 风格 reconciliation**:controller/supervisor loop 把"期望状态"reconcile 到"运行状态"。
- **6 种 runtime provider**:tmux(默认)/ subprocess / exec / ACP(Agent Communication Protocol)/ K8s / herdr;可 per-agent / per-rig / city-wide 切换;hybrid 组合。
- **Convergence loops**:`internal/convergence/` 实现有界迭代精炼 + gate 处理——agent 不只是跑一次,而是迭代到正确 + 安全门。
- **Config composition**:`city.toml` 基础 + packs / patches / override resolution,可复用分层配置跨多项目。

**架构**:`cmd/gc/`(CLI)+ `internal/runtime/`(6 provider)+ `internal/config/` + `internal/beads/` + `internal/session/` + `internal/orders/` + `internal/convergence/` + `internal/api/`。文档 docs.gascityhall.com。
**活跃度**:5,314 commits / 336 forks / 17 watchers。

**来源**:[github.com/gastownhall/gascity](https://github.com/gastownhall/gascity)

---

### 2.12 unohee/OpenSwarm — Discord + Linear + 认知记忆

**是什么**:TypeScript,自主 AI 开发团队编排器。Linear issue 抓取 → Worker/Reviewer pair pipeline → Discord 报告 → LanceDB 长期记忆。MIT。

**harness 设计独到之处**:
- **混合模式**★ 核心创新:前沿模型(GPT-5.6-sol)只读诊断 → 轻量模型(gpt-5.6-terra)实现 + 验证循环。SWE-bench Lite 上解决了 3/3 所有轻量模型单独失败的实例,成本远低于纯前沿。
- **L0–L6 难度阶梯成本路由**:任务按合成难度 + 真实 GitHub issue(L6 = SWE-bench Lite)路由到对应模型。
- **认知记忆**:LanceDB + Xenova/multilingual-e5-base 嵌入;混合检索公式 `0.55 × similarity + 0.20 × importance + 0.15 × recency + 0.10 × frequency`;记忆类型 belief / strategy / user_model / system_pattern / constraint;后台衰减 / 整合 / 矛盾检测 / 蒸馏。
- **Repo Knowledge Loop**:Worker 随时间学习每个 repo——任务结果(成功模式/review 拒绝陷阱)按 repo 存,下次 worker prompt 自动召回。Worker 在任务中也可主动 `search_memory` 查累积知识。
- **确定性 baseline-diff 验证**:跑一次 repo test/typecheck,把 failing head 与 merge base 对比,pre-existing failure 不阻塞不相关工作。
- **Repo dependency closure for fix grouping**:`review --max --fix` 按依赖闭包分组 finding,独立 fix unit 在隔离沙箱并发跑;全部 area re-approve + 可信确定性验证通过才发 PR。
- **7 种 adapter**:`codex-responses` / `codex` / `gpt` / `openrouter` / `atlascloud` / `lmstudio` / `local`,运行时可切。
- **PM agent**:代码审计后,PM agent 把去重 finding 综合成 ≤10 个连贯 Linear issue。

**活跃度**:491 commits / MIT / Atlas Cloud 赞助。

**来源**:[github.com/unohee/OpenSwarm](https://github.com/unohee/OpenSwarm)

---

### 2.13 sipyourdrink-ltd/bernstein — 确定性编排

**是什么**:Python,40+ CLI agent adapter。调度逻辑纯 Python,协调环无 LLM。Apache-2.0。

**harness 设计独到之处**:
- **确定性零 LLM 编排**★ 核心创新:调度是纯 Python 代码。"Replay yesterday's plan and get yesterday's task graph。" 只有初始分解步骤用 LLM,下游全确定。非确定性表现为 hash mismatch 而不是 flaky re-run。
- **4 阶段**:Decompose(一次 LLM 调用 + roles/owned files/completion signals)→ Spawn(per-task worktree)→ Verify(janitor 查 tests pass / files exist / lint clean / types correct)→ Merge(verified → main;failed → retry or reroute to different model)。
- **Signed lineage spine** + **HMAC-chained audit log**:可选 `--audit` / `BERNSTEIN_AUDIT=1`,产密码学链 + Merkle seal,可离线验证不重跑。
- **Mixed-agent runs**:同一执行中,便宜的本地模型跑 boilerplate,重的云模型跑架构。
- **Declarative YAML DAG**:workflow manifest 支持 agent / command / loop 节点,`bernstein run plan.yaml` 跳过 LLM planning 直接跑预定义计划。
- **Air-gap deployment**:离线安装 profile。
- **Cluster mode**:分布式执行。
- **40+ adapter**:Claude Code / Codex / Gemini CLI / GitHub Copilot / Cursor / Aider / Goose / OpenAI Agents SDK / Amp / Cody / Continue / Devin Terminal / Junie / Kilo / Kiro / AWS Q Developer / Ollama / OpenCode / OpenHands / Open Interpreter / gptme / Plandex / AIChat / Letta Code / Qwen / … + 通用 `--prompt` 包装。

**活跃度**:4,051 commits / 81 forks;入选 vinta/awesome-python、Augment Code  roundup、Python Weekly #742。

**来源**:[github.com/sipyourdrink-ltd/bernstein](https://github.com/sipyourdrink-ltd/bernstein)

---

### 2.14 QoderAI/better-harness — 评估工作环

**是什么**:Node.js,评估 coding agent 的*工作流*而非最终 diff。插件形式跑在 Claude Code / Codex / Cursor / Qoder 内。MIT。

**harness 设计独到之处**:
- **5 维 Agent Work Loop 评估**★:
  1. Task Understanding(agent 知道目标和 done 标准吗?)
  2. Controlled Execution(工作在支持、可重复路径上吗?)
  3. Change Validation(有证据 change 有效吗?)
  4. Reliable Delivery(AI 速度绕过质量/验收检查了吗?)
  5. Learning Capture(下一个任务受益于这一个吗?)
- **认识论诚实**★:"unobserved behavior stays explicitly unobserved rather than becoming a fabricated score。" 拒绝为不可观察的事编造分数。
- **Evidence-bounded findings**:每个 finding 关联具体证据 + 影响 + 预期输出 + 有界修复动作 + 验收检查。
- **Feedforward + feedback 架构**:前向引导(`AGENTS.md` / specs / Skills / acceptance criteria)+ 后向传感器(linters / tests / Hooks / review agents)。
- **3 独立证据 agent + 1 主导 agent**:三个证据收集者分处不同领域(session evidence / project harness / agent customization),避免交叉污染,主导者统一分析。
- **纵向视图**:跨时间比较报告,追踪 5 维变化。
- **Thin host adapters**:核心 host-agnostic,每种 coding agent 只是薄适配层。

**活跃度**:41 forks / MIT。

**来源**:[github.com/QoderAI/better-harness](https://github.com/QoderAI/better-harness)

---

## 3. 设计模式横向对比

| 设计模式 | 代表仓库 | 简述 |
|----------|----------|------|
| **Meta-harness(harness 的 harness)** | agent-orchestrator / omnigent / overstory / better-harness | 不实现 agent,而是在现有 agent CLI 外加编排/评估层 |
| **Git worktree 隔离** | multica / orca / agent-orchestrator / bernstein / overstory / omnigent / gascity | 每 agent 独立 worktree,文件系统不冲突 |
| **YAML/file-as-message-bus** | multi-agent-shogun / bernstein / cccc | 消息存文件 + 内核事件唤醒,零轮询零 API 费 |
| **CLI-as-Tool-Interface** | orca / multica / overstory / cccc / multi-agent-shogun | agent 通过 CLI 命令与编排系统通信,无需集成 SDK |
| **Preamble 注入** | orca / overstory / multi-agent-shogun | dispatch 时把行为契约烧进 prompt stdin |
| **自动反馈闭环** | agent-orchestrator / OpenSwarm / bernstein | CI 失败 / review comment / merge conflict 自动路由回对应 agent |
| **Context Store / 累积知识** | multi-agent-coding-system / OpenSwarm / multi-agent-shogun | 跨 agent 持久化知识产物,新任务只注入相关部分 |
| **Deterministic / 无 LLM 调度** | bernstein / multi-agent-shogun | 调度逻辑纯代码,可重放可审计 |
| **混合模型路由(前沿诊断 + 轻量实现)** | OpenSwarm / wshobson/agents / oh-my-claudecode / multi-agent-shogun | 难任务用贵模型,简单任务用便宜模型,成本感知 |
| **IM/Chat 隐喻** | cccc / OpenSwarm / multi-agent-shogun | 把 agent 当群聊参与者而非孤立工具 |
| **Skill 自动提取** | oh-my-claudecode / multi-agent-shogun / OpenSwarm | 从完成的任务中提取可复用模式,自动注入后续上下文 |
| **Multi-harness portability** | wshobson/agents / agency-agents-zh / omnigent / overstory | 一份 agent 定义 → 多种工具原生格式 |
| **Policy / governance** | omnigent / cccc / bernstein | 三层 policy / 审计链 / 权限边界 |
| **DAG / 声明式 workflow** | gascity / agency-agents-zh / bernstein | 显式依赖图 + K8s 风格 reconciliation |
| **Tiered watchdog** | overstory | Tier 0(机械)→ Tier 1(AI triage)→ Tier 2(monitor agent 巡逻) |

---

## 4. 最具新颖性的 idea 综述

从 14 个仓库里挑出 6 个**最具新颖性**的设计思想,按对 vibe-ide 可借鉴度排序:

### 4.1 Context Store / 累积知识(multi-agent-coding-system)★

**为什么新**:不是给 agent 塞所有上下文,而是让 orchestrator 显式指定每个 subagent 要返回什么"知识产物",累积为持久 store,新任务只注入相关部分。"每个 action 建立在之前所有发现之上,从不需要重复发现同一信息"。

**对 vibe-ide 的价值**:本项目 session 独立。若做"主 agent 调度多个子 agent"(参考 `doc/agent-hub.md`),可直接抄这个"知识产物累积 + 选择性注入"模式——每个 session 完成后提取 artifacts 到共享 store,新 session prompt 只注入相关部分,避免上下文爆炸。

**来源**:[github.com/Danau5tin/multi-agent-coding-system](https://github.com/Danau5tin/multi-agent-coding-system)

### 4.2 自动反馈闭环(agent-orchestrator)★

**为什么新**:不只是并行跑 agent,而是 CI 失败 / code review comment / merge conflict **自动路由回创建该 PR 的 agent session**。"fire and forget" → "managed, self-correcting"。

**对 vibe-ide 的价值**:本项目的 GitTab + CI 反馈已有基础。若 AgentHub(`doc/agent-hub.md`)做任务后自动跑 CI,失败路由回原 agent session 重试,形成闭环。这是 multica/orca 都没有的。

**来源**:[github.com/Untrivial-ai/agent-orchestrator](https://github.com/Untrivial-ai/agent-orchestrator)

### 4.3 YAML-as-message-bus + inotifywait 零轮询(multi-agent-shogun)★

**为什么新**:消息内容存 YAML 文件,只通过 tmux send-keys 发"你有邮件"短 nudge;`inotifywait` 阻塞在内核事件,零 CPU 空转;`flock` 串行化写,零丢失。对比其他项目用 PostgreSQL / SQLite / API poll。

**对 vibe-ide 的价值**:本项目 Electron 主→渲染是 IPC,但 agent CLI 是 subprocess。若做"多 agent 协作",用 YAML + `fs.watch`(Node 的 inotify)做消息总线,agent subprocess 通过文件读写通信,零 API 费 + 零轮询,符合"偏好最简实现"。

**来源**:[github.com/yohey-w/multi-agent-shogun](https://github.com/yohey-w/multi-agent-shogun)

### 4.4 确定性零 LLM 调度 + HMAC 审计链(bernstein)

**为什么新**:协调环无 LLM,调度是纯 Python 可重放。可选 HMAC 审计链 + Merkle seal 离线验证。非确定性表现为 hash mismatch 而非 flaky re-run。其他项目普遍用 LLM 在调度环里。

**对 vibe-ide 的价值**:若做"任务分解 + 派发",调度逻辑本身应该是确定的——只有分解步骤用 LLM,后续派发 / 重试 / 路由全代码。审计链适合合规场景。

**来源**:[github.com/sipyourdrink-ltd/bernstein](https://github.com/sipyourdrink-ltd/bernstein)

### 4.5 IM 群聊隐喻 + append-only ledger(cccc)

**为什么新**:不是把 agent 当孤立工具或 DAG 节点,而是当群聊参与者——已读游标、attention ACK、reply-required 义务、`@mention` 路由。Append-only `ledger.jsonl` 永不修改,可重放可审计。Single-writer daemon 消除竞态。

**对 vibe-ide 的价值**:本项目 session 已有"聊天"形态。若做"多 session 协作",把 session 当群参与者,session 间消息有已读/ACK/回复义务,比纯任务队列更符合人类协作直觉。

**来源**:[github.com/ChesterRa/cccc](https://github.com/ChesterRa/cccc)

### 4.6 混合模型路由(前沿诊断 + 轻量实现)(OpenSwarm)

**为什么新**:前沿模型(GPT-5.6-sol)只读诊断 → 轻量模型(gpt-5.6-terra)实现 + 验证循环。SWE-bench Lite 上解决了 3/3 所有轻量模型单独失败的实例,成本远低于纯前沿。其他项目的模型路由是按任务难度分级,这个是按**阶段**(诊断 vs 实现)分。

**对 vibe-ide 的价值**:本项目 `src/main/ai.ts` spawn Claude CLI,若做"子 agent",可用 Sonnet/Haiku 做具体实现,Opus 只做 review/诊断,显著降本。OpenSwarm 的 `0.55 × similarity + 0.20 × importance + 0.15 × recency + 0.10 × frequency` 混合检索公式可直接抄到"认知记忆"实现里。

**来源**:[github.com/unohee/OpenSwarm](https://github.com/unohee/OpenSwarm)

---

## 5. 与已有报告(multica / orca)的关系

| 维度 | multica | orca | 本报告新项目共有趋势 |
|------|---------|------|----------------------|
| 定位 | Agent-as-Teammate 任务平台(Jira-for-agents) | Agent 编排 ADE(orchestrator) | Meta-harness(harness 的 harness)居多 |
| Fan-out | 手动 1:1 + squad leader agent 驱动 | 手动(task-create N 次) | 同样手动,无自动 fan-out 比较选胜者 |
| Agent 选择 | 静态绑定 agentID + runtimeID | 运行时从 pool 挑空闲 terminal(FIFO) | 多引入"成本感知路由" / "能力阶梯" |
| 持久化 | PostgreSQL | SQLite | SQLite 居多(bernstein 用文件),PostgreSQL 少 |
| 多 provider | 16 种 backend | 25+ CLI(terminal 跑任意) | 11–23 种 adapter 抽象层居多 |
| 自动反馈闭环 | 无 | 无 | agent-orchestrator / OpenSwarm 有 |
| 确定性调度 | 无 | 无 | bernstein / multi-agent-shogun 有 |
| 知识累积 | Skill 系统(solutions → skills) | 无 | Context Store(multi-agent-coding-system)/ Repo Knowledge Loop(OpenSwarm)/ Memory MCP(shogun) |

**一句话**:本报告新项目相比 multica/orca 的共性增量是——**Meta-harness 抽象层 + 自动反馈闭环 + 成本感知模型路由 + 知识累积 + 确定性/可审计调度**。multica 的强项在"任务平台"抽象(squad/autopilot/PostgreSQL 多副本),orca 的强项在"Computer Use" 原生Accessibility API,这些本报告新项目都没复现。

---

## 6. 数据来源与核验记录

| 项 | 来源 | 核验结果 |
|----|------|----------|
| 14 仓库存在性 | WebFetch 直接访问各 GitHub 仓库页面 | ✅ 全部返回 200 + README 内容 |
| Stars / 描述 / 语言 / topics | WebFetch 从 GitHub 仓库页面提取 | ✅ 一手数据,未二次转述 |
| 架构 / 设计模式 / 代码组织 | WebFetch 提取的 README 详细内容 | ✅ 一手 README 内容;部分仓库(如 overstory)自述"已归档"也是从页面直接读到 |
| "multica-ai/agent-harness 不存在" | WebFetch 返回 404 | ✅ 一手验证 |
| multica / orca 对比 | 引用本报告已核验的 `doc/multica-research.md` / `doc/orca-ade-research.md` | ✅ 不重复核验 |
| 未深读源码 | — | ⚠️ 本报告基于 README,未 clone 源码核验内部实现(与 multica/orca 报告不同);具体常量/行号级论断缺失 |

---

## 7. 对 vibe-ide 的总体建议

**最值得借鉴的 3 个 idea**(按"偏好最简实现"排序):

1. **YAML-as-message-bus + fs.watch**(来自 multi-agent-shogun) — 零 API 费、零轮询、文件即真相,完全符合"偏好最简实现"+ "session 独立"。
2. **Context Store / 累积知识**(来自 multi-agent-coding-system) — 解决"多 agent 重复发现同一信息"问题,实现简单(每 session 完成提取 artifacts 到共享目录)。
3. **自动反馈闭环**(来自 agent-orchestrator) — CI 失败自动路由回原 agent session,把"fire and forget"变"self-correcting"。本项目 GitTab + pty 已有基础。

**不推荐现在抄**:
- 全栈 SaaS taskboard(multica 路线)— 桌面 IDE 不需要
- PostgreSQL / Dolt 持久化 — 桌面用文件系统/SQLite 够
- 16+ provider 全家桶 — 先 claude + codex 两种就够
- K8s / cloud sandbox 集成 — 桌面场景不适用

**与 `doc/agent-hub.md` 的关系**:AgentHub 草稿的"并行任务板 + diff 预览 + 技能复用"与本报告项目方向一致,可补充"自动反馈闭环"(CI 失败路由回原 session)+ "Context Store"(跨 session 知识累积)+ "YAML 消息总线"(session 间协作)三个维度。
