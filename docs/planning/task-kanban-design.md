# Vibe IDE Session 看板(MVP)

> 状态:v3 定稿(替代 v2 任务看板方案)· 参考 [agtx](E:\ai\agtx)
>
> **定位收缩**:不再是任务管理系统,而是三件事 ——
> ① **监控墙**:所有活会话(term / aitab / dsh)自动投影成卡,按 idle / running / warning 自动排布
> ② **试验田**:plan 区唯一新增入口,只建 term 型会话,开创 worktree
> ③ **清理站**:唯一终点动作 = 删 worktree + 分支,且只有 term 型(worktree)卡需要走到这步,其他源不管

## 0. 相对 v2 砍掉了什么

| v2 概念 | 处置 |
|---------|------|
| TaskCard 一等实体 + JSON 持久化 | ✂ 卡 = 会话的运行时投影,不落盘 |
| Backlog→Planning→Running→Review→Done 工作流五列 | ✂ 四列:plan / running / idle / warning |
| 状态机流转 + 副作用矩阵 | ✂ 无「迁移」概念,卡按状态自动归列 |
| per-agent LAUNCH/RESUME 命令表 | ✂ 创建时可选填一条启动命令,存注册表 |
| 重启冻结/恢复流程 | ✂ 重启后活会话自然消失;仅 worktree 记录留存,plan 列可重开 |

## 1. 数据模型

```ts
// 运行时投影 —— 不持久化,会话死卡自灭
interface SessionCard {
  id: string                                  // 源会话 id
  source: 'term' | 'aitab' | 'dsh'
  name: string                                // 终端名 / AI 会话名 / dsh 会话名
  status: 'running' | 'idle' | 'warning'
  detail?: string                             // 一行摘要:cwd 尾段 / model / 待授权数
  worktreeId?: string                         // 仅 board 创建的 term 卡:关联注册表
}

// worktree 注册表 —— 唯一持久化的东西
interface WorktreeRecord {
  id: string                                  // = 创建时的 pty 会话 id
  title: string
  slug: string
  launchCommand?: string                      // 可选,重开时注入
  worktreePath: string                        // {repoRoot}/.vibe/worktrees/{slug}
  branchName: string                          // task/{slug}
  baseBranch: string
  createdAt: number
}
```

## 2. 看板布局与排布规则

```
┌─────────┬───────────┬──────────┬───────────┐
│  plan   │  running  │   idle   │  warning  │
│ (仅wt卡) │ (全源活卡) │ (全源活卡) │ (全源活卡) │
│ [+ 新建] │           │          │           │
└─────────┴───────────┴──────────┴───────────┘
```

- **plan 列**:worktree 注册表中当前「无活终端」的记录(未开过 / 已关闭 / 重启后离线)。这是唯一有 `+ 新建` 入口的列
- **其余三列**:所有活会话(term / aitab / dsh)按状态自动归列,状态变化即自动搬家,**零人工迁移**
- 卡片信息就一行:name + source 徽标 + detail,不做富内容

## 3. 状态信号(每源一张小表)

| 源 | running | idle | warning | 信号出处 |
|----|---------|------|---------|---------|
| term | 有输出且 lastDataAt < T | 无输出 ≥ T(T=30s,常量) | `restarts[]` 非空(shell 曾崩溃重启)/ 重启循环停摆 | pty.ts onData 钩子 + 既有 restarts 数组 |
| aitab | busy \|\| streaming | 其余 | pendingPermission \|\| 最近消息含 error | aiStore(AiSessionState)现有字段 |
| dsh | 服务 ready 且对应会话活跃 | 服务 ready 无活动 | 服务未 ready / 启动失败 | 主进程 dsh 状态(粗粒度,v1 不细分) |

采集方式:
- term/dsh:主进程 `board:snapshot` IPC,renderer 2s 轮询(沿 agtx 缓存 TTL 手感)
- aitab:BoardView 直接订阅本地 aiStore 合并进卡片流(zustand 就在 renderer,不必绕主进程)

## 4. 三个动作(全板仅此三个交互)

### 4.1 新建(plan 列 `+`,只产 term 型)
```
迷你向导:名称(必填→slug) + 启动命令(选填)
一次点击完成:
  1. simple-git: worktree add .vibe/worktrees/{slug} -b task/{slug}(base 自动探测 main/master)
  2. 写 .git/info/exclude(忽略 .vibe/,不动仓库 .gitignore)
  3. 注册表追加 WorktreeRecord({userData}/vibe-board/{workspaceHash}.json,防抖原子写)
  4. pty:create(cwd=worktreePath,name=▶ {slug},initCommand=启动命令||空)
  → 卡片立即以 term 身份进入 running/idle/warning 流转
```

### 4.2 打开(点击任意卡)
| 卡类型 | 行为 |
|--------|------|
| plan 列 worktree 卡 | pty:create 重开终端(cwd=worktreePath,注入 launchCommand)→ 转入状态列 |
| term 卡 | 切 activeSession 到该终端(centerView='terminal') |
| aitab 卡 | 切到该会话的右栏 AiTab |
| dsh 卡 | 打开对应 DshView |

### 4.3 完成(仅 worktree 卡,终点 = 删)
- 入口:worktree 卡上的「完成」按钮(plan 列与状态列都有,跟着卡走)
- 流程:**异步 Modal 确认**(禁用同步 confirm)→ 关终端(taskkill 进程树,复用 ai.ts destroy 时序)→ `git worktree remove --force` → 删分支 task/{slug} → 删注册表记录
- 其他源的卡没有完成按钮:会话关了卡自然消失,无需任何处理

## 5. 实现落点

### 主进程
```
src/main/board.ts   # 新增:worktree 创建/清理、WorktreeRecord CRUD、board:snapshot 聚合(term map 扫描 + dsh 状态)
src/main/pty.ts     # 仅加:onData 内更新 lastDataAt(一行级改动,不动现有流转)
IPC                 # board:snapshot / board:create / board:open / board:finish(复用 PTY_*、GIT_* 底层通道)
```

### Renderer
```
components/BoardView.tsx   # 新增:四列渲染 + 三动作
App.tsx                    # centerView === 'board' 常驻容器(display 切换,mujica 先例);
                           # ESC 最上层分支:board → terminal(遵循 ESC 分层规则);
                           # Ctrl+B 注册进 shortcuts.ts(实现时验证冲突)
aiStore                    # 只读订阅,不改
```

UI 规则照章执行:颜色全用 `var(--ide-*)` / `bg-ide-*`;确认走异步 Modal;不加注释;写完脑内过 hover/空态(worktree 空、会话全关)/中英文。

## 6. 边界情况

- **重启后**:活卡全灭(符合预期);plan 列凭注册表列出遗留 worktree,可重开或完成清理
- **孤儿检测**:加载注册表时逐条验 `worktreePath` 存在性,目录已删的标灰并给「清除记录」(顺手 `worktree prune`)
- **同名 slug 冲突**:追加短 id 后缀
- **非 git 工作区**:plan 列 `+` 置灰 + tooltip 说明(worktree 依赖 git)
- **多会话同 cwd**:卡按会话 id 唯一,不去重合并

## 7. 明确不做(v3 范围外)

任务描述/prompt 模板、插件阶段门控、依赖引用图、收养已有会话、per-agent 特征表细分 warning、多工作区总览、AI 编排器 —— 全部留给看板证明有用之后。
