# Vibe IDE

[English](README.md) | **中文**

> 一款面向"氛围编码"（Vibe Coding）的桌面 IDE —— 三栏布局：左侧会话管理、中间原生终端、右侧 Git/Aux/搜索/文件工具，并内置 Claude AI 助手、实时代码图、嵌入式浏览器与桌面宠物，让开发流保持顺畅不中断。

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

### 🤖 AI Tab — 内置 Claude 助手
- 流式渲染 Claude Code（CLI 子进程）token，实时 Markdown 渲染
- **思维块（Thinking blocks）** 含耗时，流式期间保持展开
- **工具调用可视化** — 文件编辑（含 Diff）、命令、搜索、网络、计划、技能、Agent、提问、任务
- **权限提示** — plan / acceptEdits / bypassPermissions 模式
- 斜杠命令、会话列表/加载、模型切换、回退/Fork、Worktree 导航、示例提示
- Plan→Execute 流水线；AskUserQuestion 恢复

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
- **Mujica** — 多 Agent Claude 编队指挥（并行会话可视化为乐队）
- 小游戏：2048、Sandspiel（落沙模拟）、Balatro（扑克 Roguelike）
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
- Windows 系统（主要支持）；macOS 已支持（终端、文件树、Git、搜索）

### 安装 & 运行

```bash
# 克隆仓库
git clone https://github.com/luguan/vibe-ide.git
cd vibe-ide

# 安装依赖
npm install

# 启动开发模式（含热重载）
npm run dev
```

> **注意：** `node-pty` 是原生模块，Windows 下需要 Visual Studio Build Tools（C++ 工作负载）。确保 `node-gyp` 环境已配置。

### 构建

```bash
# 编译项目
npm run build

# 打包 Windows 安装包
npm run build:win
```

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
            └── Game*.tsx          # Mujica、2048、Sandspiel、Balatro

pets/                              # 宠物精灵图（5 个角色）
snippets/                          # CSS 片段（在 设置 → Snippets 中切换）
```

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+P` | 快速打开文件 |
| `Ctrl+F` | 聚焦搜索面板 |
| `Ctrl+S` | 保存文件编辑 |
| `Ctrl+Enter` | 提交 Git 提交 |
| `Ctrl+↑` / `Ctrl+↓` | 切换终端会话 |
| `Ctrl+←` / `Ctrl+→` | 切换右侧面板标签页 |
| `Ctrl+=` / `Ctrl+-` | 增大 / 减小终端字号 |
| `Shift+Enter` | 终端内换行（不发送执行） |
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
