# UI BEM 语义类清单

供 CSS snippets（`{exeDir}/snippets/*.css`）覆盖 UI 外观。重启生效，设置菜单 → Snippets 切换启用。

## snippets 用法

- 覆盖**主题色变量**（`:root --ide-xxx`）必须加 `!important`（ThemeProvider 用 `setProperty` 内联，优先级 1000）。
- **BEM 语义类**选具体元素，通常无需 `!important`；与 Tailwind 原子类同优先级，snippets 后加载即可覆盖，不生效时再加 `!important`。
- 颜色值写 **`R G B` 空格分隔**（如 `255 179 0`），不要 `#hex` 或 `rgb()`，否则 Tailwind 透明度修饰符（`/50`）失效。

```css
/* 例：用户消息气泡改色 */
.ai-tab__user-bubble {
  background-color: 22 22 18 !important;
  border-color: 255 179 0 !important;
}
/* 例：pipe 运行中的列表项左边框 */
.session-item--pipe-running {
  border-left: 3px solid rgb(var(--ide-accent));
}
```

## DOM 骨架总览

```
.term-view                          # 终端容器
  .term-view__header                # 标题栏
  .term-view__canvas                # xterm 挂载点 + 背景
    .term-view__ocr-overlay         # OCR 浮层
    .term-view__search              # 搜索栏
      .term-view__search-input
    .term-view__filepicker          # 文件选择器
      .term-view__filepicker-item

.ai-tab                             # AI 对话区
  .ai-tab__header                   # 顶部栏
    .ai-tab__header-left            # 左侧（session 名）
    .ai-tab__header-actions         # 右侧按钮组
    .ai-tab__history-dropdown       # 历史下拉
  .ai-tab__messages                 # 消息列表
    .ai-tab__message--user          # 用户消息
      .ai-tab__user-bubble          # 用户气泡
    .ai-tab__message--assistant     # 助手消息
      .ai-tab__thinking             # 思考块
      .ai-tab__tool-call            # 工具调用
      .ai-tab__markdown             # Markdown 渲染
      .ai-tab__plan-card            # 计划卡片
      .ai-tab__question-card        # 追问卡片
      .ai-tab__permission-card      # 权限卡片
  .ai-tab__input-area               # 输入区
    .ai-tab__input-zone
      .ai-tab__textarea
    .ai-tab__input-toolbar

.session-panel                       # 左侧会话面板
  .session-panel__header             # 顶部统计栏
  .session-panel__list-wrapper       # 列表容器
    .session-group__header           # 分组标题
    .session-item                    # 单个会话
      .session-item__icon            # 状态图标
      .session-item__name            # 会话名
      .session-item__actions         # 操作按钮
      .session-item__pipe            # pipe 进度

.right-panel                         # 右侧面板
  .right-panel__tab-bar              # tab 栏
    .right-panel__tab--active        # 当前 tab
  .right-panel__content              # tab 内容区

.git-tab                             # Git 面板
  .git-tab__header                   # 顶部（分支名）
  .git-tab__section                  # 暂存/未暂存/未跟踪区
    .git-tab__section-header         # 区块标题
    .git-tab__file-item              # 文件条目
  .git-tab__commit-area              # 提交区
    .git-tab__commit-input
    .git-tab__commit-btn

.file-tab                            # 文件浏览器
  .file-tab__header                  # 顶部栏
  .file-tab__section                 # 区域（最近打开/arch）
    .file-tab__section-header        # 区域标题
    .file-tree-item--folder          # 文件夹行
    .file-tree-item--file            # 文件行
      .file-tree-item__name          # 文件名

.draft-plan                          # 草稿计划（Game tab）
  .draft-plan__header                # 标题栏
  .draft-plan__list                  # 步骤列表
    .draft-plan__item--editing       # 编辑中的步骤
  .draft-plan__footer                # 底部操作栏
```

## AiTab — AI 对话区（`ai-tab__*`）

### 头部

| 类名 | 说明 |
|------|------|
| `ai-tab` | 根容器 |
| `ai-tab__header` | 顶部栏 |
| `ai-tab__header-left` | 头部左侧区域 |
| `ai-tab__header-actions` | 头部右侧按钮组 |
| `ai-tab__header-btn` | 头部操作按钮 |
| `ai-tab__header-btn--active` | 头部按钮激活态 |
| `ai-tab__session-name` | 会话名称文本 |
| `ai-tab__history-dropdown` | 历史会话下拉面板 |
| `ai-tab__history-item` | 历史会话项 |
| `ai-tab__history-item-name` | 历史项名称 |
| `ai-tab__history-item-time` | 历史项时间 |

### 消息流

| 类名 | 说明 |
|------|------|
| `ai-tab__messages` | 消息列表容器 |
| `ai-tab__message` | 单条消息 |
| `ai-tab__message--user` | 用户消息 |
| `ai-tab__message--assistant` | 助手消息 |
| `ai-tab__message-wrap` | 消息内容包裹 |
| `ai-tab__message-content` | 消息正文容器 |
| `ai-tab__message-meta` | 消息元信息（token 数等） |
| `ai-tab__status-pill` | 状态胶囊（streaming/complete） |
| `ai-tab__agent-group` | agent 分组标签 |
| `ai-tab__agent-label` | agent 名称标签 |
| `ai-tab__user-bubble` | 用户消息气泡 |
| `ai-tab__user-popover` | 用户消息操作弹窗（编辑/复制） |
| `ai-tab__user-popover-item` | 弹窗操作项 |

### Markdown 渲染

| 类名 | 说明 |
|------|------|
| `ai-tab__markdown` | Markdown 渲染容器 |
| `ai-tab__markdown--streaming` | 流式输出中（光标闪烁） |
| `ai-tab__markdown-raw` | Markdown 原文模式 |

### 思考块

| 类名 | 说明 |
|------|------|
| `ai-tab__thinking` | 思考块容器 |
| `ai-tab__thinking-toggle` | 展开/折叠按钮 |
| `ai-tab__thinking-content` | 思考内容区 |
| `ai-tab__thinking-text` | 思考文本 |

### 工具调用

| 类名 | 说明 |
|------|------|
| `ai-tab__tool-call` | 工具调用条目 |
| `ai-tab__tool-toggle` | 展开/折叠按钮 |
| `ai-tab__tool-detail-preview` | 工具参数折叠预览 |
| `ai-tab__tool-status` | 工具执行状态（running/done/error） |
| `ai-tab__tool-detail-panel` | 工具返回结果面板 |
| `ai-tab__tools-summary` | 多工具调用汇总 |
| `ai-tab__tools-summary-toggle` | 汇总展开按钮 |
| `ai-tab__tools-summary-list` | 汇总工具列表 |

### 输入区

| 类名 | 说明 |
|------|------|
| `ai-tab__input-area` | 输入区容器 |
| `ai-tab__input-pill` | 输入区胶囊外壳（圆角+边框） |
| `ai-tab__input-zone` | 实际输入区域 |
| `ai-tab__textarea` | 文本输入框 |
| `ai-tab__input-toolbar` | 输入工具栏 |
| `ai-tab__toolbar-left` | 工具栏左侧（model/mode 等） |
| `ai-tab__toolbar-right` | 工具栏右侧（发送/停止按钮） |
| `ai-tab__send-btn` | 发送按钮 |
| `ai-tab__stop-btn` | 停止生成按钮 |

### context / model / mode

| 类名 | 说明 |
|------|------|
| `ai-tab__context-bar` | 上下文用量条 |
| `ai-tab__context-bar-frame` | 用量条外框 |
| `ai-tab__context-bar-cell` | 用量条分格 |
| `ai-tab__context-bar-cell--filled` | 已用分格 |
| `ai-tab__context-bar-pct` | 百分比文本 |
| `ai-tab__model` | 模型选择区 |
| `ai-tab__model-btn` | 模型选择按钮 |
| `ai-tab__model-dropdown` | 模型下拉菜单 |
| `ai-tab__model-option` | 模型选项 |
| `ai-tab__model-option--selected` | 当前选中模型 |
| `ai-tab__mode` | 模式选择区 |
| `ai-tab__mode-btn` | 模式选择按钮 |
| `ai-tab__mode-dropdown` | 模式下拉菜单 |
| `ai-tab__mode-option` | 模式选项 |
| `ai-tab__mode-option--selected` | 当前选中模式 |

### 卡片（追问 / 权限 / 计划）

| 类名 | 说明 |
|------|------|
| `ai-tab__question-card` | 追问卡片容器 |
| `ai-tab__question-title` | 追问标题 |
| `ai-tab__question-header` | 追问头部 |
| `ai-tab__question-option` | 追问选项（多选时） |
| `ai-tab__question-option--selected` | 已选选项 |
| `ai-tab__question-submit-btn` | 追问提交按钮 |
| `ai-tab__question-deny-btn` | 追问拒绝按钮 |
| `ai-tab__permission-card` | 权限确认卡片 |
| `ai-tab__permission-title` | 权限提示标题 |
| `ai-tab__permission-cmd` | 待确认的命令文本 |
| `ai-tab__permission-approve-btn` | 批准按钮 |
| `ai-tab__permission-deny-btn` | 拒绝按钮 |
| `ai-tab__plan-card` | 计划展示卡片 |
| `ai-tab__plan-content` | 计划内容 |
| `ai-tab__plan-feedback` | 计划反馈区 |
| `ai-tab__plan-execute-btn` | 执行计划按钮 |

### Slash 菜单

| 类名 | 说明 |
|------|------|
| `ai-tab__slash-menu` | 斜杠命令菜单 |
| `ai-tab__slash-menu-item` | 菜单项 |
| `ai-tab__slash-menu-item--selected` | 选中菜单项 |
| `ai-tab__slash-menu-cmd` | 命令名 |

### Todo

| 类名 | 说明 |
|------|------|
| `ai-tab__todo-panel` | Todo 面板 |
| `ai-tab__todo-toggle` | 展开/折叠按钮 |
| `ai-tab__todo-item` | 单条 todo |
| `ai-tab__todo-text` | todo 文本 |
| `ai-tab__todo-text--completed` | 已完成 todo（删除线） |

### 错误 / 空态 / 忙碌

| 类名 | 说明 |
|------|------|
| `ai-tab__error` | 错误提示容器 |
| `ai-tab__error-cmd` | 错误重试命令 |
| `ai-tab__error-copy-btn` | 复制错误按钮 |
| `ai-tab__empty` | 空态容器 |
| `ai-tab__empty-icon` | 空态图标 |
| `ai-tab__empty-prompts` | 空态快捷提示 |
| `ai-tab__example-btn` | 示例提问按钮 |
| `ai-tab__busy` | 加载中容器 |
| `ai-tab__busy-sparkle` | 加载动画 |
| `ai-tab__busy-quip` | 加载俏皮话 |

## SessionPanel — 左侧会话列表

### session-panel — 面板级

| 类名 | 说明 |
|------|------|
| `session-panel__header` | 面板顶部统计栏 |
| `session-panel__stats` | 统计数字容器 |
| `session-panel__stat` | 单个统计项（session 数 / 总消息数） |
| `session-panel__config` | 设置按钮区 |
| `session-panel__config-btn` | 设置齿轮按钮 |
| `session-panel__config-menu` | 设置下拉菜单 |
| `session-panel__theme-list` | 主题切换列表 |
| `session-panel__snippets-list` | Snippets 切换列表 |
| `session-panel__new-btn` | 新建 session 按钮 |
| `session-panel__list-wrapper` | 列表外层容器（圆角裁剪） |
| `session-panel__list` | 列表滚动区 |
| `session-panel__flat-list` | 无分组平铺列表 |

### session-item — 会话行

| 类名 | 说明 |
|------|------|
| `session-item` | 单行 session（Tailwind 主导，BEM 仅补充） |
| `session-item--active` | 当前活跃 session |
| `session-item--pipe-running` | pipe 运行中 session（左边框高亮） |
| `session-item__icon` | 折叠 / 状态图标 |
| `session-item__name` | session 名称文本 |
| `session-item__actions` | 右侧操作按钮（删除/重命名/折叠） |
| `session-item__cwd` | 工作目录路径文本 |
| `session-item__pipe` | pipe 进度胶囊 |
| `session-item__pipe-spinner` | pipe 旋转动画 |
| `session-item__pipe-progress` | pipe 进度数字 |
| `session-item__pipe-cancel` | pipe 取消按钮 |

### session-group — 分组头

| 类名 | 说明 |
|------|------|
| `session-group__header` | 分组标题栏 |
| `session-group__path` | 分组路径文本（可点击折叠） |

## FileTab — 文件树

### file-tab — 面板级

| 类名 | 说明 |
|------|------|
| `file-tab__header` | 顶部标题栏 |
| `file-tab__tree` | 文件树滚动区 |
| `file-tab__section` | 额外区域（最近打开 / arch） |
| `file-tab__section-header` | 区域折叠标题 |
| `file-tab__section-title` | 区域标题文本 |

### file-tree-item — 文件行

| 类名 | 说明 |
|------|------|
| `file-tree-item--folder` | 文件夹行 |
| `file-tree-item--file` | 文件行 |
| `file-tree-item--active` | 当前高亮行（左边框 + 背景） |
| `file-tree-item__toggle` | 文件夹展开/折叠箭头 |
| `file-tree-item__name` | 文件名文本 |

## GitTab — Git 面板

| 类名 | 说明 |
|------|------|
| `git-tab__header` | 顶部栏 |
| `git-tab__branch-name` | 分支名（粉色高亮） |
| `git-tab__section` | 暂存 / 未暂存 / 未跟踪区块 |
| `git-tab__section-header` | 区块折叠标题（staged / unstaged / untracked） |
| `git-tab__file-item` | 文件条目行 |
| `git-tab__commit-area` | 底部提交区 |
| `git-tab__commit-input` | 提交信息输入框 |
| `git-tab__commit-btn` | 提交按钮 |

三个 `git-tab__section` 按 DOM 顺序有不同左边框颜色：
- `:nth-child(1)` — 绿色（staged）
- `:nth-child(2)` — 粉色（unstaged）
- `:nth-child(3)` — 黄色（untracked）

## RightPanel — 右栏 tab

| 类名 | 说明 |
|------|------|
| `right-panel__tab-bar` | tab 切换栏 |
| `right-panel__tab` | 单个 tab 按钮 |
| `right-panel__tab--active` | 当前活跃 tab |
| `right-panel__content` | tab 内容区 |

## TerminalView — 终端

| 类名 | 说明 |
|------|------|
| `term-view` | 终端根容器（flex-col, h-full） |
| `term-view__header` | 顶部标题栏 |
| `term-view__canvas` | xterm.js 挂载容器 + 背景色 |
| `term-view__ocr-overlay` | OCR 文字识别浮层 |
| `term-view__search` | 终端内搜索栏 |
| `term-view__search-input` | 搜索输入框 |
| `term-view__filepicker` | 文件路径选择弹窗（Ctrl+Click） |
| `term-view__filepicker-item` | 文件选择候选项 |

`term-view__canvas` 支持 CSS 变量 `--term-bg` 覆盖终端背景色（桥接到 xterm.js WebGL canvas）：
```css
.term-view__canvas {
  --term-bg: 10 10 10;          /* RGB 空格分隔，xterm.js 背景 */
  --terminal-bg-image: url(...); /* 终端背景图（需 allowTransparency） */
}
```

## GameDraftPlan — 草稿计划（Game tab）

| 类名 | 说明 |
|------|------|
| `draft-plan__header` | 顶部标题栏 |
| `draft-plan__title` | 标题文本「草稿计划」 |
| `draft-plan__list` | 步骤列表 |
| `draft-plan__empty` | 空列表占位 |
| `draft-plan__item` | 步骤行 |
| `draft-plan__item--drag-over` | 拖拽悬停高亮 |
| `draft-plan__item--editing` | 编辑中状态 |
| `draft-plan__item-accent` | 左侧彩色细线 |
| `draft-plan__item-handle` | 拖拽手柄 |
| `draft-plan__item-index` | 步骤序号 |
| `draft-plan__item-sigil` | 步骤图标/标记 |
| `draft-plan__item-text` | 步骤文本 |
| `draft-plan__item-edit` | 步骤编辑按钮 |
| `draft-plan__item-actions` | 步骤操作按钮组 |
| `draft-plan__item-btn` | 步骤操作按钮 |
| `draft-plan__add` | 新增步骤输入区 |
| `draft-plan__add-input` | 新增输入框 |
| `draft-plan__add-btn` | 新增确认按钮 |
| `draft-plan__copy-all-btn` | 一键复制全部 |
| `draft-plan__footer` | 底部操作栏 |
| `draft-plan__convert-btn` | 转为计划按钮 |
| `draft-plan__send-next-btn` | 发送下一步按钮 |

## 常用 snippet 配方

```css
/* 用户气泡 — 自定义背景 */
.ai-tab__user-bubble {
  background-color: var(--ide-accent) !important;
  color: var(--ide-bg) !important;
}

/* 活跃 session 左边框颜色 */
.session-item--active {
  border-left-color: var(--ide-accent) !important;
}

/* pipe 运行中的 session 左边框 */
.session-item--pipe-running {
  border-left: 3px solid rgb(var(--ide-accent)) !important;
}

/* 终端背景纯黑 */
.term-view__canvas {
  --term-bg: 10 10 10;
}

/* Git 分支名放大 */
.git-tab__branch-name {
  font-size: 14px !important;
}

/* 文件树选中行背景 */
.file-tree-item--active {
  background-color: 38 55 92 !important;
}

/* 工具调用区折叠时缩小 */
.ai-tab__tool-call {
  font-size: 11px !important;
}

/* 计划卡片圆角加大 */
.ai-tab__plan-card {
  border-radius: 12px !important;
}

/* 非活跃 session 的 Nyan Cat 替换 */
.session-item:not(.session-item--active).border-ide-accent\/60 {
  background-image: url('my-cat.gif') !important;
  background-size: auto 24px !important;
  background-position: right 6px center !important;
  background-repeat: no-repeat !important;
}
```

## 尚未覆盖的 UI 区域

以下组件完全使用 Tailwind 原子类，无 BEM 语义类，snippets 覆盖需用 Tailwind 选择器或属性选择器：

- **NavBar** — 顶部导航栏
- **SearchPanel** — 文件内容搜索
- **AuxTab** — 辅助终端 + 命令面板
- **DiffViewer** — Monaco Diff 编辑器
- **SettingsPanel** — 设置面板
- **DocTree** — CLAUDE.md 文档树
- **CustomCommands** — 自定义命令胶囊
- **AnnotationPanel** — 批注面板
- **OutlinePanel** — 大纲面板
