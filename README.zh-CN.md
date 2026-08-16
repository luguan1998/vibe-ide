# Vibe IDE

[English](README.md) | **中文**

> 一款面向"氛围编码"（Vibe Coding）的桌面 IDE —— 三栏布局：左侧会话管理、中间原生终端、右侧 Git/Aux/搜索/文件工具，并内置 Claude AI 助手、DeepSeek Harness（dsh）Agent 模式、实时代码图、嵌入式浏览器与桌面宠物，让开发流保持顺畅不中断。

---

## 快速上手：三种基本用法

Vibe IDE 的中间栏有三种核心使用方式 —— **终端（Terminal）**、**Claude GUI** 和 **dsh**，覆盖从纯命令行到 AI 结对编程的各种工作流。三者共用左侧会话列表和右侧 Git / 搜索 / 文件工具；Claude Code 和 dsh 的历史会话都可以在“会话历史”中恢复。

### 1. Terminal —— 原生终端

- 默认中间视图，日常 Shell 命令、Git 操作、脚本调试都从这里开始，相当于 PowerShell / bash 的增强版。
- 支持多终端会话、命令历史、右键粘贴、点击文件路径跳转，以及 `Ctrl+=` / `Ctrl+-` 实时调节字号。
- 是与项目打交道最直接、最底层的方式。

### 2. Claude GUI —— Claude Code 桌面 GUI

- 新建会话时选择 **Claude**，即可打开内置的 Claude Code 桌面图形界面。
- 本质是 Claude Code CLI 的桌面 GUI 前端：在聊天框里直接提需求，实时流式查看回答、思维块、工具调用和权限提示。
- 支持会话历史、模型切换、Plan→Execute、回退/Fork、Worktree 导航等，适合把编码任务交给 Claude 去执行。

### 3. dsh —— DeepSeek Harness Agent

- 新建会话时选择 **dsh**，即可进入 DeepSeek Harness Agent 模式。
- 在 Vibe 内嵌渲染真实 dsh 对话界面，支持思维链、工具调用、流式输出和轨迹回放。
- 会话仍由左侧面板统一管理，支持 dsh 插件管理，并与原生 dsh CLI 共用 `~/.dsh`，方便在 IDE 内外无缝衔接。

---

## 截图

| 终端 | Git 管理 |
|------|----------|
| ![终端](build/term.png) | ![Git](build/git.png) |

![Diff](build/diff.png)

## 功能详解

### 🔵 左侧面板 — 会话与导航
- **多终端会话** — 自由创建、克隆、重命名、切换、关闭终端
- **最近文件与目录** — 快速重开，跨启动持久化
- **Claude 状态指示** — 简单字符检测 Claude Code 运行状态，提供导航仪表
- **命令历史** — 每条会话保留 500 条历史，支持查看和复制

### 🟢 中间 — 终端 / 编辑器 / 预览 / 浏览器
- **原生终端** — xterm.js + node-pty（PowerShell / pwsh），WebGL 渲染器，含剪贴板、链接、unicode-graphemes 插件
- **链接跳转** — 终端输出中的文件路径（`./src/file.ts:10`）点击即开
- **右键黏贴** — 右键直接粘贴剪贴板内容，支持 bracketed paste mode
- **Shift+Enter** — 换行不发送，方便输入多行命令
- **字号调节** — `Ctrl+=` / `Ctrl+-` 随时调整
- **终端背景图** — 通过 `--terminal-bg-image` CSS 变量设置，兼容 WebGL 透明
- **Monaco 编辑器** — 直接编辑文件，30+ 语言语法高亮，编码自动识别（jschardet + iconv-lite）
- **Git Diff** — 并排 Diff 对比，逐区块查看变更
- **Markdown 预览** — GFM + mermaid 图表，frontmatter、大纲、搜索
- **图片预览** — `file://` 查看器
- **嵌入式浏览器** — Chromium webview，含地址栏、前进/后退，以及元素拾取器（生成 CSS 选择器作为 AI 输入）

### 🟡 右侧面板 — 多功能侧栏
- **Git** — 图形化暂存/取消暂存、提交 (Ctrl+Enter)、分支切换、Stash 操作、推送、Worktree、行日志、可视化提交图，文件变更自动刷新
- **Aux** — 辅助子终端 + DocTree（提取 CLAUDE.md 中的 `## Commands` 章节）
- **搜索** — 基于 ripgrep 的全文搜索/替换，支持正则、大小写、文件类型过滤，CodeGraph 符号结果
- **文件** — 文件树导航器，最近文件、按名搜索、过滤规则
- **外观** — 主题选择、会话 emoji、面板布局、宠物配置、字体/透明度/Snippets 开关
- **设置** — 完整快捷键编辑器（录制 / 自定义 / 重置）

### 🤖 AI Tab — Claude Code Desktop GUI（内置 Claude 助手）
- 本质就是 Claude Code 的桌面 GUI 版：以 CLI 子进程为后端，流式渲染 token，实时 Markdown 显示
- **思维块（Thinking blocks）** 含耗时，流式期间保持展开
- **工具调用可视化** — 文件编辑（含 Diff）、命令、搜索、网络、计划、技能、Agent、提问、任务
- **权限提示** — plan / acceptEdits / bypassPermissions 模式
- 斜杠命令、会话列表/加载、模型切换、回退/Fork、Worktree 导航、示例提示
- Plan→Execute 流水线；AskUserQuestion 恢复

### 🧠 dsh Agent 模式 — DeepSeek Harness
- 与终端、Claude 并列的第三种中间视图：可从新建会话选择器创建 `dsh` 会话；历史会话可从会话历史中恢复
- 在进程内渲染真实 dsh 对话界面（cordis 插件栈），支持思维链 / 工具调用 / 流式输出 / 轨迹
- 会话仍由 Vibe 左侧面板管理；dsh 工作区挂载、Fork、历史恢复/删除均同步回 Vibe
- 通过 dsh 主题桥自动跟随 Vibe 主题与字体
- 桌面宠物可监听最新 dsh 回复并以气泡展示
- **dsh 插件管理** — 设置 → dsh → 插件 → *安装插件*：支持添加/卸载 dsh 包并原地重启 dsh；与原生 dsh CLI 共用 `~/.dsh`

### 🐾 桌面宠物
- 基于 webp 精灵图的动画宠物，在桌面上溜达
- 5 个角色：Capvolt、Clawd、Guga、Maodie、Sky Striker Raye
- 可拖动，可配置缩放 / 位置 / 帧率，9 种逻辑状态（空闲/忙碌/警告/失焦 + 瞬态事件）
- 气泡菜单含小键盘快捷键 + 可扩展分区

### 🗺️ 代码图（CodeGraph）
- 符号索引 + 调用图（DAGRE 可视化）
- 符号搜索，含类型过滤、探索模式、相关上下文查找
- 一键发送上下文至 Claude / Cursor / Codex / opencode / Hermes / Gemini / Kiro

### 🎨 主题与自定义 CSS
- **14 套主题** — VS Code Dark、GitHub Light、Vibe Dark、One Dark、Dracula、Nord、Solarized Dark/Light、Monokai、Monokai Pro、Monkey King、Retro Chinese、Hatsune Miku、Lemon Light
- **自定义 CSS 导入（Snippets）** — 把任意 `.css` 丢进 `snippets/` 即自动识别，在 设置 → Snippets 一键启用/禁用，**无需改源码即可重塑整个界面**：
  - 覆盖主题色变量（`--ide-accent` 等，需 `!important`）
  - 终端背景图 / 动画 / 字号 / 滚动条样式
  - 随包附带 11 款片段：starry-night、dont-starve、macos、nes-8bit、nyan-cat、Bloodborne 等

### 🎮 更多
- **会话历史（Session History）** — 统一浏览/搜索 Claude Code（TUI/GUI）与 dsh 历史会话，支持恢复和删除
- **Mujica** — 多 Agent Claude 编队指挥（并行会话可视化为乐队）
- 小游戏：2048、Sandspiel（落沙模拟）、Balatro（扑克 Roguelike）、Fruit Ninja、Vampire Survivors
- **OCR** — Tesseract.js（chi_sim + eng），识别图片/截图
- **i18n** — 中文 / 英文
- **文件系统监听** — cwd 变更实时刷新

---

## 技术栈

| 层 | 技术 |
|-------|----------|
| **框架** | Electron + electron-vite |
| **UI** | React 18 + TypeScript + Tailwind CSS |
| **终端** | xterm.js（WebGL / 剪贴板 / 链接 / unicode-graphemes）+ node-pty |
| **编辑器** | Monaco Editor (`@monaco-editor/react`) |
| **AI** | Claude Code CLI 子进程（stream-json） |
| **dsh Agent** | DeepSeek Harness 子进程 + 内置 cordis 客户端栈 |
| **Git** | simple-git |
| **搜索** | ripgrep (rg) + Node.js 回退 |
| **代码图** | `@colbymchenry/codegraph` CLI（符号索引/调用分析）+ dagre（图布局） |
| **Markdown** | react-markdown + remark-gfm + mermaid |
| **OCR** | tesseract.js |
| **编码** | jschardet + iconv-lite |
| **图标** | lucide-react |
| **打包** | electron-builder |

---

## 快速开始

### 前置要求

- Node.js >= 18
- npm
- pnpm（可选——仅在需要重新构建内置 dsh harness 时需要）
- Windows 系统（目前主要支持）

### 仓库布局

**dsh Agent 模式**会以子进程方式拉起本地
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 服务。运行时已内置在
`vendor/harness/` 中，并通过 `file:./vendor/harness/...` 引用，因此**新克隆即可直接使用 dsh 模式**，
无需再额外 clone 一个同级 deepseek-harness 仓库。

```
claudeui/
├── src/             # Vibe IDE 源码
└── vendor/harness/  # 内置 DeepSeek Harness 运行时 + CLI
```

如果你从上游重新替换 `vendor/harness`，需要先重新构建 lib 产物：

```bash
cd vendor/harness
pnpm install
npm run build:lib:host && npm run build:lib:client
cd ..
npm install
```

### dsh 预设

`presets/` 存放可直接使用的 dsh agent 预设。把预设目录复制到用户预设根目录即可生效，无需改任何代码：

```bash
cp -r presets/minimal-gitbash "$USERPROFILE/.dsh/.agent-presets/"
```

`presets/minimal-gitbash` 是官方 `minimal` 预设的 **Windows 专属**变体：双工具 Agent（持久
`bash` + `str_replace_editor`），显式使用 Git Bash。macOS/Linux 上自带的 `minimal` 预设开箱即用
（默认 `/bin/bash` 就是系统 bash），无需本预设。

复制前先编辑 `agent.cordis.yml`，把 `shellPath` 改为该机器上 Git Bash 的实际路径：

```yaml
- id: terminal-bash
  name: '@deepseek-ai/dsh-terminal-bash'
  config:
    timeoutMs: 300000
    shellPath: 'C:\Program Files\Git\bin\bash.exe'   # <- 换成你机器的 Git bash.exe 路径
```

复制后即可在 dsh 预设列表中选择；要作为默认，在设置里选为默认（或改
`~/.dsh/settings.yaml` 的 `agent-presets.default`）。

### 安装 & 运行（新电脑完整流程）

```bash
# 1. 克隆本仓库
git clone https://github.com/luguan/vibe-ide.git
cd vibe-ide

# 2. 安装并启动 Vibe IDE
npm install
npm run dev
```

> **注意：**
> - `node-pty` 是原生模块，Windows 下需要 Visual Studio Build Tools（C++ 工作负载）。确保 `node-gyp` 环境已配置。
> - 内置 `file:` 依赖会在 `npm install` 时安装进 `node_modules`——替换 `vendor/harness` 后需重新 `npm install` 同步。
> - 开发模式自动从 `vendor/harness/apps/cli/lib/bin.js` 发现 dsh 运行时。

### 隐私说明：遥测已删除

harness 唯一的数据外传通道——`session-telemetry-otel` 包（OTLP/HTTP 日志上报到
`harness-telemetry.deepseeksvc.com`）——已从 harness 源码中**彻底删除并重新构建**。
除你自己配置的 LLM API 端点外，无任何分析 SDK、崩溃上报或默认外联。若以后合并上游
harness 改动，请复查是否有遥测回归；`src/main/dsh.ts` 中保留的 `DSH_TELEMETRY_DISABLED=1`
（任意非空值即强制禁用遥测行）作为纵深防御。

### 构建 & 打包

```bash
# 编译项目
npm run build

# 打包 Windows 安装包（NSIS + 7z）
npm run build:win
```

**打包后的 dsh 运行时：** harness CLI 已随安装包内置在 `resources/app.asar/vendor/harness/apps/cli`。
安装器还会在安装根目录放置 `dsh.cmd` / `dsh.ps1` / `dsh.sh` 包装脚本，并可选加入 `PATH`，
因此安装后也可以在 IDE 外直接使用 `dsh`（包括插件管理）。如需指定其他运行时，仍可通过 `DSH_CLI_BIN` 覆盖。

### 预览构建产物

```bash
npm run preview
```

---

## 项目结构

```
src/
├── main/                          # 主进程 (Node.js)
│   ├── index.ts                   # 应用生命周期、窗口、IPC 注册、snippet/pet 加载
│   ├── ai.ts                      # Claude CLI 子进程（stream-json、权限、模型/模式切换）
│   ├── ai-ask-resume.ts           # AskUserQuestion 杀进程并恢复
│   ├── ai-plan-execute.ts         # Plan→Execute 流水线
│   ├── ai-revert.ts               # 会话回退 + Fork
│   ├── pty.ts                     # node-pty 终端会话管理
│   ├── git.ts                     # simple-git（status/log/diff/commit/branch/stash/push/worktree/graph）
│   ├── file.ts                    # 文件系统读/写/树/重命名/复制/移动
│   ├── search.ts                  # ripgrep 内容搜索/替换
│   ├── codegraph.ts               # 符号索引 + 调用图
│   ├── dsh.ts                     # dsh 子进程服务 + 插件管理
│   ├── ocr.ts                     # Tesseract.js OCR
│   └── watcher.ts                 # 文件系统监听
├── preload/
│   └── index.ts                   # contextBridge（terminal/git/file/workspace/search/ai/code/ocr/snippets/pet/…）
├── shared/
│   ├── types.ts                   # IPC 通道常量 + 跨层类型定义
│   └── encodings.ts               # iconv-lite 编码分组
└── renderer/
    └── src/
        ├── App.tsx                # 布局、中栏视图切换、全局快捷键
        ├── aiStore.ts             # AI 会话状态 store
        ├── mujicaStore.ts         # Mujica 多 Agent 状态 store
        ├── dsh/                   # dsh cordis 装配 + 主题桥 + 历史辅助
        ├── i18n.ts                # 中英文 i18n
        ├── shortcuts.ts           # 快捷键定义 + 持久化
        ├── themes/                # 14 套主题 + Monaco 主题 + ThemeProvider
        ├── languages/             # Monaco tokenizer 补丁（JSX/Python/Shell）
        ├── utils/                 # 共享工具
        └── components/
            ├── SessionPanel.tsx   # 左侧会话 + 最近文件
            ├── TerminalView.tsx   # xterm.js 终端视图
            ├── DiffViewer.tsx     # Monaco 编辑器/Diff 视图
            ├── RightPanel.tsx     # 右侧多 tab 面板（编排器）
            ├── GitTab.tsx         # Git 版本控制 tab
            ├── GitGraph.tsx       # 可视化提交图
            ├── AuxTab.tsx         # Aux 终端 + DocTree
            ├── FileTab.tsx        # 文件浏览器
            ├── SearchPanel.tsx    # ripgrep 搜索
            ├── AiTab.tsx          # Claude AI 聊天面板
            ├── DshView.tsx        # dsh Agent 视图（Vibe 中栏内嵌对话界面）
            ├── DshPluginTab.tsx   # dsh 插件安装/卸载 UI
            ├── HistoryView.tsx    # 会话历史浏览（Claude + dsh）
            ├── BrowserView.tsx    # 嵌入式浏览器 + 元素拾取
            ├── MarkdownPreview.tsx# Markdown + mermaid 预览
            ├── ImagePreview.tsx   # 图片查看器
            ├── QuickOpen.tsx      # Ctrl+P 模糊打开文件
            ├── NavBar.tsx         # 浮动最近文件面包屑
            ├── OutlinePanel.tsx   # 文档大纲
            ├── SettingsPanel.tsx  # 快捷键编辑器
            ├── AppearancePanel.tsx# 主题 / 宠物 / 布局配置
            ├── DesktopPet/        # 动画宠物（精灵图、状态图、气泡菜单）
            ├── CodeGraph*.tsx     # 调用图 + 符号搜索
            └── Game*.tsx          # 启动器：会话历史、Mujica、2048、Sandspiel、Balatro、Fruit Ninja、Vampire Survivors

pets/                              # 宠物精灵图（5 个角色）
snippets/                          # CSS 片段（在 设置 → Snippets 中切换）
```

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+P` | 快速打开文件 |
| `Ctrl+F` | 聚焦搜索面板 |
| `Ctrl+H` | 命令历史（终端 / dsh） |
| `Ctrl+S` | 保存文件编辑 |
| `Ctrl+Enter` | 提交 Git 提交 |
| `Ctrl+↑` / `Ctrl+↓` | 切换终端会话 |
| `Ctrl+←` / `Ctrl+→` | 切换右侧面板标签页 |
| `Ctrl+=` / `Ctrl+-` | 增大 / 减小终端字号 |
| `Shift+Enter` | 终端内换行（不发送执行） |
| `Alt+K` | 打开 CodeGraph 搜索 |
| `Alt+F` | 搜索终端 |
| `Alt+←` / `Alt+→` | 后退 / 前进 |
| `长按 Alt` | 显示 NavBar（最近文件） |
| `右键点击` | 终端复制 / 粘贴 |
| `Esc` | 关闭 Diff / 预览 / 返回 |

> 所有快捷键均可在 **设置 → 快捷键** 中自定义。

---

## 相关项目

- [electron-vite](https://github.com/alex8088/electron-vite)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)
- [Claude Code](https://github.com/anthropics/claude-code)
- [dagre](https://github.com/dagrejs/dagre)
- [mermaid](https://github.com/mermaid-js/mermaid)
- [tesseract.js](https://github.com/naptha/tesseract.js)

---

## 许可

[MIT](LICENSE)
