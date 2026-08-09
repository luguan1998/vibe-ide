# Paseo 项目调研笔记

> 调研日期：2026-08-09，资料均来自 GitHub 仓库（README / docs / CHANGELOG / releases）与 GitHub API。

## 项目定位

Paseo 定位为"多编码 agent 编排层"（orchestration layer）：一套界面统一运行、监控、交互 Claude Code、Codex、GitHub Copilot、OpenCode、Pi 等编码 agent，跨桌面、移动端、Web、CLI 使用。核心卖点：**自己机器上运行**（self-hosted）、**多 provider 自由切换**（不锁 vendor）、**跨设备**（桌面开工、手机跟进）、**隐私优先**（无遥测、无强制登录）。[来源: https://github.com/getpaseo/paseo/blob/main/README.md]

核心哲学：模型会商品化，价值沉淀在编排层——"最好的模型每月在变，工作流层不变"。[来源: https://github.com/getpaseo/paseo/blob/main/docs/product.md]

## 核心概念

- **Daemon（守护进程）**：运行在用户机器上的本地 Node.js 服务，负责拉起/管理 agent 进程并通过 WebSocket 实时流式输出。agent 归 daemon 所有，客户端断开后 agent 继续运行。[来源: https://github.com/getpaseo/paseo/blob/main/docs/architecture.md]
- **Project / Workspace**：Project 从文件系统自动检测并按 git remote 分组；每个 project 可开多个 workspace，额外 workspace 是 git worktree 隔离副本，agent 在其中工作不影响主干。[来源: https://github.com/getpaseo/paseo/blob/main/docs/product.md]
- **Hub**：daemon 可选、显式出站连接到 hub.paseo.sh（Paseo Cloud），获得 `hub.execution.*` 授权，让云端向你的 daemon 下发 agent 执行（一次执行一个全新 workspace），Hub 管不到未关联的本地 agent。[来源: https://github.com/getpaseo/paseo/blob/main/docs/hub.md]

## 架构与技术栈

- **Daemon**：Node.js（`packages/server`），WebSocket API + 内置 MCP server + cron 调度 + loop 服务 + chat 房间。[来源: https://github.com/getpaseo/paseo/blob/main/docs/architecture.md]
- **客户端**：`packages/app`（Expo / React Native，iOS、Android、Web 共享 UI）、`packages/desktop`（Electron 外壳，打包并自动托管 daemon，支持 macOS/Linux/Windows）、`packages/cli`（Commander.js，Docker 风格子命令）。
- **通信**：单一 WebSocket 连接，JSON 文本帧 + 终端流二进制帧；协议 schema 在 `packages/protocol`。远程访问走官方 relay（**getpaseo/paseo-relay**，Elixir 分布式服务）：Curve25519 ECDH + XSalsa20-Poly1305（NaCl box）端到端加密，relay 零知识，二维码配对传输公钥。[来源: https://github.com/getpaseo/paseo/blob/main/docs/architecture.md]
- **官网**：TanStack Router + Cloudflare Workers（`packages/website`，paseo.sh）。[来源: https://github.com/getpaseo/paseo/blob/main/docs/architecture.md]

## Agent 接入协议（支持哪些 agent）

两种集成模式：ACP（Agent Client Protocol）与直连实现：

- **Claude Code**：直连，基于 Claude Agent SDK（TypeScript）[来源: https://github.com/getpaseo/paseo/blob/main/docs/providers.md]
- **Codex**：直连其 app-server（MCP agent 模式）[来源: https://github.com/getpaseo/paseo/blob/main/docs/providers.md]
- **GitHub Copilot**：内置 ACP provider（`copilot-acp-agent.ts`）[来源: https://github.com/getpaseo/paseo/blob/main/docs/providers.md]
- **OpenCode**：直连 [来源: https://github.com/getpaseo/paseo/blob/main/docs/providers.md]
- **Pi**：进程直连，走 `pi --mode rpc` [来源: https://github.com/getpaseo/paseo/blob/main/docs/providers.md]
- **OMP**：一等公民内置 provider（默认禁用），走 `omp --mode rpc-ui` [来源: https://github.com/getpaseo/paseo/blob/main/docs/providers.md]
- **自定义 provider**：ACP 一键目录支持 CodeWhale、Cursor、Hermes、Qwen Coder、Kimi Code 等，也可 `extends: "acp"` 自配 [来源: https://github.com/getpaseo/paseo/blob/main/docs/product.md]

反向接入：daemon 自带 **MCP server**，把 workspace、创建/分离 agent、调度、heartbeat、终端等 Paseo 工具暴露给其他 agent。[来源: https://github.com/getpaseo/paseo/blob/main/docs/product.md]

## 主要功能

- **桌面/Web**：split panes 并行跑多个 agent、终端、git 视图、in-app 浏览器、快捷键自定义、工作区模型。[来源: https://github.com/getpaseo/paseo/blob/main/docs/product.md]
- **移动端（iOS/Android）**：查看 agent 实时输出、发 follow-up、语音模式（听写 + 语音对话）、0.3.0 新增移动终端（文本选择/复制/粘贴）。[来源: https://github.com/getpaseo/paseo/releases/tag/v0.3.0]
- **CLI**：`paseo run --provider claude/opus-4.6 "任务"`、`paseo ls`、`paseo attach`、`paseo send`，可连远程 daemon。[来源: https://github.com/getpaseo/paseo/blob/main/README.md]
- **Skills**（供任意 agent 使用 Paseo 编排其他 agent）：`/paseo-handoff`（交接）、`/paseo-loop`（循环至达标）、`/paseo-advisor`（咨询）、`/paseo-committee`（双 agent 评审）。[来源: https://github.com/getpaseo/paseo/blob/main/README.md]
- **与 Claude Code / Cursor 差异**：Paseo 不是 agent 本体，而是"多 agent 指挥台 + 遥控器"——agent 照常用你自己机器上的 CLI/凭据，Paseo 只负责统一启动、监控、跨设备访问与互相编排；无厂商锁定，BYOK，且 agent 不因客户端退出而中断。[来源: https://github.com/getpaseo/paseo/blob/main/docs/product.md]

## 安装与使用

桌面端从 paseo.sh/download 下载即用（daemon 自动启动）；CLI/无头用 `npm install -g @getpaseo/cli && paseo`；也有 Docker 镜像 `ghcr.io/getpaseo/paseo:latest`（6767 端口）自托管 daemon + Web UI。[来源: https://github.com/getpaseo/paseo/blob/main/README.md]

## 项目状态

- **活跃度**：极活跃。仓库创建于 2025-10-13，首个 release v0.1.2 于 2026-02-11，至今约 200 个 release（几乎每日/每周多次）[来源: https://api.github.com/repos/getpaseo/paseo]、[来源: https://api.github.com/repos/getpaseo/paseo/releases]
- **规模**：12.8k stars、1.3k forks、约 132 位 contributor、702 个 open issues（社区量大）[来源: https://api.github.com/repos/getpaseo/paseo]
- **许可证**：AGPL-3.0（第三方组件保留原许可），代码完全开源 [来源: https://github.com/getpaseo/paseo/blob/main/LICENSE]
- **最新版本**：v0.3.1（2026-08-09）[来源: https://api.github.com/repos/getpaseo/paseo/releases]

## 最新动态（v0.2.x → v0.3.x）

- **0.3.0（2026-08-08）**：新增移动终端；侧边栏重设计（可自定义 host 名称/颜色、workspace 行显示项）；历史记录按 workspace/agent/branch 搜索；Command Center 可直接改模型/推理档位/模式并执行 git 操作；运行中 fork agent；韩语界面。[来源: https://github.com/getpaseo/paseo/blob/main/CHANGELOG.md]
- **0.3.1（2026-08-09）**：快捷键解绑与查看生效绑定、Pure black 主题、agent 状态动画环、Git 更新在超大仓库下的响应性修复等。[来源: https://github.com/getpaseo/paseo/blob/main/CHANGELOG.md]
- 0.2.x 期间：CLI 新增 thinking 档位、Nix 打包、Debian 包修复、会话导入等。[来源: https://github.com/getpaseo/paseo/blob/main/CHANGELOG.md]

## 未找到 / 不确定

- **商业化信息**：Hub（Paseo Cloud）是否收费、定价未在仓库公开资料中说明（未找到）。
- **移动端商店链接**：iOS/Android 具体商店页面未逐一验证，README 统一指向 paseo.sh/download。
- **内部指标**：用户数、收入等商业数据未公开（未找到）。
