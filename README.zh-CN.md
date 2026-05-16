# Vibe IDE

[English](README.md) | **中文**

> 一款面向"氛围编码"（Vibe Coding）的桌面 IDE —— 集成原生终端、Git 管理、代码编辑与文件搜索，让开发流保持顺畅不中断。

---

## 特性

- **原生终端** — 基于 xterm.js + node-pty，支持 PowerShell / pwsh，多会话管理，终端内路径点击直接打开文件
- **Git 集成** — 图形化暂存/取消暂存、提交、分支切换、Stash 操作、提交历史查看，文件变更实时监听自动刷新
- **代码编辑器 & Diff** — 基于 Monaco Editor，支持文件编辑与 Git Diff 对比，30+ 语言语法高亮
- **全文搜索** — 基于 ripgrep 的高速内容搜索，支持正则、大小写、文件类型过滤
- **多会话管理** — 创建、克隆、重命名、关闭终端会话，每条会 500 条命令历史记录
- **深色主题** — 紫色系暗色主题，多套配色方案可切换
- **Electron 桌面应用** — 原生窗口体验，可拖拽标题栏，可调宽高三栏布局

---

## 截图

| 终端 | Git 管理 | Diff 对比 |
|------|----------|-----------|
| ![终端](build/term.png) | ![Git](build/git.png) | ![Diff](build/diff.png) |

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
│       │   ├── GitPanel.tsx     # 右侧 Git/Aux/Search/File 面板
│       │   └── SearchPanel.tsx  # 文件内容搜索
│       └── themes/              # 11 套主题配色
└── shared/
    └── types.ts     # IPC 通道常量 + 跨层类型定义
```

---

## 快捷键

| 快捷键 | 功能 |
|----------|------|
| `Ctrl+F` | 聚焦搜索面板 |
| `Ctrl+S` | 保存文件编辑 |
| `Ctrl+Enter` | 提交 Git 提交 |

---

## 相关项目

- [electron-vite](https://github.com/alex8088/electron-vite)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)

---

## 许可

[MIT](LICENSE)
