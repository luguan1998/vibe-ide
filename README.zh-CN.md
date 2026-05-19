# Vibe IDE

[English](README.md) | **中文**

> 一款面向"氛围编码"（Vibe Coding）的桌面 IDE —— 三栏布局：左侧会话管理、中间原生终端、右侧 Git/Aux/搜索/文件工具，让开发流保持顺畅不中断。

---

## 截图

| 终端 | Git 管理 |
|------|----------|
| ![终端](build/term.png) | ![Git](build/git.png) |

![Diff](build/diff.png)

## 功能详解

### 🔵 左侧面板 — 会话管理
- **多终端会话** — 自由创建、克隆、重命名、切换、关闭终端
- **Claude 状态指示** — 简单字符检测 Claude Code 运行状态，提供导航仪表
- **命令历史** — 每条会话保留 500 条历史，支持查看和复制

### 🟢 中间 — 终端
- **原生终端** — xterm.js + node-pty，支持 PowerShell / pwsh
- **链接跳转** — 终端输出中的文件路径（`./src/file.ts:10`）点击即开
- **右键黏贴** — 右键直接粘贴剪贴板内容，支持 bracketed paste mode
- **Shift+Enter** — 换行不发送，方便输入多行命令
- **字号调节** — `Ctrl+=` / `Ctrl+-` 随时调整

### 🟡 右侧面板 — 多功能侧栏
- **Git** — 图形化暂存/取消暂存、提交 (Ctrl+Enter)、分支切换、Stash 操作、提交历史（含文件级 Diff），文件变更自动刷新
- **Aux** — 辅助子命令行，用于快速测试，自动提取 CLAUDE.md 里的 commands 配置
- **搜索** — 基于 ripgrep 的全文搜索，支持正则、大小写、文件类型过滤
- **文件** — 文件树导航器，浏览和打开项目文件

### 🟣 编辑器 & Diff
- **Monaco Editor** — 直接编辑文件，30+ 语言语法高亮
- **Git Diff** — 并排 Diff 对比，逐区块查看变更
- **保存** — `Ctrl+S` 写回磁盘，触发 Git 刷新

### ⚫️ 主题
- 紫色系暗色主题，内置 **11 套配色方案** 随时切换

---

## 技术栈

| 层 | 技术 |
|-------|----------|
| **框架** | Electron + electron-vite |
| **UI** | React 18 + TypeScript + Tailwind CSS |
| **终端** | xterm.js + node-pty |
| **编辑器** | Monaco Editor (`@monaco-editor/react`) |
| **Git** | simple-git |
| **搜索** | ripgrep (rg) + Node.js 回退 |
| **图标** | lucide-react |
| **打包** | electron-builder |

---

## 快速开始

### 前置要求

- Node.js >= 18
- npm
- Windows 系统（目前主要支持）

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
├── main/            # 主进程 (Node.js)
│   ├── index.ts     # 应用生命周期、窗口管理、IPC 注册
│   ├── pty.ts       # node-pty 终端会话管理
│   ├── git.ts       # simple-git 版本控制
│   ├── file.ts      # 文件系统读写、目录树
│   └── search.ts    # ripgrep 内容搜索
├── preload/
│   └── index.ts     # contextBridge 桥接层
├── renderer/
│   └── src/
│       ├── App.tsx              # 三栏布局、会话管理、全局状态
│       ├── components/
│       │   ├── SessionPanel.tsx # 左侧会话列表面板
│       │   ├── TerminalView.tsx # xterm.js 终端视图
│       │   ├── DiffViewer.tsx   # Monaco 编辑器/Diff 视图
│       │   ├── RightPanel.tsx   # 右侧多 tab 面板（编排器）
│       │   ├── GitTab.tsx       # Git tab：版本控制
│       │   ├── AuxTab.tsx       # Aux tab：辅助终端 + CLAUDE.md 命令
│       │   ├── FileTab.tsx      # File tab：文件浏览器 + arch 目录树
│       │   ├── FileIcons.tsx    # 共享：文件类型图标映射
│       │   ├── DocTree.tsx      # 共享：CLAUDE.md 解析 + 文档树
│       │   └── SearchPanel.tsx  # 文件内容搜索
│       └── themes/              # 11 套主题配色
└── shared/
    └── types.ts     # IPC 通道常量 + 跨层类型定义
```

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+F` | 聚焦搜索面板 |
| `Ctrl+S` | 保存文件编辑 |
| `Ctrl+Enter` | 提交 Git 提交 |
| `Ctrl+↑` / `Ctrl+↓` | 切换终端会话 |
| `Ctrl+←` / `Ctrl+→` | 切换右侧面板标签页 |
| `Ctrl+=` / `Ctrl+-` | 增大 / 减小终端字号 |
| `Shift+Enter` | 终端内换行（不发送执行） |
| `右键点击` | 终端复制 / 粘贴 |
| `Esc` | 关闭 Diff 视图 / 返回 |

---

## 相关项目

- [electron-vite](https://github.com/alex8088/electron-vite)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)

---

## 许可

[MIT](LICENSE)
