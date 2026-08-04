# OpenWorker 调研:吴恩达团队的桌面 AI Coworker

> 调研对象:[andrewyng/openworker](https://github.com/andrewyng/openworker) — 吴恩达(Andrew Ng)个人 GitHub 下的开源**桌面 AI Coworker**(本地优先、成品交付型 agent)。
> 调研日期:2026-08-04。基于 GitHub API + 官方站点一手核验;仓库 HEAD = main 分支,115 commits,`pushed_at` 2026-08-01,最新 release **v0.1.7**(2026-07-30)。
> 核验:仓库存在、README、源码关键路径、`openworker.com`、aisuite README 均已直接核验(方法见文末 §9)。公告日期/团队背景来自二手来源转引的 X 帖与媒体,**未能在本会话直接抓取 X 原帖**,已标注。

---

## 1. 项目身份

| 字段 | 内容 |
|------|------|
| 仓库 | https://github.com/andrewyng/openworker (MIT) |
| 官网 | https://openworker.com (产品页 + Privacy/Terms,无独立文档站) |
| 归属组织 | **`andrewyng` 个人 GitHub 账号**(type=User,非 org)。GitHub API 未显示 Landing AI / AI Fund 关联——README、源码、官网均无提及,该关联**无法从一手源确认** |
| 共建/主要维护 | **rohitprasad15(96 commits,共 ~115)**、devikaverma(12)、andrewyng(1)。Rohit Prasad 为前 Amazon Alexa 首席科学家/AGI 负责人——背景来自二手来源 |
| Stars / Forks | **12,693** / 1,708(2026-08-04 GitHub API 实测);open issues 378;`Trendshift` 徽章见 README |
| License | MIT(GitHub API `license.spdx_id` = MIT) |
| 语言 | Python(主仓库) |
| 创建时间 | 2026-07-20;活跃开发中(pushed 2026-08-01) |
| Releases | v0.1.7(2026-07-30,最新)← v0.1.6 / v0.1.5 / v0.1.4;每版含 macOS arm64 + Windows x64 资产 |
| 平台 | macOS 12+(Apple Silicon,签名/公证/自更新);Windows 10/11 x64(构建已发布但**未代码签名**,SmartScreen 会警告,README 自述 signing in progress);无 Linux |
| 状态 | **Open beta**(README 原话:"fully usable, updates itself, and we're actively polishing rough edges") |
| 一句话定位 | "**AI that gets your everyday tasks done**"——交付**成品**而非聊天:文档、Slack 回复、日历更新、收件箱整理 |
| 公告 | 2026-07-23(美东)/24(北京时间)Andrew Ng 在 X 宣布,与 Rohit Prasad 共同发布——日期与引文来自二手来源,**X 原帖 URL 未核验** |

---

## 2. 项目定位与面向人群(README 一手)

- **目的**:把"结果"交给你,而不是"待办清单"。README "How it works" 四步:① 描述想要的成果("prepare a customer brief" / "untangle my calendar" / "draft a report" / "check where the release stands across Jira and GitHub");② 拆解步骤并在桌面、文件、已连接应用间工作;③ 任何有后果的动作(发消息、改日历、跑命令)前**暂停征求批准**;④ 交付成品文件/回复。
- **面向谁**:个人日常知识工作者;官网预置用例按角色分组(Sales / Executive Assistant / Marketing / Ops On-call)。
- **能力清单**(README):
  - 产出真实交付物:文档、表格、报告、网页落成文件
  - 从 Slack 用:@OpenWorker 提会话,结果回线程
  - 25+ 集成(GitHub、Slack、Jira、Notion、Linear、HubSpot、Outlook、monday.com、Gmail、Google Calendar)+ **终端和本地文件**;任何 MCP 工具可插拔、per-tool 控制
  - 定时自动化(recurring work),运行记录全量保留
  - 写/发/跑命令审批门控;无人值守(unattended)运行把待批项投进 inbox,而非擅自行动
- **BYOK 模型**(README):OpenAI · Anthropic · Google Gemini · Inkling(Thinking Machines) · GLM(Z.ai) · DeepSeek · Kimi(Moonshot) · Qwen · MiniMax · Mistral · Grok(xAI),另有开源权重走 Together / Fireworks、全本地走 Ollama。GUI 的 provider logos 还含 bedrock / meta / openrouter。
- **隐私**(README):local-first。agent loop、对话、连接器 token、模型 key 全在本地 secret store;**唯一云端组件是 OAuth 握手 broker**;不登录也能用(手工创建凭证)。

---

## 3. 架构与关键概念

### 3.1 总览(README 架构图 + 源码核验)

```
┌───────────────────────────────────────────────────────┐
│            OpenWorker 桌面 App (Tauri 2 + React 18)      │  surfaces/gui/ (React) + src-tauri/ (Rust shell)
├───────────────────────────────────────────────────────┤
│           本地 agent server (Python FastAPI)            │  coworker/server/app.py · 127.0.0.1:8765
│   TurnEngine · tools · connectors · permissions · memory│   built on aisuite (agents layer)
├──────────────┬────────────────────┬───────────────────┤
│  你的文件/终端 │  25+ connectors     │  你的模型(任意 provider)│  一切用你的 key、在你机器上跑
└──────────────┴────────────────────┴───────────────────┘
```

### 3.2 核心模块(均已从 GitHub API 核验文件存在)

| 模块 | 文件 | 职责 |
|------|------|------|
| Agent Loop | `coworker/engine.py`(1193 行) | `TurnEngine`——**owned agent loop**:async,阻塞式 provider/tool 调用包在 `asyncio.to_thread`;一次 user turn 内循环 model↔tool 直到模型不再要工具/护栏触发/被打断;低风险读类工具**并发**执行、写/命令**严格串行**;`max_iterations=12` 默认 |
| 审批 | `coworker/permissions.py`(239 行) | `PermissionEngine` + `Mode`:DISCUSS / PLAN(只读)/ INTERACTIVE(默认,写/命令需批)/ AUTO / CUSTOM;shell 元字符(; ` & `|` > < `` ` `` `$(` 换行)使命令**丧失白名单自动放行权**;`Decision.needs_user` → 引擎发 `PERMISSION_REQUIRED` 事件交给 approver |
| 审批回执 | `coworker/engine.py` | `ApprovalOutcome`:ONCE / ALWAYS_TOOL / ALWAYS_COMMAND / DENY |
| 模型 Provider | `coworker/providers/registry.py`(867 行) | `ProviderDescriptor`(UI 表单字段)+ factory → `ProviderClient`;`ProviderRouter` 按模型串的 `provider:` 前缀选 provider。内置:`openai`(默认,Responses API + OpenAI 兼容网关/Azure `/openai/v1`)、`anthropic`(Messages API)、`gemini`、`bedrock`(自有 AWS 账户)、`vertex`(自有 GCP,含 MaaS 开源权重)、`ollama`(本地,`http://localhost:11434`) |
| Server | `coworker/server/app.py`(2078 行) | FastAPI:**OpenAI 兼容 `/v1/chat/completions` 代理** + **WS 会话 API**(引擎事件流 + 审批通道)+ REST;loopback 绑定 `127.0.0.1:8765`;Origin 白名单(tauri://localhost 等);WS 帧/速率上限 + 文本 200k 字符限制 |
| Agent 表面 | `coworker/agents/` | `Agent` 数据类(name/title/system_prompt/needs_workspace/tool_factory/family/messaging/connectors);内置 **Code / Chat / Cowork / MyHelper**(`base.py`、`chat.py`、`code.py`、`cowork.py`、`myhelper.py`);`registry.py` 委托 persona registry |
| Cowork agent | `coworker/agents/cowork.py` | 面向"isolated problem → deliverable"的知识工作 agent;工具集 `["files","search","shell","todo"]`(files 为多根变体);与 MyHelper 共用同一工具工厂 |
| 工具 | `coworker/tools/` | registry / files / git / search(ripgrep)/ shell / todo / plan / ask / subagent / directories |
| 连接器 | `coworker/connectors/` | `descriptors.py`(1471 行,数据驱动设置向导)、`tools.py`(send_message/send_file 等)、`tool_defs.py`、`setup.py`;含 MCP-backed 连接器(本地 MCP OAuth,DCR 流程) |
| MCP | `coworker/mcp/` | MCP client(stdio + streamable-http;`mcp>=1.1,<2` 锁定,因 2.0 移除了 streamable_http_client)+ oauth |
| 记忆 | `coworker/memory/sqlite_store.py` | SQLite 持久化记忆 |
| 自动化 | `coworker/automation/scheduler.py` | croniter 算下次触发;`store.py` 持久化 |
| Skills | `coworker/skills/` | Anthropic 格式能力,任意 agent 可加载(最近 commit #391 "Add support for Skills") |
| 语音输入 | `stt/`(Rust) | `ocw-stt` sidecar:`cpal` + `whisper-rs` 本地离线 STT |
| 桌面壳 | `surfaces/gui/src-tauri/` | Tauri 2(`lib.rs`/`main.rs`/`tauri.conf.json`),`tauri-updater` 插件(endpoints 指向 download.openworker.com + GitHub releases) |
| GUI | `surfaces/gui/` | React 18 + Vite + TypeScript + Tailwind;`src/connectors/registry.tsx` 连接器 logo 注册表;`src/App.tsx` 等 |

### 3.3 关键概念/术语

- **TurnEngine / owned agent loop**:单机单 loop 的 agent(非多 agent 编排);一个 turn 内多轮 tool-call。
- **Persona**:顶层会话表面(Code/Chat/Cowork/第三方 markdown persona),`personas/` 有 builtin/ops.md。
- **Skill**:与 agent 正交的可加载能力(Anthropic 格式)。
- **PermissionEngine / Mode / Decision**:`allowed` / `needs_user` / reason + 会话 allowlist + 参数模式(路径在 root 下、命令前缀)。
- **Approver**:注入的 async 回调,`needs_user` 时 engine 阻塞等批准(out-of-band)。
- **Connector / Descriptor**:数据驱动(名称、auth 方式、字段、validate),"加连接器多是改数据不是改 UI"。
- **Inbox / Unattended**:无人值守运行把审批项投 inbox,支持 durable resume(`PermissionRequest.tool_call_id`)。
- **Automation**:cron 定时任务(早晨简报/周报/频道值守)。
- **ProviderRouter / ProviderDescriptor**:模型串前缀选 provider 并缓存 client。
- **Plan 契约**:PLAN 模式读只读 + `propose_plan` → 批准 → 执行(见 `test_plan_mode.py`)。

---

## 4. 技术栈

| 层 | 技术(一手:`pyproject.toml` / `package.json` / `Cargo.toml` / `tauri.conf.json`) |
|----|------|
| 后端运行时 | **Python ≥3.10**;FastAPI、uvicorn[standard]、pydantic v2、httpx、websockets |
| 模型 SDK | openai≥1.0、anthropic≥0.40、google-genai≥1.0(原生 Gemini)、google-auth(Vertex)、boto3(bedrock 可选) |
| Agent 框架 | **aisuite @ git+https://github.com/andrewyng/aisuite.git@1b4bbf303…**(钉到导入时 commit;README 明示 swap 到 PyPI pin) |
| 工具/连接器 | `mcp>=1.1,<2`(stdio+streamable-http)、ddgs(DuckDuckGo 无 key 默认网页搜索)、croniter、python-telegram-bot/slack-bolt/aiohttp(messaging extra)、playwright(browser extra) |
| PDF | pypdf(文本提取)+ pypdfium2(栅格化;注释明确排除 AGPL 的 PyMuPDF,因为不能进 DMG) |
| 桌面 | **Tauri 2**(Rust)+ **React 18** + Vite 5 + TypeScript + Tailwind 3;pdfjs-dist、react-markdown、remark-gfm、xlsx、simple-icons |
| STT | Rust sidecar:cpal + whisper-rs + ureq(local, offline) |
| 模型提供商 | openai / anthropic / gemini / vertex / bedrock / ollama(registry.py 一手);GUI logos 另含 deepseek / kimi / qwen / meta / minimax / mistral / xai / zai / together / fireworks / openrouter |
| CLI/入口 | `[project.scripts]`:`openworker`(cli.py)、`openworker-server`(server.run:main)、`openworker-connectors`(connectors.cli:main) |

---

## 5. 安装 / 快速开始(README 一手)

下载:macOS(Apple Silicon)→ https://download.openworker.com/mac ;Windows 10/11 x64 → https://download.openworker.com/windows(未签名)。
GitHub releases 直链(aisuite README):`OpenWorker-macos-arm64.dmg`、`OpenWorker-windows-setup.exe`。

源码运行(README):
```shell
git clone https://github.com/andrewyng/openworker
cd openworker
# 1. 一次性引导,创建 .venv(Windows 上从 Git Bash 或 WSL 跑)
bash packaging/setup_dev_env.sh
# 2. 启动本地 agent server
.venv/bin/openworker-server --cwd ~/some/project --port 8765
#    (Windows: .venv\Scripts\openworker-server.exe)
# 3. 第二终端启动 UI
cd surfaces/gui
npm install
npm run dev        # Vite dev 端口上的浏览器 UI
# 桌面 App 版:把第 3 步换成 npm run tauri dev
```
- standalone server 在 `<state-dir>/sidecar-8765.token` 生成每启动 token,Vite 读取它;直接 API 调用把它放 `X-OpenWorker-Token` 头。桌面 App 用内存 token,不落盘。
- 测试:`.venv/bin/pytest`(server);`npm test` / `npm run e2e`(GUI);打包 `packaging/build_dmg.sh` / `packaging/build_windows.ps1`。
- 配置示例见 `docs/config.example.toml`:默认 `model="gpt-5.5"`、`mode="interactive"`、`max_iterations=12`、`allowed_commands`(ls/cat/git status…)、`auto_allow`(CUSTOM 模式)、`host=127.0.0.1, port=8765`。配置文件路径:`~/.config/coworker/config.toml`(全局)或 `<project>/.coworker/config.toml`(per-workspace 覆盖)。

---

## 6. 授权与现状

- **License:MIT**(GitHub API + LICENSE 文件)。
- **Stars/热度**:12,693 stars / 1,708 forks(2026-08-04 API 实测;二手报道称发布当日 ~3.7k、一周 ~11–12k,并登 GitHub Trending)。README 挂 Trendshift 徽章。
- **活跃度**:created 2026-07-20,pushed 2026-08-01;最新 release v0.1.7(2026-07-30);近期 commit 含 "Add support for Skills (#391)"、"mcp: global config wins"、"security: block SSRF/CGNAT" 等——**活跃维护中**,且每版同时出 macOS/Windows 资产。
- **贡献者**:rohitprasad15(96)、devikaverma(12)、andrewyng(1)、另 5 名单次贡献(API 实测)。「andrewyng 只 1 commit」说明实际开发由 Prasad 主导,与"aisuite 内孵化后迁出"的 README 自述一致。
- 社区反馈(二手):早期有"产品化差距"批评(多模型兼容、数据流、权限控制),被形容为"geek's toy"。属第三方评价,非一手。

---

## 7. 官方文档 / 规格

- **无独立文档站**:仓库无 GitHub Pages、无 wiki、无 discussions(GitHub API 一手)。官网 openworker.com 也只有产品页 + `/privacy.html`、`/terms.html`。
- **仓库内 `docs/`**:当前仅 `docs/assets/how-it-works.png` 和 `docs/config.example.toml`——README 声称的 "Design specs and decision logs" **目前无对应文件**(可能与 aisuite 一起钉在历史 commit,未核验)。
- 规格性材料:README 全文 + `docs/config.example.toml` 即现有最接近"规格"的东西。aisuite 侧有 `docs/chat-completions-quickstart.md` 等(见 aisuite 仓库)。
- 官方公告:Andrew Ng 的 X 帖(2026-07-23/24)+ 其 newsletter **The Batch** 有提及(安全审查梗)——后者仅见二手转引,**一手 URL 未核验**。

---

## 8. 局限与疑点(诚实标注)

1. **公告与团队背景为二手转引**:X 原帖、The Batch 文章本会话未能直接抓取;「发布日 07-23/24」「Rohit Prasad 前 Alexa 首席科学家」「Claude Code/Codex 拒审、用 GLM 5.2/Kimi K3 完成安全审查」等均标注为**未从一手核验**。contributors API 可证的只有 rohitprasad15 是主要维护者。
2. **Landing AI / AI Fund 关联不成立(就一手源而言)**:仓库 owner 是 `andrewyng` 个人账号;README/官网/源码零提及 Landing AI、AI Fund。声称"吴恩达团队"最稳妥的表述是"Andrew Ng 个人 GitHub + Rohit Prasad 主导开发"。
3. **Windows 状态矛盾**:README 已给出 Windows 下载且 v0.1.7 含 x64 资产(未签名),而 openworker.com 标注 Windows "Coming soon"——以 README 为准。
4. **`docs/` 目录名不副实**:README 说 "Design specs and decision logs",树里只有 config + 图。
5. **aisuite 依赖钉 commit**:`aisuite @ git+…@1b4bbf303`,非 PyPI 版本;README 承认待下个 aisuite 发版后换 pin。
6. **"25+" 连接器计数**:README 列表 + GUI `registry.tsx` 的 logo 注册表(simple-icons 品牌 + Slack/Salesforce/Outlook/Canva 内嵌 + Attio/Apollo/Hunter/Amplitude/Descript/Clay/Close/Docusign 自定义字形 + email/browser/MCP 工具字形)佐证 25+ 成立,但精确数字未在源码中数清。
7. **README 中模型名称用品牌名**(OpenAI/Anthropic/Gemini…),二手报道转写的具体型号(GPT 5.6 Sol / Claude Fable / Gemini 3.6)**未核验**。

---

## 9. 数据来源与核验记录

| 项 | 来源 | 核验结果 |
|----|------|----------|
| 仓库存在/归属 | GitHub API `GET /repos/andrewyng/openworker` | ✅ 200;owner=`andrewyng`(User);MIT;Python;12,693★/1,708 fork/378 issue;created 2026-07-20,pushed 2026-08-01;无 wiki/pages/discussions |
| README 全文 | GitHub contents API `README.md`(base64 解码) | ✅ 原文逐段引用 |
| 文件树 | GitHub API `git/trees/main?recursive=1` | ✅ §3.2 所列文件路径全部存在于树中 |
| 依赖/入口 | `pyproject.toml`、`surfaces/gui/package.json`、`stt/Cargo.toml`、`tauri.conf.json` | ✅ 原文核验 |
| 连接器数量佐证 | `surfaces/gui/src/connectors/registry.tsx` | ✅ 品牌 logo 注册表(>25 品牌) |
| 官网 | WebFetch openworker.com | ✅ HTTP 可达;仅产品页 + Privacy/Terms |
| 公告日期/团队背景 | 二手来源转引 X 帖 / The Batch | ⚠️ 未直接抓到一手帖,标注 unverified |
| 维护者 | GitHub API `contributors` | ✅ rohitprasad15=96 commits(共 ~115) |
| Releases | GitHub API `releases` | ✅ v0.1.7(2026-07-30)最新,10 资产(mac arm64 + win x64) |

> 引用的一手 URL:https://github.com/andrewyng/openworker(README / LICENSE / pyproject.toml / coworker/engine.py / coworker/agents/cowork.py / coworker/permissions.py / coworker/providers/registry.py / coworker/server/app.py / coworker/connectors/descriptors.py / surfaces/gui/src-tauri/tauri.conf.json / surfaces/gui/package.json / surfaces/gui/src/connectors/registry.tsx / stt/Cargo.toml / docs/config.example.toml)、https://openworker.com、https://github.com/andrewyng/aisuite(README,含 Agents API · Toolkits · MCP 层说明与 OpenWorker 迁移声明)。

---

## Sources

- https://github.com/andrewyng/openworker
- https://github.com/andrewyng/openworker/blob/main/README.md
- https://github.com/andrewyng/openworker/blob/main/LICENSE
- https://github.com/andrewyng/openworker/blob/main/pyproject.toml
- https://github.com/andrewyng/openworker/blob/main/coworker/engine.py
- https://github.com/andrewyng/openworker/blob/main/coworker/agents/cowork.py
- https://github.com/andrewyng/openworker/blob/main/coworker/agents/base.py
- https://github.com/andrewyng/openworker/blob/main/coworker/agents/registry.py
- https://github.com/andrewyng/openworker/blob/main/coworker/permissions.py
- https://github.com/andrewyng/openworker/blob/main/coworker/providers/registry.py
- https://github.com/andrewyng/openworker/blob/main/coworker/server/app.py
- https://github.com/andrewyng/openworker/blob/main/coworker/connectors/descriptors.py
- https://github.com/andrewyng/openworker/blob/main/coworker/connectors/tools.py
- https://github.com/andrewyng/openworker/blob/main/coworker/mcp/client.py
- https://github.com/andrewyng/openworker/blob/main/surfaces/gui/package.json
- https://github.com/andrewyng/openworker/blob/main/surfaces/gui/src-tauri/tauri.conf.json
- https://github.com/andrewyng/openworker/blob/main/surfaces/gui/src/connectors/registry.tsx
- https://github.com/andrewyng/openworker/blob/main/stt/Cargo.toml
- https://github.com/andrewyng/openworker/blob/main/docs/config.example.toml
- https://openworker.com
- https://github.com/andrewyng/aisuite
- https://github.com/andrewyng/aisuite/blob/main/README.md
- GitHub API(repos / git/trees / contributors / releases 端点,检索日期 2026-08-04)
