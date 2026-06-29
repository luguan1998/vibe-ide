# UI BEM 语义类清单

供 CSS snippets(`{exeDir}/snippets/*.css`)覆盖 UI 外观。重启生效,设置菜单 → Snippets 切换启用。

## snippets 用法

- 覆盖**主题色变量**(`:root --ide-xxx`)必须加 `!important`(ThemeProvider 用 `setProperty` 内联,优先级 1000)。
- **BEM 语义类**选具体元素,通常无需 `!important`;与 Tailwind 原子类同优先级,snippets 后加载即可覆盖,不生效时再加 `!important`。
- 颜色值写 **`R G B` 空格分隔**(如 `255 179 0`),不要 `#hex` 或 `rgb()`,否则 Tailwind 透明度修饰符(`/50`)失效。

```css
/* 例:用户消息气泡改色 */
.ai-tab__user-bubble {
  background-color: 22 22 18 !important;
  border-color: 255 179 0 !important;
}
/* 例:pipe 运行中的列表项左边框 */
.session-item--pipe-running {
  border-left: 3px solid rgb(var(--ide-accent));
}
```

## AiTab — AI 对话区(`ai-tab__*`)

| 区域 | 类名 |
|------|------|
| 根/头部 | `ai-tab` · `ai-tab__header` · `ai-tab__header-left` · `ai-tab__header-actions` · `ai-tab__header-btn` · `ai-tab__header-btn--active` · `ai-tab__session-name` · `ai-tab__history-dropdown` · `ai-tab__history-item` · `ai-tab__history-item-name` · `ai-tab__history-item-time` |
| 消息流 | `ai-tab__messages` · `ai-tab__message` · `ai-tab__message--user` · `ai-tab__message--assistant` · `ai-tab__message-wrap` · `ai-tab__message-content` · `ai-tab__message-meta` · `ai-tab__status-pill` · `ai-tab__agent-group` · `ai-tab__agent-label` |
| 用户气泡 | `ai-tab__user-bubble` · `ai-tab__user-popover` · `ai-tab__user-popover-item` |
| Markdown | `ai-tab__markdown` · `ai-tab__markdown--streaming` · `ai-tab__markdown-raw` |
| 思考块 | `ai-tab__thinking` · `ai-tab__thinking-toggle` · `ai-tab__thinking-content` · `ai-tab__thinking-text` |
| 工具调用 | `ai-tab__tool-call` · `ai-tab__tool-toggle` · `ai-tab__tool-detail-preview` · `ai-tab__tool-status` · `ai-tab__tool-detail-panel` · `ai-tab__tools-summary` · `ai-tab__tools-summary-toggle` · `ai-tab__tools-summary-list` |
| 输入区 | `ai-tab__input-area` · `ai-tab__input-pill` · `ai-tab__input-zone` · `ai-tab__textarea` · `ai-tab__input-toolbar` · `ai-tab__toolbar-left` · `ai-tab__toolbar-right` |
| 按钮 | `ai-tab__send-btn` · `ai-tab__stop-btn` |
| 错误/空/忙 | `ai-tab__error` · `ai-tab__error-cmd` · `ai-tab__error-copy-btn` · `ai-tab__empty` · `ai-tab__empty-icon` · `ai-tab__empty-prompts` · `ai-tab__example-btn` · `ai-tab__busy` · `ai-tab__busy-sparkle` · `ai-tab__busy-quip` |
| context/model/mode | `ai-tab__context-bar` · `ai-tab__context-bar-frame` · `ai-tab__context-bar-cell` · `ai-tab__context-bar-cell--filled` · `ai-tab__context-bar-pct` · `ai-tab__model` · `ai-tab__model-btn` · `ai-tab__model-dropdown` · `ai-tab__model-option` · `ai-tab__model-option--selected` · `ai-tab__mode` · `ai-tab__mode-btn` · `ai-tab__mode-dropdown` · `ai-tab__mode-option` · `ai-tab__mode-option--selected` |
| 卡片(问/权限/计划) | `ai-tab__question-card` · `ai-tab__question-title` · `ai-tab__question-header` · `ai-tab__question-option` · `ai-tab__question-option--selected` · `ai-tab__question-submit-btn` · `ai-tab__question-deny-btn` · `ai-tab__permission-card` · `ai-tab__permission-title` · `ai-tab__permission-cmd` · `ai-tab__permission-approve-btn` · `ai-tab__permission-deny-btn` · `ai-tab__plan-card` · `ai-tab__plan-content` · `ai-tab__plan-feedback` · `ai-tab__plan-execute-btn` |
| Todo | `ai-tab__todo-panel` · `ai-tab__todo-toggle` · `ai-tab__todo-item` · `ai-tab__todo-text` · `ai-tab__todo-text--completed` |
| Slash 菜单 | `ai-tab__slash-menu` · `ai-tab__slash-menu-item` · `ai-tab__slash-menu-item--selected` · `ai-tab__slash-menu-cmd` |

## SessionPanel — 左侧会话列表

- `session-panel__` header / stats / stat / config / config-btn / config-menu / theme-list / snippets-list / new-btn / list-wrapper / list / flat-list
- `session-item__` icon / name / actions / cwd
- `session-item--active`
- `session-group__` header / path
- **pipe 特效**:`session-item__pipe` · `session-item__pipe-spinner` · `session-item__pipe-progress` · `session-item__pipe-cancel` · `session-item--pipe-running`

## FileTab — 文件树

- `file-tab__` header / tree / section / section-header / section-title
- `file-tree-item__` toggle / name
- `file-tree-item--` folder / file / active

## GitTab — Git 面板

- `git-tab__` header / branch-name / section / section-header / file-item / commit-area / commit-input / commit-btn

## RightPanel — 右栏 tab

- `right-panel__` tab-bar / tab / content
- `right-panel__tab--active`

## TerminalView — 终端

- `term-view__` header / canvas / ocr-overlay / search / search-input / filepicker / filepicker-item

## 尚未覆盖(按需续补)

NavBar 顶栏 · CustomCommands 命令胶囊+Modal · SearchPanel · AuxTab · DiffViewer · SettingsPanel · DocTree
