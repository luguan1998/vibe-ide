# AgentHub — 多 Agent 编排面板（设计草稿）

> 把 AI Agent 从「聊天窗口」变成「任务执行器」。
> 不是让你跟 Agent 聊天，是让你给 Agent 派活——然后去干别的事。

---

## 用户痛点

终端里打 `claude` 用 TUI：
- 只能跑一个。同时想跑 Claude + Codex？没门
- 直接改你的文件。改崩了靠 git 救
- 关终端 = 失忆。昨天的任务干了什么？不记得
- 每次从头解释。没有技能/预设

## AgentHub 解决什么

**并行派活 + 隔离沙箱 + 永久记录 + 技能复用。**

### 1. 并行任务板

```
┌─ Queue ────┬─ Running ───────┬─ Completed ───────┐
│ 修复登录   │ 重构 API 路由   │ 添加单元测试      │
│ claude     │ codex   进度67% │ claude  3m12s     │
│ 等待中     │ [取消]          │ 改了4个文件 [diff] │
└────────────┴─────────────────┴───────────────────┘
```

- 点 [+ New Task] → 选 agent + 写 prompt + 附文件
- 任务自动排队，完成一个跑下一个
- 每个任务独立沙箱目录（`.vibe/tasks/{id}/`），改的是副本

### 2. Diff 预览再合并

Agent 跑完后不直接改你代码，而是：
- 先看改了哪些文件，行级 diff
- 点 [Apply] → 合到工作区
- 点 [Discard] → 删沙箱，项目干干净净
- 跟 GitTab 联动：apply 后的文件出现在 staged 区域，统一 commit

### 3. 技能复用

右键已完成任务 → "Save as Skill"：
- 存到 `.vibe/skills/{name}.md`
- 下次点技能 → 选文件 → 自动填充 prompt → 跑
- 团队可共享：`skills` 目录可以进 git

### 4. Agent 检测栏

面板顶部显示 PATH 上的可用 Agent：
```
● claude  v2.1  ● codex  v1.0  ○ opencode  (未安装)
```

哪个能跑一目了然，新建任务时选人。

---

## 跟 TUI 对比

| | TUI | AgentHub |
|---|---|---|
| 并行 | 1 个 | N 个，队列调度 |
| 文件隔离 | 直接写项目 | 沙箱 → diff 预览 → apply |
| 历史 | 关终端丢 | 持久化，可回溯 |
| 复用 | 手打 prompt | 技能预设，右键存 |
| 代码注入 | 手动 cat 文件 | 选文件自动附上 |
| Agent 切换 | 关一个再开另一个 | 一块面板管所有 |

---

## 边界场景

- **CLI 未安装** → 面板提示"请先安装 claude/codex"，新建按钮灰掉
- **网络断连** → agent 失败 → 任务标红，点 [重试]
- **沙箱残留** → IDE 启动时扫描 `.vibe/tasks/`，孤儿目录超 24h 自动清理
- **大项目附件** → 只复制用户指定的文件，不拷整个项目
- **多 workspace** → 每个 workspace 有自己的 `.vibe/tasks/` 和 `.vibe/skills/`

---

## 文件改动

```
新建:
  src/main/agent.ts              — Agent 管理器（CLI 检测 / 任务队列 / 沙箱 / spawn）
  src/renderer/src/components/AgentHub.tsx      — 主面板
  src/renderer/src/components/AgentTaskCard.tsx  — 任务卡片
  src/renderer/src/components/AgentTaskDetail.tsx — 详情 / diff / apply

修改:
  src/shared/types.ts            — 加 AGENT_* channels + 类型
  src/main/index.ts              — +1 行注册
  src/preload/index.ts           — 加 agent 桥接
  src/renderer/src/App.tsx       — 加 window.api.agent 类型声明
  src/renderer/src/components/RightPanel.tsx — 加 'agents' tab
```

---

## 不做

- 不做 Multica/Swag 那样的全栈 taskboard SaaS——这是 IDE 内嵌工具
- 不做 agent 间的消息路由/编排——先做好单个任务管理
- 不做云 runtime——只用本地 CLI
