# UI BEM 语义类 — 完整参考

供 CSS snippets 覆盖 UI 外观。本文档列出所有 BEM 类名，快速指南见 [`snippets.md`](snippets.md)。

## 规则

- 覆盖 `--ide-xxx` 变量必须加 `!important`（主题用 `setProperty` 内联，优先级 1000）
- BEM 语义类通常也加 `!important`，防 `globals.css` 已有规则覆盖
- 颜色值写 `R G B` 空格分隔（如 `255 179 0`），不用 `#hex` 或 `rgb()`

---

## DOM 骨架

```
.term-view                          # 终端
  .term-view__header / .term-view__canvas / .term-view__search / .term-view__filepicker

.ai-tab                             # AI 对话
  .ai-tab__header / .ai-tab__messages / .ai-tab__input-area / .ai-tab__pet-wrapper
    .ai-tab__message--user / .ai-tab__message--assistant
      .ai-tab__user-bubble / .ai-tab__markdown / .ai-tab__thinking / .ai-tab__tool-call
    .ai-tab__input-pill / .ai-tab__textarea / .ai-tab__send-btn / .ai-tab__stop-btn

.session-panel                      # 左侧会话面板
  .session-panel__header / .session-panel__list-wrapper
    .session-panel__settings-btn / .session-panel__new-btn
    .status-badge  # agent 三态药丸（独立 BEM 块，用在 header）
    .session-item / .session-item--active / .session-item--pipe-running
      .session-item__icon / .session-item__name / .session-item__actions

.right-panel                        # 右侧面板
  .right-panel__tab-bar / .right-panel__tab--active / .right-panel__content

.git-tab                            # Git 面板
  .git-tab__header / .git-tab__branch-name
  .git-tab__section / .git-tab__section-header / .git-tab__file-item
  .git-tab__commit-area / .git-tab__commit-input / .git-tab__commit-btn

.file-tab                           # 文件树
  .file-tab__header / .file-tab__tree / .file-tab__section
    .file-tree-item--folder / .file-tree-item--file / .file-tree-item--active
      .file-tree-item__toggle / .file-tree-item__name

.center-overlay                     # 覆盖面板（Markdown/Image/Diff 预览，ESC 关闭）

.draft-plan                         # 草稿计划（Game tab）
  .draft-plan__header / .draft-plan__list / .draft-plan__footer
```

---

## SessionPanel — 左侧会话列表

### 面板级

| 类名 | 说明 |
|------|------|
| `session-panel__header` | 顶部统计栏 |
| `status-badge` | agent 状态药丸容器（running/idle/warn 三态合并胶囊，独立 BEM 块） |
| `status-badge__segment` | 单态段（修饰 `--running`/`--idle`/`--warn` + `.is-active` 高亮） |
| `status-badge__divider` | 段间竖线分隔 |
| `status-badge__icon` / `status-badge__count` | 段内图标 / 数字 |
| `session-panel__settings-btn` | 设置齿轮按钮（含 SVG 图标） |
| `session-panel__settings-menu` | 设置下拉菜单容器 |
| `session-panel__theme-list` | 主题切换列表 |
| `session-panel__snippets-list` | Snippets 切换列表 |
| `session-panel__new-btn` | 新建 session 按钮（含 SVG 图标） |
| `session-panel__list-wrapper` | 列表外层容器（圆角裁剪） |
| `session-panel__list` | 列表滚动区 |
| `session-panel__flat-list` | 无分组平铺列表 |

### 会话行

| 类名 | 说明 |
|------|------|
| `session-item` | 单行 session |
| `session-item--active` | 当前活跃 session（左边框高亮） |
| `session-item--pipe-running` | AI 运行中 session（左边框呼吸） |
| `session-item__icon` | 折叠/状态图标（含 Lucide SVG） |
| `session-item__name` | session 名称文本 |
| `session-item__actions` | 右侧操作按钮（删除/重命名等） |
| `session-item__cwd` | 工作目录路径文本 |
| `session-item__pipe` | pipe 进度胶囊容器 |
| `session-item__pipe-spinner` | pipe 旋转动画 |
| `session-item__pipe-progress` | pipe 进度数字 |
| `session-item__pipe-cancel` | pipe 取消按钮 |

### 分组头

| 类名 | 说明 |
|------|------|
| `session-group__header` | 分组标题栏 |
| `session-group__path` | 分组路径文本 |

---

## AiTab — AI 对话区

### 头部

`ai-tab` `ai-tab__header` `ai-tab__header-left` `ai-tab__header-actions` `ai-tab__header-btn` `ai-tab__header-btn--active` `ai-tab__session-name` `ai-tab__history-dropdown` `ai-tab__history-item` `ai-tab__history-item-name` `ai-tab__history-item-meta`

### 消息流

`ai-tab__messages` `ai-tab__message--user` `ai-tab__message--assistant` `ai-tab__message-wrap` `ai-tab__message-content` `ai-tab__message-meta` `ai-tab__user-bubble` `ai-tab__user-popover` `ai-tab__user-popover-item` `ai-tab__agent-group`

### Markdown 渲染（`ai-tab__markdown` 容器内）

`ai-tab__markdown` `ai-tab__markdown--streaming` `ai-tab__markdown-raw` — 内容为标准 Markdown 元素（`pre` `code` `h1`~`h6` `a` `strong` `em` `blockquote` `table` `ul` `ol` `li`），无需额外 BEM 类。

### 思考 / 工具调用

`ai-tab__thinking` `ai-tab__thinking-toggle` `ai-tab__thinking-content` `ai-tab__thinking-text` `ai-tab__tool-call` `ai-tab__tool-detail-preview` `ai-tab__tools-summary` `ai-tab__tools-summary-toggle` `ai-tab__tools-summary-list`

### 输入区

`ai-tab__input-area` `ai-tab__input-pill` `ai-tab__input-zone` `ai-tab__textarea` `ai-tab__input-toolbar` `ai-tab__toolbar-left` `ai-tab__toolbar-right` `ai-tab__send-btn` `ai-tab__stop-btn` `ai-tab__last-file-btn`

### 选择器 / 菜单

`ai-tab__context-bar` `ai-tab__context-bar-frame` `ai-tab__model` `ai-tab__model-dropdown` `ai-tab__mode` `ai-tab__mode-btn` `ai-tab__mode-dropdown` `ai-tab__slash-menu` `ai-tab__slash-menu-cmd` `ai-tab__slash-menu-item`

### 卡片 / 状态

`ai-tab__question-card` `ai-tab__question-title` `ai-tab__question-header` `ai-tab__question-deny-btn` `ai-tab__permission-card` `ai-tab__permission-title` `ai-tab__permission-cmd` `ai-tab__permission-approve-btn` `ai-tab__permission-deny-btn` `ai-tab__plan-content` `ai-tab__plan-feedback` `ai-tab__plan-collapse-btn`

### Todo / 错误 / 空态 / 宠物

`ai-tab__todo-panel` `ai-tab__todo-toggle` `ai-tab__todo-item` `ai-tab__todo-text--completed` `ai-tab__error` `ai-tab__error-cmd` `ai-tab__error-copy-btn` `ai-tab__empty` `ai-tab__empty-icon` `ai-tab__empty-prompts` `ai-tab__example-btn` `ai-tab__busy` `ai-tab__busy-sparkle` `ai-tab__busy-quip` `ai-tab__pet-wrapper` `ai-tab__pet` `ai-tab__pet-hitarea` `ai-tab__pet-close` `ai-tab__pet-sprite`

---

## FileTab — 文件树

### 面板级

| 类名 | 说明 |
|------|------|
| `file-tab__header` | 顶部标题栏 |
| `file-tab__tree` | 文件树滚动区 |
| `file-tab__section` | 额外区域（最近打开 / arch） |
| `file-tab__section-header` | 区域折叠标题 |
| `file-tab__section-title` | 区域标题文本 |

### 文件行

| 类名 | 说明 |
|------|------|
| `file-tree-item--folder` | 文件夹行 |
| `file-tree-item--file` | 文件行 |
| `file-tree-item--active` | 当前高亮行 |
| `file-tree-item__toggle` | 展开/折叠箭头 SVG |
| `file-tree-item__name` | 文件名文本 |

**CSS 变量钩子**：`--ft-fname-size`（文件名，默认 `13px`）、`--ft-icon-size`（图标大小，默认 `14px`），在 `:root` 覆盖即可，无需选择器。

---

## CenterOverlay — ESC 关闭的覆盖面板

MarkdownPreview / ImagePreview / DiffViewer 三个面板统一使用 `.center-overlay`。

| 类名 | 说明 |
|------|------|
| `center-overlay` | 覆盖在终端中栏上的预览面板根容器 |

---

## GitTab — Git 面板

| 类名 | 说明 |
|------|------|
| `git-tab__header` | 顶部栏（含分支名） |
| `git-tab__branch-name` | 分支名 |
| `git-tab__section` | 暂存/未暂存/未跟踪区块 |
| `git-tab__section-header` | 区块折叠标题 |
| `git-tab__file-item` | 文件条目行 |
| `git-tab__folder-item` | 文件夹条目行 |
| `git-tab__commit-area` | 底部提交区 |
| `git-tab__commit-input` | 提交信息输入框 |
| `git-tab__commit-btn` | 提交按钮 |
| `git-tab__stash-btn` | Stash / Pop Stash 按钮 |
| `git-tab__amend-btn` | Amend 按钮 |
| `git-tab__push-group` | Push/Pull 按钮组 |
| `git-tab-container` | container query 容器 |

三区块按 DOM 顺序：`:nth-child(1)` staged、`:nth-child(2)` unstaged、`:nth-child(3)` untracked。

**CSS 变量钩子**：`--git-fname-size`（文件名，默认 `12px`）、`--git-fdir-size`（目录名，默认 `0.9em`）。

---

## RightPanel — 右侧面板

| 类名 | 说明 |
|------|------|
| `right-panel__tab-bar` | Tab 切换栏 |
| `right-panel__tab` | 单个 tab 按钮（含 SVG 图标） |
| `right-panel__tab--active` | 当前活跃 tab |
| `right-panel__content` | Tab 内容区 |

---

## TerminalView — 终端

| 类名 | 说明 |
|------|------|
| `term-view__header` | 顶部标题栏 |
| `term-view__canvas` | xterm.js 挂载容器 + 背景 |
| `term-view__ocr-overlay` | OCR 浮层 |
| `term-view__search` | 终端内搜索栏 |
| `term-view__search-input` | 搜索输入框 |
| `term-view__filepicker` | 文件路径选择弹窗 |
| `term-view__filepicker-item` | 文件选择候选项 |

**`term-view__canvas` 支持的 CSS 变量**：
- `--term-bg`：终端纯色背景（优先级高于 `--ide-bg`），RGB 空格分隔
- `--terminal-bg-image`：背景图，默认 `none`
- `--terminal-bg-overlay`：压暗层，默认 `transparent`

---

## DraftPlan — 草稿计划（Game tab）

`draft-plan__header` `draft-plan__title` `draft-plan__list` `draft-plan__empty` `draft-plan__item` `draft-plan__item--drag-over` `draft-plan__item--editing` `draft-plan__item-accent` `draft-plan__item-handle` `draft-plan__item-index` `draft-plan__item-text` `draft-plan__item-btn` `draft-plan__add-input` `draft-plan__footer` `draft-plan__send-next-btn`

---

## 其他全局工具类

| 类名 | 说明 |
|------|------|
| `.md-preview` | Markdown 预览容器（DiffViewer 中渲染 .md） |
| `.md-code-block` | 代码块容器 |
| `.md-code-lang` | 代码块语言标签 |
| `.md-frontmatter` `.md-fm-key` `.md-fm-val` | Frontmatter 卡片 |
| `.md-search-match` `.md-search-match-current` | 搜索高亮 |
| `.titlebar-drag` | 标题栏拖拽区 |
| `.acrylic-titlebar` `.acrylic-titlebar-clean` | 亚克力标题栏 |
| `.focus-frame` | 焦点指示器 |
| `.diff-revert-overlay` `.diff-revert-btn` | Diff 回退浮钮 |
| `.diff-brush-mode` `.diff-brush-code` | Brush 模式光标 |
| `.git-fname` `.git-fdir` | Git 文件名 / 目录名 |
| `.ft-fname` `.ft-icon` | 文件树文件名 / 图标 |
| `.git-stats` | Git 统计徽章（窄面板隐藏） |
| `.animate-fade-in` `.animate-text-wave` `.animate-aura-glow` 等 | 动画类 |

---

## 常用配方

```css
/* 用户气泡自定义 */
.ai-tab__user-bubble {
  background-color: var(--ide-accent) !important;
  color: var(--ide-bg) !important;
}

/* 活跃 session 左边框 */
.session-item--active {
  border-left: 3px solid rgb(var(--ide-accent)) !important;
}

/* 终端纯黑背景 */
.term-view__canvas { --term-bg: 10 10 10; }

/* Git 分支名放大 */
.git-tab__branch-name { font-size: 14px !important; }

/* 文件树选中行 */
.file-tree-item--active { background-color: 38 55 92 !important; }

/* Session 按钮图标 emoji 替换 */
.session-panel__settings-btn svg { display: none !important; }
.session-panel__settings-btn::after { content: '⚙'; }

/* 计划卡片圆角 */
.ai-tab__plan-content { border-radius: 12px !important; }

/* AI 运行中的非活跃 session — GIF 动画 */
.session-item:not(.session-item--active).border-ide-accent\/60 {
  background-image: url('my-cat.gif') !important;
  background-size: auto 24px !important;
  background-position: right 6px center !important;
  background-repeat: no-repeat !important;
}
```

---

## 无 BEM 类的区域

以下组件无语义类，需用 Tailwind 选择器覆盖：

- **NavBar** — 顶部导航栏
- **SearchPanel** — 文件内容搜索
- **AuxTab** — 辅助终端（有 `aux-tab__scroll` / `aux-tab__bar` / `aux-tab__add-btn` / `aux-tab__launch-btn`）
- **DiffViewer** — Monaco Diff 编辑器主体（有 `diff-revert-*` / `diff-brush-*` 工具类）
- **SettingsPanel** — 设置面板
- **DocTree** — CLAUDE.md 文档树
- **CustomCommands** — 自定义命令胶囊
