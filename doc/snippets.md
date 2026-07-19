# CSS Snippets 自定义皮肤

把 `.css` 文件丢进 `snippets/` 目录，设置里勾选即生效——不改代码，不重新打包。

---

## 快速上手

1. **新建文件**：在 `snippets/` 下新建 `my-theme.css`
2. **复制配方**：从下方区域速查表复制需要的代码段
3. **启用**：设置 → Snippets → 勾选 `my-theme.css`（即时热更新，无需重启）

> 新文件首次需重启 IDE 才会出现在列表里。

---

## 能改什么 — 按区域速查

### 1. 主题色（改一个值，全 UI 跟着变）

```css
:root {
  --ide-accent: 199 50 43 !important;       /* 强调色：按钮、链接、选中 */
  --ide-bg: 20 20 20 !important;            /* 主背景 */
  --ide-sidebar: 30 30 32 !important;       /* 侧栏 */
  --ide-text: 220 220 220 !important;       /* 主文字 */
  --ide-text-muted: 140 140 140 !important; /* 次要文字 */
}
```

全部变量：`--ide-bg` `--ide-sidebar` `--ide-panel` `--ide-border` `--ide-text` `--ide-text-muted` `--ide-accent` `--ide-accent-hover` `--ide-success` `--ide-danger` `--ide-warning` `--ide-hover` `--ide-active`

### 2. 终端背景（图片 + 透明度）

```css
:root {
  --terminal-bg-image: url('assets/bg.jpg');
  --terminal-bg-overlay: rgba(10, 10, 10, 0.65);  /* 0=全透 1=全黑 */
}
.term-view__canvas { --term-bg: 10 10 10; }         /* 无图时纯色 fallback */

/* 让 xterm 透明以透出背景图 */
.xterm .xterm-viewport,
.xterm .xterm-screen,
.xterm .xterm-screen canvas { background: transparent !important; }
```

换图改 `url()`，调压暗改 `0.65`。改完后**新开 session** 才生效。

### 3. Session 列表 — 状态行

| 效果 | 选择器 |
|------|--------|
| 选中行左边框色 | `.session-item--active` |
| AI 运行中左边框 | `.session-item--pipe-running` |
| 选中行背景 | `.session-item--active { background: ... }` |
| 非选中运行中 | `.session-item:not(.session-item--active).border-ide-accent\/60` |

### 4. Session 按钮图标 — emoji 替换

```css
.session-panel__settings-btn svg { display: none !important; }
.session-panel__settings-btn::after { content: '⚙'; }
.session-panel__new-btn svg { display: none !important; }
.session-panel__new-btn::after { content: '✨'; }
```

隐藏 `svg`，用 `::after { content }` 盖 emoji/文字。

### 5. AI Tab — Markdown 渲染

| 目标 | 选择器 |
|------|--------|
| 代码块 | `.ai-tab__markdown pre` `.ai-tab__markdown code` |
| 行内代码 | `.ai-tab__markdown code:not(pre code)` |
| 工具调用边框 | `.ai-tab__tool-call` |
| 思考块 | `.ai-tab__thinking` |
| 用户气泡 | `.ai-tab__user-bubble` |

### 6. Markdown 预览（DiffViewer 打开 `.md`）

所有元素都在 `.md-preview` 下：`h1`~`h6` `a` `strong` `em` `code` `pre` `blockquote` `table` `th` `td` `hr` `li::marker`。

```css
.md-preview h1 { color: rgb(var(--ide-accent)) !important; }
.md-preview strong { color: rgb(var(--ide-warning)) !important; }
.md-preview blockquote { border-left-color: rgb(var(--ide-accent)) !important; }
```

### 7. 右侧面板 — Tab 按钮

```css
.right-panel__tab--active { border-bottom: 2px solid rgb(var(--ide-accent)) !important; }
.right-panel__tab { color: rgb(var(--ide-text-muted)) !important; }
```

### 8. File Tab — 文件树

```css
/* 不用选元素，直接覆盖变量 */
:root { --ft-fname-size: 13px !important; --ft-icon-size: 16px !important; }

/* 选中行 */
.file-tree-item--active { background: rgb(var(--ide-accent) / 0.1) !important; }
/* 文件夹名 */
.file-tree-item--folder .file-tree-item__name { color: rgb(var(--ide-accent)) !important; }
```

### 9. Git Tab — 文件列表 + 按钮

```css
/* 文件名字号 */
:root { --git-fname-size: 12px !important; --git-fdir-size: 10px !important; }

/* 三区左边框：staged / unstaged / untracked */
.git-tab__section:nth-child(1) { border-left: 2px solid rgb(var(--ide-success)) !important; }
.git-tab__section:nth-child(2) { border-left: 2px solid rgb(var(--ide-danger)) !important; }
.git-tab__section:nth-child(3) { border-left: 2px solid rgb(var(--ide-warning)) !important; }

/* 分支名 / 按钮 / 输入框 */
.git-tab__branch-name { color: rgb(var(--ide-accent)) !important; }
.git-tab__commit-btn { background: rgb(var(--ide-accent)) !important; }
.git-tab__commit-input:focus { border-color: rgb(var(--ide-accent)) !important; }
```

### 10. 全局 — 字体 / 圆角 / 滚动条

```css
:root {
  --ide-font-family: 'Your Font' !important;
  --ide-term-font: 'Your Mono Font' !important;
}

* { border-radius: 0 !important; }                          /* 全局去圆角 */
.monaco-editor * { border-radius: revert !important; }      /* 恢复 Monaco 内部圆角 */

::-webkit-scrollbar-thumb { background: rgb(var(--ide-accent) / 0.5) !important; }
```

---

## 三个必须遵守的规则

### ① 覆盖 `--ide-*` 变量必须加 `!important`

主题用 `style.setProperty` 写成内联样式（优先级 1000），普通规则压不过。

```css
/* ✅ */  :root { --ide-accent: 199 50 43 !important; }
/* ❌ */  :root { --ide-accent: 199 50 43; }
```

### ② 颜色值写成 `R G B` 空格分隔

```css
/* ✅ */  --ide-accent: 199 50 43 !important;
/* ❌ */  --ide-accent: #c7232b !important;
/* ❌ */  --ide-accent: rgb(199, 50, 43) !important;
```

因为 Tailwind 透明度修饰符（`bg-ide-accent/50`）拼接成 `rgb(var(--ide-accent) / 0.5)`，只有空格分隔的三通道数才合法。

### ③ 全局去圆角时恢复 Monaco 内部

```css
* { border-radius: 0 !important; }
.monaco-editor * { border-radius: revert !important; }
```

---

## 完整 BEM 类名参考

DOM 骨架和全部 BEM 类名见 [`ui-bem-classes.md`](ui-bem-classes.md)。

## 内置 Snippet 索引

| 文件 | 风格 |
|------|------|
| `nyan-cat.css` | 彩虹猫深空主题 |
| `starry-night.css` | 梵高星夜 |
| `dont-starve.css` | 饥荒海难 |
| `macos.css` | macOS Sonoma 浅色 |
| `niji-feed.css` | 彩虹 Feed 卡片 |
| `win98-classic.css` | Windows 98 灰蓝 |
| `retroma-chromatic.css` | CRT 复古全色域 |
| `nes-8bit.css` | NES 8-bit 像素风 — Press Start 2P 字体 + 3D 浮雕边框 + CRT 扫描线 |
| `bloodborne.css` | 血源诅咒 |
| `z-large-font.css` | 大字无障碍 |
| `z-opencode-term-bg.css` | 终端/AI Tab 背景图 |
| `z-pet-clawd.css` | 宠物爪爪替换 |
