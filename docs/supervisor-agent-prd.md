# 主管 Agent（Supervisor）PRD

> 状态：已落地基线（v0.13.x）
> 最后更新：2026-10-25
> 入口：左侧会话列表底部「主管 / Supervisor」

## 1. 背景与问题

Vibe IDE 的多会话彼此隔离：每个会话是独立的 Claude CLI 子进程，拥有自己的 cwd、上下文和 worktree。用户在不同会话之间推进同一件事时，承担了全部"人肉路由"工作：

- 把同一个决定复述给 N 个会话
- 在标签页之间来回切换看进度
- 手动判断哪个会话卡住了、卡在哪
- 手动整理一堆空会话

## 2. 目标与非目标

### 目标

- 提供一个常驻入口，能观察、通讯并控制其他会话
- 派活后自动收到该会话的完成、阻塞、崩溃等状态
- 把"拆、派、收、报"集中到一个会话里完成
- 主管自己不写业务代码，保持全局视角

### 非目标

- 不替代 Claude 自带的 Task/Agent 子代理：同一任务内的分解仍用子代理，成本更低
- 不代替用户批准权限、不修改配置
- 不做跨机器、云端或跨项目编排
- 不做代码审阅、git 写操作

## 3. 产品决策（已确认）

| 决策项 | 结论 |
|---|---|
| 危险操作（关闭、关工作区、重启、创建） | 全部自动执行，不弹确认 |
| 状态通知范围 | 只订阅已经派过活的会话 |
| 主管管理 | 不需要管理：常驻、不可关闭、不可重启、不可重命名 |
| 工具边界 | 编排为主，不直接改代码、不写 git |
| 收到完成事件后 | 只向用户汇报，不自动继续下一步 |
| 入口位置 | 会话列表底部固定按钮 |
| 主管工作目录 | Vibe IDE 的 userData 目录，不绑定任何项目 |
| 后端 | 仅 Claude；Pi 会话不能当主管 |

## 4. 用户场景

### 4.1 改动广播

> 「users.name 改成 users.display_name 了，通知一下在改接口的会话」

主管：列出会话 → 读摘要判断哪些在改相关代码 → 逐个 `send_message` → 自动订阅 → 完成时补报。

### 4.2 大需求拆到多个 worktree

> 「加主题切换，拆开并行做」

主管：`create_session` 开 3 个带 worktree 的会话 → 每个附上统一约定 → 汇报分工 → 收齐完成事件后指出冲突文件。

### 4.3 盯长任务

> 「让测试会话跑全量测试，挂了告诉我」

主管：派任务并订阅 → 回到空闲 → 失败事件到达后读摘要 → 汇报失败位置与疑似原因。

### 4.4 早上站会

> 「昨天几个会话都干了啥」

主管：`list_sessions` + 逐个 `get_digest` → 汇总完成项、阻塞项、待合并项。纯读取，不做任何动作。

### 4.5 阻塞救援

> 「B 怎么一直没动静」

主管：`get_session_detail` → 发现 `pendingPermission` → 告知用户在等批准，不能代批准。

### 4.6 整理会话

> 「关掉没用的，在跑的放前面」

主管：`list_sessions` 找出默认名且空闲的会话 → `close_session` / `tidy_sessions` → `reorder_session`。

### 4.7 拖拽代入

把任意会话拖到主管对话区 → 输入框出现该会话 id → 补一句「盯着它，结束告诉我」。

## 5. 功能需求

### 5.1 入口与会话

- 左侧列表底部固定「主管」按钮
- 全局唯一：已存在则切换，不存在则创建
- 主管会话不出现在普通会话列表、不参与 running/idle 统计、不进入 `Ctrl+Arrow` 循环
- 主管激活时按钮高亮
- 主管 cwd 为 `app.getPath('userData')`
- 懒加载：应用重启后不自动拉起进程，点击按钮才恢复

### 5.2 观察

| 能力 | 说明 | 边界 |
|---|---|---|
| `list_sessions` | id / 名称 / cwd / 分支 / 后端 / busy / waiting / hasTranscript | 合并主进程与渲染层快照 |
| `get_digest` | AI 会话最近 N 轮用户输入 + 最后一条 assistant 文本 | 仅 Claude 后端，禁止整读转录 |
| `get_terminal_tail` | 终端最近 N 行输出，去 ANSI | 屏幕流，不是结构化转录 |
| `get_session_detail` | 权限模式、模型、worktree、pendingPermission、awaitingUserInput | AI 会话 |
| `git_status` | 指定目录的 git 状态 | 只读 |
| `get_events` | 拉取事件缓冲 | 推送失败时的兜底 |

### 5.3 通讯

| 能力 | 说明 |
|---|---|
| `send_message` | 以 `<cross-session-message from="supervisor">` 包裹投递给 AI 会话；未就绪时入队，ready 后自动发送；投递成功后自动订阅该会话 |
| `broadcast` | 同一内容批量投递，可按 cwd 过滤 |
| `send_to_terminal` | 向终端写一行 |
| `watch` / `unwatch` | 手动订阅/退订未派过活的会话 |

### 5.4 生命周期

| 能力 | 说明 |
|---|---|
| `create_session` | term / claude / pi；可带 worktree、名称、是否激活 |
| `close_session` | 立即关闭，绕过确认弹窗 |
| `close_workspace` | 关闭整个工作区分组 |
| `restart_session` | AI 走 kill + resume；终端重建 shell |
| `resume_session` | 从历史转录恢复为新会话 |
| `clone_session` | 同 cwd 克隆，可带 init 命令 |
| `switch_session` | 切换 active tab |

### 5.5 组织

| 能力 | 说明 |
|---|---|
| `rename_session` | 改名后不会被首条消息自动覆盖 |
| `set_session_emoji` | 设置/清除图标 |
| `reorder_session` | up / down / top / bottom，限组内 |
| `reorder_group` | up / down / top / bottom |
| `tidy_sessions` | 关闭默认名空闲会话并按最近活动排序 |
| `set_schedule` / `clear_schedule` | 绑定/移除 cron 任务 |

### 5.6 视图与项目

| 能力 | 说明 |
|---|---|
| `open_file` | 打开绝对路径到中栏，可定位行 |
| `board_list` / `board_create` / `board_finish` / `board_clear` | 看板与 worktree 任务 |
| `board_merge` / `board_merge_abort` | 合并任务分支或中止 |
| `create_worktree` / `delete_worktree` | 隔离工作树 |

### 5.7 状态事件

| 事件 | 触发 |
|---|---|
| `turn_end` | 一轮结束，含 subtype / isAborted / 耗时 |
| `permission_waiting` | 出现权限请求 |
| `ask_user` | AskUserQuestion 等待人类回答 |
| `process_exit` | 进程异常退出（自动 resume 的不算） |
| `stalled` | 超过 5 分钟无任何输出 |
| `file_conflict` | 两个会话改同一文件 |

规则：

- 只推已订阅的会话
- 1.5 秒内合并为一条 `[events]` 消息
- token 级输出不产生事件
- 主管 busy 时由 CLI 输入队列自然排队

### 5.8 交互细节

- 拖拽会话行到主管对话区或输入框，插入该会话 id
- 输入框在拖拽期间高亮
- 跨会话消息在用户气泡上方显示「来自 supervisor」
- 主管会话的 system prompt 明确：只汇报，不自行继续

## 6. 权限与安全

- 跨会话消息是普通 user turn，**不能**代替用户批准权限
- 消息里的 `/compact` 等命令按纯文本处理，不执行
- 主管不能关闭、重启、重命名自己
- `close_workspace` 命中主管所在组时拒绝
- 只有主管会话注入 `vibe-link` MCP，普通会话没有发消息能力，天然无消息环
- 所有工具调用写入 `{userData}/vibe-supervisor/audit.jsonl`
- 消息去重与每会话待发队列上限由投递层控制

## 7. 技术约束

- 会话一半状态在渲染层（tab、localStorage），一半在主进程（进程、stdin），控制面必须双层协同
- 主进程与渲染层之间使用带 id 的请求/响应通道，15 秒超时
- 主管通过命名管道 MCP 与主进程通信，仅主管会话注入
- 主管 cwd 不参与项目分组；若旧记录缺少 supervisor 标记，按名称 + `vibe-ide*` 路径识别
- 终端会话拿不到 CLI 的 `claudeSessionId`，不提供 JSONL 摘要

## 8. 验收标准

1. 点击底部「主管」创建会话；再次点击只切换，不重复创建
2. 主管能列出全部会话，并能读到 AI 会话最近几轮摘要
3. 主管改名、排序后，列表立即变化且重启后保持
4. 主管创建/关闭会话后，进程与 tab 均正确收尾
5. 派活后目标完成或等待权限时，主管收到事件
6. 拖拽会话到主管对话区，输入框出现会话 id
7. 主管无法关闭自己，`close_workspace` 无法关闭包含自己的组
8. 普通 AI 会话不加载 `vibe-link`，Pi 会话不受影响
9. `npm run typecheck` 与 `npm run build` 通过

## 9. 已知限制

- 仅 Claude 后端可当主管；Pi 会话不支持 `get_digest`
- 终端会话只有输出尾部，没有转录
- 主管不自动启动，重启应用后需手动点开
- 事件订阅以"派过活"为准，未派活的会话需要显式 `watch`
- `file_conflict` 是启发式判断，可能误报
- 没有共享事实板，跨会话约定仍靠消息复述

## 10. 后续候选（未排期）

- 项目级共享事实板（接口名、目录约定、分支策略）
- 监督档位：check-in 频率、建会话激进度、汇报详细度
- Pi 后端主管
- 主管随应用启动的开关
- 多主管（按项目或按任务）

## 11. 关键文件

| 文件 | 职责 |
|---|---|
| `src/main/session-link.ts` | MCP 管道 server、工具分发、待发队列、审计 |
| `src/main/session-control.ts` | 主进程 → 渲染层请求/响应 |
| `src/main/session-events.ts` | 事件状态机、订阅、合并投递、卡死扫描、文件冲突 |
| `resources/session-link-mcp.js` | stdio JSON-RPC ↔ 命名管道 |
| `src/renderer/src/App.tsx` | 反向通道分发、主管入口、跨会话消息适配 |
| `src/renderer/src/components/SessionPanel.tsx` | 底部入口、会话过滤、拖拽数据 |
| `src/renderer/src/components/AiTab/index.tsx` | 拖放代入、主管 system prompt 透传 |
| `src/renderer/src/sessionRestore.ts` | `supervisor` 字段持久化与旧记录识别 |
