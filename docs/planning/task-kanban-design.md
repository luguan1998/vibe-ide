# Vibe IDE 任务看板设计(task kanban)

> 状态:设计定稿 v2 · 访谈法得出 · 参考项目 [agtx](E:\ai\agtx)(Rust 终端看板,管理并行 coding agent)
>
> **v2 变更**:放弃双信号源(claude 结构化 + term 探测)混合方案,与 agtx 完全对齐 —— **全部任务统一终端型,纯终端探测驱动自动流转**。理由:一条管线覆盖所有 agent、终端全程可见可介入、零耦合 AiTab 内部;代价是失去 turn result / permission 结构化事件,由「Review→Done 人工 + 破坏性操作人工」两道闸兜底。

## 0. 访谈决策记录

| # | 分支 | 决策 |
|---|------|------|
| 1 | Task 与 Session 关系 | **Task 为一等实体**,终端会话是附属资源(agtx 模式);Backlog 卡可无终端存在 |
| 2 | 列驱动方式 | **全自动映射**,信号源 = 终端探测(v2:唯一信号源,无结构化通道) |
| 3 | worktree 归属 | **看板自建**(simple-git,agtx 模式):路径/分支名可控;不走 CLI `--worktree` |
| 4 | 完成判定 | **自动到 Review 为止**(空闲阈值驱动);Review→Done 必须人工点击 |
| 5 | 重启恢复 | **冻结 + 手动续**:重启后 pty 全灭,Running 卡冻结原列标「中断」,人工触发才重开终端注入恢复命令 |
| 6 | 副作用隔离 | **破坏性操作仅人工**(手动破坏):删 worktree/删分支只绑人工动作;自动流转零副作用 |
| 7 | 持久化 | **userData 下 JSON**:`{userData}/vibe-tasks/{workspaceHash}.json`(先例:`ai-context-windows.json`) |
| 8 | UI 位置 | **中栏全屏看板**:新增 `centerView === 'board'`(先例:mujica) |
| 9 | Agent 范围 | **全 agent 统一终端管线**(v2 定稿):任何 CLI agent 跑在 pty 里,看板只认终端信号,不区分 agent 身份 |

## 1. 从 agtx 继承 vs 有意分叉

| 维度 | agtx 做法 | 本设计 | 理由 |
|------|----------|--------|------|
| 实体模型 | Task 一体,tmux window/worktree 是挂件 | **相同**(终端替代 tmux) | 卡片先于进程存在才能有 Backlog |
| 会话载体 | tmux server "agtx" 每 task 一个 window | Vibe 原生 pty 会话,cwd=worktree | 不引入 tmux 依赖(Electron 内嵌 node-pty 已够) |
| 状态信号 | capture-pane 刮擦 + 内容哈希空闲检测 + 特征表 | **相同思路**:pty onData 环形缓冲 + lastDataAt + 可选特征表 | v2 决策:对齐 agtx,单一探测管线 |
| 存储 | SQLite 集中分库(index.db + projects/{hash}.db) | userData JSON 按工作区分文件 | Electron 内避免原生依赖;任务量级 << agtx |
| 列迁移 | 人工按键,迁移即副作用 | 自动漂移,副作用与迁移解耦 | 自动化 × 副作用 = 误清理事故 |
| 完成语义 | Done 也是人工按键 | Review→Done 人工,其余自动 | 相同精神:终审永远是人 |
| 断线恢复 | tmux window 存活即续(--continue) | 进程已死,重开终端注入恢复命令(per-agent 表) | Electron 无 tmux 常驻,必须显式重建 |
| 发命令进终端 | send_keys + prompt_triggers + auto_dismiss | PTY_WRITE 直写(无需等 picker 特征,v1 不做复杂交互序列) | Vibe 是 pty 直接父进程,写入即时到达;Ink TUI 渲染时序问题 v1 靠简单延时,踩坑后再引入 triggers |

## 2. 数据模型

```ts
// src/shared/types.ts 新增
type TaskStatus = 'backlog' | 'planning' | 'running' | 'review' | 'done'

interface TaskCard {
  id: string                    // uuid
  workspacePath: string         // 所属工作区(孤儿检测用,文件本身按 hash 隔离)
  title: string
  description?: string          // 启动时注入终端的 prompt(拼在 agent 命令后)
  status: TaskStatus
  agent: string                 // 'claude' | 'codex' | 'gemini' | ...(决定启动/恢复命令,不影响映射规则)
  terminalSessionId?: string    // 关联的 Vibe pty 会话 id;Backlog 卡为空
  launchCommand?: string        // 实际注入的完整启动命令(审计/重放用)
  worktreePath?: string         // 看板自建的 worktree
  branchName?: string           // task/{slug}
  baseBranch?: string           // 创建时快照,Done 后回溯用
  interrupted?: boolean         // 重启冻结标记
  createdAt: number
  updatedAt: number
}
```

要点:
- **没有 runner 字段了**(v2):所有任务同构,`agent` 只影响注入什么命令,不影响状态机
- 终端指针(`terminalSessionId`)可空 —— Backlog 卡的本质就是「无终端」
- 不存 plugin/phase 系统:v1 无插件,一卡一 prompt 一段生命周期

## 3. 状态机与自动映射规则(纯终端探测)

```
backlog ──人工[启动]──▶ (建worktree+开终端+注入命令) ──▶ running ──空闲阈值──▶ review ──人工──▶ done
                                                                          │
                  重启:任意非done列冻结 + interrupted=true ◀──────────────┘
```

| 列 | 进入条件 | 信号 |
|----|---------|------|
| backlog | 创建后未启动 | — |
| planning | v1 默认跳过(terminal 型无法可靠区分 plan 阶段);预留人工放置 | — |
| running | 终端存活且最近有输出 | lastDataAt 在阈值内(如 <30s) |
| review | 空闲:终端存活但连续 N 秒无新输出(默认 15s,沿 agtx 手感) | lastDataAt 超阈值;**含 agent 已退出的情形**(见下方坑位说明) |
| done | **仅人工** | — |

### 信号采集层(Vibe 版 capture-pane)

- 挂点:`main/pty.ts` 的 `ptyProcess.onData`(150 行,全终端数据唯一咽喉)—— 每会话维护 `{ ringBuffer: 最近~4KB, lastDataAt: timestamp }`,主进程内存态,不落盘
- 查询:`task:*status` IPC 或主进程定时器批量推导,renderer 只收结果
- 对照:ringBuffer ≈ `capture-pane -p`;lastDataAt 差值 ≈ `pane_content_hashes` 空闲检测;特征表 v2+ 再引入

### 坑位:shell 自动重启吞掉退出事件

`pty.ts` 现有逻辑:agent CLI 退出(Ctrl+C/正常结束)→ shell **就地重启**,不触发 PTY_EXIT。后果与对策:
- 「agent 干完了」和「agent 卡住等输入」在 v1 里不可区分,**统一落 review 列** —— 可接受:两者的下一步动作恰好都是「人来看一眼」
- PTY_EXIT 仅表示整个终端被关闭 → 卡片标「终端已关」,回到可手动 resume 态,不自动降列
- v2 若需细分,再上 per-agent 特征表(`AGENT_ACTIVE_INDICATORS` 模式)

## 4. worktree 规范(看板自建)

```
{repoRoot}/.vibe/worktrees/{slug}     # slug = 标题 slugify,冲突追加短 id
分支:task/{slug},从 base 分支切出(base 为空则自动探测 main/master)
```

- **忽略方式**:写入 `.git/info/exclude`(本地生效,不改仓库 .gitignore,零污染)
- 创建时机:**唯一建环境点**是人工「启动」,此后任何自动流转不再碰文件系统
- 清理策略(Done/删除时弹窗三选,默认第一项):
  1. 删 worktree,**保留分支**(agtx 同款,Future:reopen 从分支重建)
  2. 删 worktree + 删分支
  3. 全保留
- Windows 文件锁:先杀终端进程树再 `remove --force`(复用 `main/ai.ts destroy()` 已验证的 taskkill 时序)
- 复用现有 `GIT_WORKTREE_PATH`/`GIT_DELETE_WORKTREE` 通道做查询与删除,新增的只有「创建」

## 5. 启动与恢复命令(per-agent,小表)

```ts
// src/main/tasks.ts 内置,v1 三行起步
const LAUNCH: Record<string, { cmd: string; resume: string }> = {
  claude:  { cmd: 'claude',            resume: 'claude --continue' },
  codex:   { cmd: 'codex',             resume: 'codex resume --last' },
  gemini:  { cmd: 'gemini',            resume: 'gemini --resume' },
}
// prompt 注入:cmd + 空格 + quoted(description);description 为空则裸进交互界面
```

- 沿用 agtx `build_resume_command()` 结论:`--continue` 为主,gemini/codex 特例
- 未知 agent 允许手填命令(表只是默认值)

## 6. 持久化

- 文件:`app.getPath('userData')/vibe-tasks/{workspaceHash}.json`(workspaceHash = 路径哈希,同 agtx projects/{hash}.db 思路)
- 写入:防抖 + tmp 文件原子替换(先例:`ai-context-windows.json`)
- 加载:工作区切换时载入;文件内记录 `workspacePath`,不匹配视为孤儿提示而非静默丢弃
- **不持久化运行态**:lastDataAt/ringBuffer/徽标纯运行时推导,重启自然消失 —— 这是特性不是缺陷(agtx 的 PhaseStatus 同样不落库)

## 7. UI 集成

### 中栏全屏看板(centerView='board')
- 渲染模式照抄 mujica 先例:`display: centerView === 'board' ? 'flex' : 'none'` 的常驻容器,ESC 回终端(App.tsx ESC 分层最上层注册)
- 五列渲染 TaskCard;卡片徽标订阅主进程推送的终端活跃状态,**不新建状态源**
- 快捷键:`Ctrl+B` 开关(shortcuts.ts 注册时验证冲突);列内 j/k、列间 h/l 移游标(平铺数组 + 双游标,照抄 `tui/board.rs` 的 98 行设计:`tasks.filter(t => t.status === col)`)

### 卡片动作 → 现有机制复用
| 动作 | 复用链路 |
|------|---------|
| 打开卡片 | 切 activeSession 到 `terminalSessionId`(centerView='terminal'),该终端 cwd 本就是 worktree,GitTab 经 `GIT_SET_WORKSPACE` 跟随 |
| 启动 | 建 worktree → `pty:create`(cwd=worktreePath,name=`▶ {slug}`)→ `pty:write` 注入 LAUNCH.cmd + prompt |
| 继续(中断卡) | 同上,但注入 LAUNCH.resume |
| 查看 diff | GIT_DIFF,target=worktreePath |
| 发消息进卡 | `pty:write`(v1 直写;Ink TUI 时序问题出现后再引入 agtx 的 prompt_triggers 等待机制) |

## 8. 主进程新模块

```
src/main/tasks.ts    # 任务 CRUD、worktree 创建/清理、生命周期编排、LAUNCH/RESUME 表
IPC 前缀 task:*      # list/create/update/delete/start/resume/status(批量活跃态)/cleanup
src/main/pty.ts      # 仅加一处:onData 内更新 per-session ringBuffer + lastDataAt(不动现有流转)
```

- 不塞进 git.ts:任务编排有自己的状态机,git 只是被调库
- 状态推导放主进程(它持有 lastDataAt),renderer 收推送画徽标

## 9. 副作用矩阵(核心安全边界)

| 迁移 | 触发者 | 文件系统 | 进程 | JSON |
|------|--------|---------|------|------|
| →running(启动) | **人工** | 建 worktree | 开终端+注入命令 | 写 status |
| running↔review(自动漂移) | 自动 | 无 | 无 | 防抖写 status |
| →done | **人工** | 弹窗按选择清理 | 关终端 | 写 status |
| 删除卡片 | **人工** | 同上确认 | 关终端 | 删记录 |
| resume | **人工** | 校验 worktree 在(缺失报错不重建) | 重开终端+注入 resume | 清 interrupted |

原则:**自动流转只写字符串,人工动作才碰磁盘和进程(手动破坏)。**

## 10. 分期

### v1(本次范围)
- TaskCard 模型 + userData JSON 持久化 + task:* IPC + main/tasks.ts
- pty.ts 单点挂钩(ringBuffer + lastDataAt)
- centerView='board' 五列看板(planning 列预留),j/k/h/l 游标,Ctrl+B 开关
- 空闲阈值驱动的 running↔review 自动漂移;LAUNCH 三 agent 表
- 看板自建 worktree(.vibe/worktrees + info/exclude)+ 三选清理弹窗
- 重启冻结 + 手动 resume(resume 命令注入)

### v2+
- per-agent 特征表(`AGENT_ACTIVE_INDICATORS` 模式):区分「干完」vs「等输入」,细化 review 徽标
- prompt_triggers / auto_dismiss:复杂 Ink TUI 的可靠发令序列(踩到 codex/gemini picker 问题再做)
- 任务引用依赖(`![task]` 双语义,移植 agtx deps_satisfied 单规则原则)
- 收养已有终端会话为卡片
- 多工作区总览(dashboard 模式)

## 11. 遗留待定项

- [ ] 快捷键 Ctrl+B 是否与现有冲突需实测(shortcuts.ts 注册时验证)
- [ ] 空闲阈值初值:running 判定 30s / review 判定 15s,沿 agtx 手感,待调参
- [ ] slug 中文标题的处理(pinyin?直接 hash 后缀?)
- [ ] name=`▶ {slug}` 的终端命名前缀是否与 SessionPanel 图标状态机冲突(scheduled/worktree/running/warn/idle)
