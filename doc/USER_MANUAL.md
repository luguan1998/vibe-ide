# Vibe IDE 使用手册

> 为 AI Agent 与人协作而生的桌面终端 IDE。
>
> 左侧管多个 AI 会话，中间看终端 / 编辑文件，右侧操作 Git、辅助命令、文件树和搜索。三栏一体，不用来回切窗口。

---

## 快速上手

解压 zip → 运行 `Vibe IDE.exe`（绿色免安装）。推荐双击 `register-context-menu.bat` 注册右键菜单，之后任意文件/目录上点右键 → "Open with Vibe IDE"。

---

## 1. 这台 IDE 不一样的地方

### Session 列表（左侧）

- **Agent 跑没跑，一眼就知道**：终端连续输出 300ms → 显示 `>>` 跑马灯 + 边框脉冲；停 2 秒没动静 → 变回空闲。切到别的 Session 干活也不怕错过。
- **YOLO 模式（自动批准）**：用于暂没有auto的老cc和opencode.
- **悬停看历史**：鼠标在 Session 上停 600ms，弹出最近 30 条命令，每条带复制按钮。不用切过去就能瞄一眼刚才干了什么。
- **自定义命令胶囊**：设置里加自己的快捷命令（名字 + 命令内容），列表顶部会多一排胶囊，点一下就执行，右键编辑/删除。
- **自定义 Emoji 图标**：设置 → Emoji Text，一行一个，会话图标按 ID hash 分配。
- **OSC 标题自动同步**：Agent 改终端标题时会话名跟着更新（盲文 spinner 和进程名会被过滤）。**但只要你手动改过一次名，自动改名就再也不打扰你。**
- **拖拽排序 /  最近打开的文件**：右键空白可从最近 10 个目录直接开新终端；Clone 出来的新会话紧挨原会话插入。

### 终端（中间）

- **路径自动识别**：终端输出的文件路径（Windows 绝对 / Unix 绝对 / 相对 / 引号路径）都成可点链接，支持 `:行号` `:行:列`。路径找不到时递归搜工作目录——唯一匹配自动打开，多个匹配静默忽略，不弹报错。
- **选中就跳**：在终端选中一段文本松开鼠标，若正好是文件路径，自动跳过去，不用精确点链接。
- **切出去也不丢**：切 Session 或看 Diff 时终端只 CSS 隐藏、不卸载，切回来输出都在、连接没断。
- **图片 OCR 识别**（v0.6.1+）：拖入图片或 `Ctrl+V` 粘贴，自动 OCR 识别文字并输入终端，截图直接粘贴即可。
- **重复命令不记两遍**、**聚焦才闪光标**、**`Ctrl+H` 弹命令历史**（全键盘操作）。
- **alt f 搜索终端内容**
- ** alt ⬆️⬇️ cc跳转到上一次输入**

### Git 面板（右侧 Tab 1）

通用功能（三区分组 / 点文件看 diff / 分支切换 / stash）从略。

- **大仓库自动折叠**：文件数超过 500 的区域自动折叠，打开 `node_modules` 炸了的仓库 UI 不会卡死。
- **冲突标记自动扫**：diff 里自动找 `<<<<<<<`，帮你定位合并冲突。
- **Worktree 支持**：`worktree-` 前缀的分支点一下，整个右侧面板切到 worktree 目录；右键 → Merge Changes 把 worktree 改动合回当前分支；点带 ← 箭头的条目回主分支。
- **不会串数据**：异步加载完会核对路径还是不是当前 Session 的，A 会话不会显示 B 会话的数据。
- **2 秒冷静期**：文件变更通知合并，保存不会触发十几次刷新，且保证最后一次变更不丢。
- **右键删分支**（`git branch -D`）、**错误提示 5 秒自动消失**。

### 文件树 / 搜索 / 编辑器（右侧 Tab 3、4 + 中间）

通用功能在鼠标右键（展开折叠 / 新建 / 重命名 / 删除 / 复制剪切 / 正则 / 大小写 / glob 过滤 / 保存 / 字体缩放）从略。

- **编码自动检测**: 支持文件夹范围的灵活搜索, 点击文件夹右侧的🔍即可
- **编码自动检测**：打开文件自动检测 BOM 和编码（jschardet），结果显示在标题栏，右键可换编码重开或保存——GBK、Shift-JIS、EUC-KR、Big5 等 30+ 种。
- **95 种语言语法高亮**：除常见 TS/JS/Python/Rust/Go 外，覆盖 `.mjs/.cjs/.mts/.cts`、GraphQL、Dart、Lua、R、Scala、Clojure、F#、Julia、Elixir、Perl、Solidity、Protobuf、Handlebars/Pug/Twig/Razor/MDX、SystemVerilog 等。
- **行号越界自动保护**：从终端点 `file.ts:99999` 跳到行数不够的文件，自动跳到最后一行，不报错。
- **文件对比**（v0.6.2+）：文件树右键 → "Compare with Current"，对比文件放 Diff 编辑器左侧，右侧是当前文件。
- **查找替换**（v0.4.2+）：替换框输入文本 → Replace All → 确认弹窗，确认前能看到要改多少文件、多少处；右侧 x 掉的文件不会被替换。
- **Ripgrep 优先**：系统装了 `rg` 就用 ripgrep（JSON 解析，15 秒超时），没装 Node.js 兜底。

### AUX 面板
推荐agent执行 /init 后在使用

### 隐藏面板
右键右侧的plane可以看到

---

## 2. 全键盘操作——导航与 ESC 退回

三栏之间穿梭、关浮窗、回终端，全程不用碰鼠标。

### 导航组合键

| 组合键 | 作用 |
|--------|------|
| `Ctrl+↑` / `Ctrl+↓` | 切上 / 下一个 Session，并聚焦新终端 |
| `Ctrl+←` / `Ctrl+→` | 右侧标签页左 / 右移，切过去自动聚焦（Search 聚焦输入框，其他聚焦容器） |
| `Alt+↑` / `Alt+↓` | 终端里跳上一条 / 下一条命令的 prompt 行，浏览长输出快速定位 |
| `Alt+F` | 终端内搜索 |
| `Alt+←` / `Alt+→` | 导航后退 / 前进 |
| `Alt+K` | 打开 Code Graph 代码图谱搜索 |

记法：**Ctrl 管栏间切换**（上下切 Session、左右切右侧 tab），**Alt 管栏内动作**（上下跳命令、F 搜索、左右导航、K 图谱）。

### ESC：万能退回键

ESC 是"关掉一切浮窗、退回终端"的总退回键，按优先级分层命中——**上层命中即停，不再下传**：

> 导航浮窗 → 命令历史 → 代码图谱 → 代码搜索 → 探索结果 → 焦点交回终端 → 关 Diff 视图 → 关 Markdown / 图片预览

也就是说：开着浮窗就先关浮窗；浮窗都关了就把焦点交回终端；正在看 Diff 或预览，ESC 先把它关掉。**迷路了盲按 ESC，总能一步步退回终端。**

> Diff 视图的 ESC 用 capture 阶段拦截（否则 Monaco 会抢清选区）；终端内弹出的 Modal / Overlay 也都用 capture + `stopImmediatePropagation` 拦按键，防止 xterm.js 冒泡阶段把键吞掉。

---

## 3. Code Graph 代码图谱

代码符号索引工具，快速搜索项目中的函数 / 类 / 接口 / 组件等。`Alt+K` 打开，250ms 防抖自动搜，选中 Enter 跳转；顶部 Fn/Me/Cl/If/Co/Va/Ct/Ty 按钮筛选符号类型。

- **首次需初始化**：点搜索框右侧 "Init" 建索引（大项目可能几分钟），之后增量更新。
- **排除文件夹**：漏斗图标排除不想索引的目录，自动写入 `.gitignore`。
- **MCP 配置**：齿轮图标配置 MCP（Model Context Protocol），让 Claude Code、Cursor 等 AI Agent 也能用代码图谱搜索。
- **内存占用**：开启约占 170MB 主进程内存，不需要可在设置里关掉。

---

## 4. 自定义 CSS Snippets

不想等版本更新，自己改外观——Vibe IDE 内置 CSS 片段系统，往目录里丢 `.css` 文件、菜单里勾一下就生效。建议让ai学习下已有的css即可以自定义ui样式,css末尾写入强制覆盖已有样式.

### 目录在哪

| 模式 | 路径 |
|------|------|
| 打包后（exe 运行） | `Vibe IDE.exe` 同目录的 `snippets/` |
| 开发模式（`npm run dev`） | 项目根目录的 `snippets/` |

目录不存在会自动创建。里面再放 `snippets.json`（启用状态，**自动生成不用手写**）和你的 `*.css`。

### 怎么开关

1. 把写好的 `my-style.css` 丢进 `snippets/` 目录。
2. 点左侧面板标题栏的齿轮 ⚙️ → 设置菜单里 hover **CSS Snippets** → 子菜单列出所有 `.css` 文件。
3. 点文件名切换启用 / 禁用，**即时生效**，不用重启。
4. 新文件**默认禁用**，必须点一下开启才会加载。空列表时菜单会提示 "Place .css files in the snippets/ folder."。

> 编辑已有 `.css` 后想看效果：在 Snippets 子菜单里把它关掉再开一次，会重新读取文件内容。

### 写法三条铁律

1. **覆盖主题色变量必须加 `!important`** — ThemeProvider 用 `setProperty` 写内联样式（优先级 1000），普通 `:root` 规则压不住。
2. **颜色值写 `R G B` 空格分隔**（如 `22 22 18`），**不要**写 `#hex` 或 `rgb()`——否则 Tailwind 透明度修饰符 `/50` 会失效。
3. **BEM 语义类名无需 `!important`** — `.session-item--active`、`.git-tab__section-header` 这类直接选具体元素的规则正常写就行。

附带：CSS 里的 `url(...)` 会被主进程自动转成 base64 内联，所以 dev 模式跨域也能用背景图。

### 可用主题变量

| 变量 | 含义 |
|------|------|
| `--ide-bg` | 主背景 |
| `--ide-sidebar` | 左侧栏 |
| `--ide-panel` | 面板 / 卡片 |
| `--ide-border` | 边框 |
| `--ide-text` / `--ide-text-muted` | 主 / 次文字 |
| `--ide-accent` / `--ide-accent-hover` | 强调色 / 悬停 |
| `--ide-success` / `--ide-danger` / `--ide-warning` | 成功 / 危险 / 警告 |
| `--ide-hover` / `--ide-active` | 悬停 / 选中背景 |
| `--scrollbar-thumb` / `--scrollbar-thumb-hover` | 滚动条 |
| `--selection-bg` / `--selection-opacity` | 选区 |
| `--focus-outline` | 聚焦轮廓 |
| `--monaco-margin-bg` | 编辑器行号区背景 |

### 示例

**示例 1：把强调色改成橙色**

```css
/* snippets/orange-accent.css */
:root {
  --ide-accent: 255 179 0 !important;
  --ide-accent-hover: 255 199 51 !important;
}
```

**示例 2：给当前 Session 项加左侧高亮条**（BEM 类名，无需 `!important`）

```css
/* snippets/active-bar.css */
.session-item--active {
  border-left: 3px solid rgb(var(--ide-accent));
  padding-left: 7px; /* 抵消边框宽度，避免内容跳动 */
}
```

**示例 3：换终端背景图**（`url()` 自动转 base64）

```css
/* snippets/terminal-bg.css */
.xterm-screen {
  background-image: url('./bg.jpg');
  background-size: cover;
}
```

**示例 4：调大 Git 面板 + 文件树字体**

```css
/* snippets/git-file-fontsize.css */

/* Git 面板：文件项 / 分区头挂了 text-xs，分支名挂了 text-sm，都要 !important 才压得过 */
.git-tab__file-item,
.git-tab__section-header,
.git-tab__branch-name {
  font-size: 13px !important;
}

/* 文件树：项本身没挂字号类，直接设即可（不生效再加 !important） */
.file-tree-item,
.file-tree-item__name {
  font-size: 13px;
}
```

> 默认是 `text-xs`（12px），这里调到 13px。想再大改 `14px` / `15px`，想调小改 `11px`。Git 那侧的 `!important` 是因为这些元素挂了 Tailwind 固定字号，普通规则同优先级压不过；文件树项靠继承，所以不用。

写完丢进 `snippets/`，菜单勾选即可。

---

## 5. 14 套主题

Vibe Dark、VS Code Dark、One Dark、Dracula、Nord、Solarized Dark/Light、Monokai、Monokai Pro、GitHub Light、Monkey King、Retro Chinese、Hatsune Miku、Hatsune Light。设置 → Theme，hover 即预览。改主题色不想动代码的，用上面的 Snippets 系统覆盖变量即可。

---

## 6. 设置 & 节省内存

点左侧面板标题栏齿轮 ⚙️。常用项：

| 设置项 | 说明 |
|--------|------|
| 中 / EN | 界面语言，即时切换 |
| Theme | 14 套主题，hover 预览 |
| Emoji Text | 自定义会话图标，一行一个 |
| Shell Type | 新建终端默认 Shell（只列机器上装了的） |
| Keyboard Shortcuts | 快捷键录制 / 重置 |
| File Tree Depth / Filter Rules | 文件树展开深度 1-8 / 跳过目录 |
| **CSS Snippets** | 见上文第 4 节 |
| Other Options… | 折叠的更多选项 |

**Other Options 子面板**里几个值得知道：

- **CodeGraph** — 代码符号索引，关闭可释放主进程约 170MB。
- **OCR Image to Text** — 拖入图片 / `Ctrl+V` 识别文字贴进终端。
- **ESC Auto @ Selection** — diff 里选中文字按 ESC，自动把 `@文件路径:行号` 输进终端。
- **Force Inline Diff** — 强制内联 diff（默认 side-by-side 更易读，建议关）。
- **Auto UTF-8** — 新终端自动 `chcp 65001` 防中文乱码。
- **Capsule Tabs** — 胶囊风格选项卡。

**内存紧张时**：关 CodeGraph（省 ~170MB）+ 用 cmd 替代 PowerShell。

---

## 7. 快捷键全表

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+F` | 搜索（Search Tab 隐藏时也会自动冒出来） |
| `Ctrl+↑` / `Ctrl+↓` | 上 / 下一个 Session |
| `Ctrl+←` / `Ctrl+→` | 右侧标签页左 / 右移（切过去自动聚焦） |
| `Ctrl+H` | 弹出命令历史 |
| `Ctrl+=` / `Ctrl+-` | 字体放大 / 缩小（终端 / 编辑器各自独立） |
| `Ctrl+L` | 切换预览 / 编辑模式 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Enter` | 提交 Git commit |
| `Shift+Enter` | 终端换行但不发送（多行 prompt） |
| `Alt+↑` / `Alt+↓` | 跳上一条 / 下一条命令（prompt 行间跳转） |
| `Alt+K` | 打开 Code Graph 代码图谱搜索 |
| `Alt+F` | 终端内搜索 |
| `Alt+←` / `Alt+→` | 导航后退 / 前进 |
| `PageUp` / `PageDown` | 有内容就翻页，没有透传给 Shell |
| `Ctrl+PageUp` / `Ctrl+PageDown` | Diff 中跳上 / 下一个区块 |
| `Escape` | 关浮窗 / 退回终端（分层命中，详见 §2） |

除 Escape 和 `Ctrl+S` / `Ctrl+Enter` 外，所有快捷键都能在设置面板里改。

---

## 8. 构建与分发

```bash
npm run dev        # 热重载开发
npm run build      # 编译
npm run build:win  # 打包 win 绿色版 → dist/Vibe-IDE-x.x.x-win-x64.zip
npm test           # 测试
```

解压即用，不用安装。注册右键菜单（`register-context-menu.bat`）直接鼠标右键打开任意文件/目录.
