# CSS Snippets 自定义皮肤

> 把任意 `.css` 文件丢进 `snippets/` 目录，就能改 Vibe IDE 的配色、字体、面板样式——不动代码、不重新打包。
>
> 适合：换一套主题色、改某个面板的边框/字号、做复古/国风皮肤。

---

## 怎么用

1. **放文件**：把你的 `.css` 丢到 `snippets/` 目录
   - 开发态：项目根目录的 `snippets/`
   - 安装态：exe 同目录的 `snippets/`（绿色版，免安装）
2. **开启**：设置菜单 → Snippets，勾选对应文件
3. **生效**：切换开关**即时热更新**，不用重启；新增文件需重启一次后被识别

> `snippets.json` 是自动生成的启用状态记录，别手动改。

**新文件默认禁用**——丢进去不会自动生效，要去设置里手动开。避免放进去了意外改变界面。

---

## 能改什么

Snippets 能覆盖的东西分七类。前三类是**变量**（改一个值，全 UI 跟着变），后四类是**类名/元素**（精准改某个面板）。

### 1. 主题色变量（最常用）

改这些变量，所有用到该颜色的地方（包括 Tailwind 的 `bg-ide-*` / `text-ide-*` 工具类）都会跟着变。

| 变量 | 作用 |
|------|------|
| `--ide-bg` | 主背景（中栏、终端 canvas、body） |
| `--ide-sidebar` | 侧栏背景（标题栏亚克力、Markdown 代码块） |
| `--ide-panel` | 面板背景 |
| `--ide-border` | 边框、分隔线 |
| `--ide-text` | 主文字色 |
| `--ide-text-muted` | 次要文字色 |
| `--ide-accent` | 强调色（按钮、链接、选中、Markdown 标题） |
| `--ide-accent-hover` | 强调色 hover |
| `--ide-success` / `--ide-danger` / `--ide-warning` | 语义色（成功/危险/警告） |
| `--ide-hover` | hover 背景色 |
| `--ide-active` | 激活/选中背景 |
| `--scrollbar-thumb` / `--scrollbar-thumb-hover` | 滚动条滑块 / hover |
| `--selection-bg` / `--selection-opacity` | 文本选区背景色 / 透明度 |
| `--focus-outline` | 键盘焦点轮廓色 |
| `--monaco-margin-bg` | Monaco 编辑器行号槽背景 |

### 2. 字体变量

| 变量 | 作用 |
|------|------|
| `--ide-font-family` | UI 全局字体（界面、代码块、Markdown 代码） |
| `--ide-session-font` | 左侧会话列表字体 |
| `--ide-term-font` | 终端字体 |

### 3. 尺寸钩子（globals.css 专门留给 snippet 的）

这几个变量在 `globals.css` 里有默认值，snippet 覆盖即可调字号/图标大小，不用选具体元素：

| 变量 | 默认 | 作用 |
|------|------|------|
| `--git-fname-size` | `11px` | Git 面板文件名字号 |
| `--git-fdir-size` | `10px` | Git 面板目录名字号 |
| `--ft-fname-size` | `12px` | 文件树文件名字号 |
| `--ft-icon-size` | `14px` | 文件树图标尺寸（宽高） |

### 4. BEM 语义类（精准改某个面板）

这些类名直接选具体元素。按区域分组：

**标题栏**
- `.titlebar-drag`（标题栏拖拽区，常配合 `[class*="h-9"]` 选到高度类）

**会话面板（左侧）**
- `.session-panel__list-wrapper` 列表容器
- `.session-panel__stat` 统计徽章
- `.session-panel__settings-btn` / `.session-panel__new-btn` 齿轮 / 新建按钮
- `.session-panel__settings-menu` 设置菜单
- `.session-item` 会话项（`:hover` / `--active` / `__name`）
- `.session-group` / `__header` / `__path` 会话分组（按 cwd 分组时）

**终端（中栏）**
- `.term-view__canvas` 终端画布
- `.term-view__header` 终端头部
- `.term-view__search` 终端搜索框

**文件树（右侧 Tab）**
- `.file-tab__header` / `__section` / `__section-header`
- `.file-tree-item`（`--active` / `--folder` / `--file` / `__name`）

**Git 面板（右侧 Tab）**
- `.git-tab__header` / `__branch-name`
- `.git-tab__section` 区块（`:nth-child(1/2/3)` 分别对应 Staged / Unstaged / Untracked，可上不同色）
- `.git-tab__section-header` / `__file-item` / `__commit-area` / `__commit-input` / `__commit-btn`

**右侧面板容器**
- `.right-panel__content` / `__tab-bar` / `__tab`（`--active`）

**模态框 / 输入**
- `.fixed.inset-0.z-50 > div[class*="bg-ide-bg"]` 确认弹窗
- `.fixed[class*="bg-ide-bg"][class*="border"][class*="shadow"]` 上下文菜单
- `input, select, textarea` 全局输入框
- `button` 全局按钮

### 5. Markdown 预览

`.md-preview` 是 Markdown 渲染容器，内部元素都可单独上色（标题层级、链接、粗斜体、代码、引用、表格等）。常见钩子：

- `.md-preview` h1~h6 / `a` / `strong` / `em` / `del` / `li::marker`
- `.md-preview code` / `blockquote` / `thead` / `th` / `td` / `hr`
- `.md-code-block` / `.md-code-lang` 代码块容器与语言标签
- `.md-search-match` / `.md-search-match-current` 搜索高亮
- `.md-frontmatter` / `.md-fm-key` / `.md-fm-val` frontmatter 卡片

### 6. 滚动条 / 选区 / 焦点 / 全局

- `::-webkit-scrollbar` / `-track` / `-thumb` / `-thumb:hover` / `-corner` / `-button`
- `::selection` 文本选区
- `*:focus-visible` 键盘焦点轮廓
- `* { border-radius: 0 }` 全局去圆角（复古皮肤常用）
- `html, body, #root { font-family / font-size }` 全局字体/字号

### 7. Monaco 编辑器

`globals.css` 已用 `!important` 重写了一批 Monaco 默认样式（行号槽背景、diff 分隔线、禁用 hover tooltip 等）。snippet 可以继续覆盖，但同样要带 `!important` 才能压过。常见入口：

- `.monaco-editor .margin` 行号槽
- `.monaco-diff-editor .gutter` diff 槽
- `.monaco-editor *` 编辑器内部所有元素（全局去圆角后，通常用 `border-radius: revert` 恢复编辑器内部圆角）

> Monaco 的**语法高亮色**不在 CSS 变量里，由主题的 `monacoRules` 定义，snippet 改不了。要改高亮色得换主题。

---

## 必须遵守的规则（避坑）

### ① 覆盖主题色变量必须加 `!important`

主题色由 `ThemeProvider` 用 `style.setProperty` 写成**内联样式**（CSS 优先级 1000）。snippet 是普通 `<style>` 规则，不带 `!important` 压不过。

```css
/* ✅ 对 */
:root { --ide-accent: 199 50 43 !important; }

/* ❌ 不生效 */
:root { --ide-accent: 199 50 43; }
```

BEM 语义类（`.session-item--active` 等）选的是具体元素，理论上不强制 `!important`，但实战建议都带上——能稳压 `globals.css` 里已有的 `!important` 规则。

### ② 颜色值必须写成 `R G B` 空格分隔

变量定义值用空格分隔的三通道数，**不要**用 `#hex` 或 `rgb()`。否则 Tailwind 的透明度修饰符（`bg-ide-accent/50` 这类）拼接 `rgb(var(--x) / 0.5)` 时会失效。

```css
/* ✅ 对 */
--ide-accent: 199 50 43 !important;

/* ❌ 错 */
--ide-accent: #c7232b !important;
--ide-accent: rgb(199, 50, 43) !important;
```

使用时可以带透明度，用现代 CSS 空格语法：

```css
background: rgb(var(--ide-accent) / 0.3);     /* 引用变量 + 透明度 */
background: rgb(199 50 43 / 0.3);             /* 直接写色值 + 透明度 */
```

### ③ 全局去圆角后恢复 Monaco 内部

`* { border-radius: 0 !important }` 会把 Monaco 编辑器内部控件也变成直角。通常跟一行恢复：

```css
* { border-radius: 0 !important; }
.monaco-editor * { border-radius: revert !important; }
```

---

## 最小示例

一个把强调色换成朱红、全局去圆角的 snippet：

```css
/* my-theme.css */
:root {
  --ide-accent: 199 50 43 !important;
  --ide-accent-hover: 230 80 70 !important;
  --selection-bg: 199 50 43 !important;
}

* { border-radius: 0 !important; }
.monaco-editor * { border-radius: revert !important; }

/* 给会话激活项加朱红左边条 */
.session-item--active {
  border-left: 3px solid rgb(var(--ide-accent)) !important;
}
```

丢进 `snippets/my-theme.css` → 设置里开启即可。

---

## 内置 Snippet 索引

`snippets/` 自带几个示例皮肤，可直接启用或当模板参考：

| 文件 | 风格 |
|------|------|
| `nyan-cat.css` | 彩虹猫深空主题 — 深蓝星空底 + 粉色糖霜 Pop-Tart 猫 + 彩虹拖尾。活跃 session 右侧跑 Nyan Cat GIF，终端 canvas 嵌 CSS 手绘星群（`linear-gradient` 方块技法，非 `radial-gradient` 圆点），标题栏粉色发光线，emoji 替换统计图标（🌈⭐🎀✨） |
| `retro-chinese.css` | 80s 国风暗色，大闹天宫四色（朱红/翠绿/赤金/玄青），适配 `retro-chinese` 主题 |
| `monkey-king-bicolor.css` | 国风浅色双色（石绿侧栏 + 琥珀黄中栏 + 朱红选中），适配 `monkey-king` 主题 |
| `win98-classic.css` | Windows 98 复古灰蓝，凸起/凹陷 3D 边框 |
| `retroma.css` / `retroma-cyan.css` / `retroma-chromatic.css` | retro 调色变体（基础 / 青色 / 多彩） |

> 各文件的配色意图和设计说明写在文件头部注释里，打开即可看。

### nyan-cat 亮点

nyan-cat 不是普通换色皮肤，它用了几项不太常见的 CSS 技法：

- **星群用 `linear-gradient` 画方块**，不是 `radial-gradient` 圆点。每颗星是一个独立的 `background-image` 层，`background-size` / `background-position` 各控大小和位置，双层（`::before` 亮星 + `::after` 暗星）叠加出景深
- **活跃 session 右侧跑 Nyan Cat GIF** —— `:has(.animate-text-wave)::before` 锁定 AI 正在输出的 session，`background-image: url('assets/nyan.gif')`
- **非活跃运行中 session 右侧静态 Nyan Cat** —— `.session-item:not(.session-item--active).border-ide-accent\/60` 选到 pipe 运行中但不在当前焦点的 session
- **emoji 替换 SVG 图标** —— `::after { content: '🎀' }` 盖掉设置/新建按钮的 SVG，统计栏同理（🌈⭐）
- **标题栏粉色发光线** —— `border-bottom: 1px solid rgb(242 140 245 / 0.25)` 加半透明粉边，`box-shadow: 0 0 18px` 做柔光

### opencode-term

纯黑终端背景 snippet，只用一行 CSS 变量桥接：

```css
.term-view__canvas { --term-bg: 10 10 10; }
```

`--term-bg` 是 TerminalView 读取的 CSS 变量，有值时直接覆盖 xterm.js 的 `theme.background`，传给 WebGL 渲染器。比 `:root { --ide-bg: ... }` 精准——只改终端 canvas，不影响侧栏/面板背景。


## opencode 透明背景图片设置

~\.config\opencode\themes 新增一个如 my.json 然后主题切到my

```json
{
  "$schema": "https://opencode.ai/theme.json",
  "theme": {
    "primary": "#64b5f6",
    "secondary": "#ce93d8",
    "accent": "#ffd54f",
    "error": "#ef5350",
    "warning": "#ffd54f",
    "success": "#81c784",
    "info": "#64b5f6",
    "text": "#e0e0e0",
    "textMuted": "#6a7a9a",
    "background": "none",
    "backgroundPanel": "none",
    "backgroundElement": "none",
    "border": "#2a3a5c",
    "borderActive": "#64b5f6",
    "borderSubtle": "#1e2a45"
  }
}
```
