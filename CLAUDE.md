# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vibe IDE — an Electron-based desktop IDE with native terminal, git management, file diff/edit, content search, and session management. Built with electron-vite, React, TypeScript, and Tailwind CSS.

## UI Coding Rules

1. **抄骨不凭记** — 凡言"跟XX一样"，先 Read 模板代码，类名逐个对照，不得凭记忆自创
2. **同级同骨架** — 同级菜单/列表项，容器结构（padding/margin/分隔线）必须一致，写完 grep 同类 className 验证
3. **细节照抄** — 圆点、图标、颜色等视觉细节照搬模板写法，不变种（如 `style={{ backgroundColor: rgb(...) }}` 不改为 `var(--xxx)`）
4. **遍历交互态** — 改完后脑中过一遍 hover/选中/空态/中英文/分隔线覆盖范围
5. **信息不过二** — 同一份数据出现两次以上，立刻抽共享常量，不种重复因
6. **禁用同步弹窗** — 严禁使用 `confirm()`、`prompt()`、`alert()` 等同步阻塞式浏览器原生弹窗，会导致终端状态机异常。确认/输入类交互统一使用项目已有的异步 Modal 模式（参考 `confirmAction` 状态 + fixed 定位弹窗，或内联 `<input>` 编辑）

## Commands

### Development (start the app)
```bash
npm install        # First time: install dependencies (node-pty requires native build tools)
npm run dev        # Start dev mode with hot reload (launches Electron window)
```

### Build
```bash
npm run build      # Compile all layers (main, preload, renderer) to ./out/
npm run build:win  # Package win exe to ./out/
npm run preview    # Run the built app from ./out/ (no hot reload)
```

### version
```bash
npm version patch   # 0.1.0 → 0.1.1  修bug                                                  
npm version minor   # 0.1.0 → 0.2.0  新功能                                                 
npm version major   # 0.1.0 → 1.0.0  破坏性变更
```

## Architecture

### Electron multi-process structure (electron-vite)

The app follows standard Electron separation with electron-vite managing builds:

```
src/
├── main/                         # 主进程 (Node.js)
│   ├── index.ts                  # 应用生命周期、窗口管理、IPC 注册
│   ├── pty.ts                    # node-pty 终端会话管理
│   ├── git.ts                    # simple-git 版本控制操作
│   ├── file.ts                   # 文件系统读写、目录树
│   └── search.ts                 # ripgrep 内容搜索
├── preload/
│   └── index.ts                  # contextBridge 桥接层
├── renderer/
│   ├── index.html                # 入口 HTML
│   └── src/
│       ├── main.tsx              # React 挂载入口
│       ├── App.tsx               # 三栏布局、会话管理、全局状态
│       ├── styles/
│       │   └── globals.css       # Tailwind 基础 + CSS 变量 + 自定义动画
│       ├── components/
│       │   ├── SessionPanel.tsx  # 左侧会话列表面板
│       │   ├── TerminalView.tsx  # xterm.js 终端视图
│       │   ├── DiffViewer.tsx    # Monaco 代码编辑器/Diff 视图
│       │   ├── GitPanel.tsx      # 右侧 Git/Aux/Search/File 面板
│       │   └── SearchPanel.tsx   # 文件内容搜索组件
│       └── themes/
│           ├── types.ts          # 主题类型定义
│           ├── definitions.ts    # 11 套主题配色
│           ├── monaco-themes.ts  # Monaco 编辑器主题注册
│           ├── context.tsx       # 主题 Context Provider
│           └── index.ts          # 导出聚合
└── shared/
    └── types.ts                  # IPC 通道常量 + 跨层类型定义
```

### Main process (`src/main/`)

| File | Role |
|------|------|
| `index.ts` | 窗口管理、IPC 注册 |
| `pty.ts` | node-pty 终端会话 |
| `git.ts` | simple-git 版本控制 |
| `file.ts` | 文件系统读写 |
| `search.ts` | ripgrep 内容搜索 |

### Preload (`src/preload/index.ts`)

`contextBridge.exposeInMainWorld('api', ...)` 暴露 `window.api`（5 命名空间: terminal / git / file / workspace / search）。

### Renderer (`src/renderer/src/`)

| 组件 | 位置 | 职责 |
|------|------|------|
| `App.tsx` | 根 | 三栏布局 + 全局状态 |
| `SessionPanel.tsx` | 左侧栏 | session 列表管理 |
| `TerminalView.tsx` | 中间 | xterm.js 终端 |
| `DiffViewer.tsx` | 中间 | Monaco 编辑器/Diff |
| `GitPanel.tsx` | 右侧栏 | Git/Aux/Search/File 子面板 |
| `SearchPanel.tsx` | 右侧栏 | 文件内容搜索 |

### IPC 频道 (`src/shared/types.ts`)

所有 renderer→main 通信走 Electron IPC，分 5 组：

- **pty:** create, write, resize, rename, close, data(on), exit(on)
- **git:** setWorkspace, status, log, diff, add, reset, commit, branches, checkout, stashList, stashPush, stashPop, init, show, changed(on)
- **file:** read, write, list, tree
- **workspace:** open, current, pickDir
- **search:** grep

### Key config

- `electron.vite.config.ts` — `node-pty` is explicitly external from Rollup bundling; main uses `externalizeDepsPlugin()`; renderer uses `@vitejs/plugin-react` with `@renderer` and `@shared` path aliases
- `tsconfig.web.json` — defines path aliases `@renderer/*` → `src/renderer/src/*`, `@shared/*` → `src/shared/*`; jsx: react-jsx
- `tsconfig.node.json` — covers main/preload/shared (no path aliases); moduleResolution: bundler
- Tailwind theme — custom `ide-*` color palette:
  - `ide-bg`: `#1a1a2e`, `ide-sidebar`: `#16213e`, `ide-panel`: `#0f3460`
  - `ide-accent`: `#7c3aed`, `ide-success`: `#10b981`, `ide-danger`: `#ef4444`, `ide-warning`: `#f59e0b`
  - `ide-hover` / `ide-active` for interaction states
- CSS — custom scrollbar (3px, rounded, dark), xterm padding, Monaco margin override, titlebar drag regions (`-webkit-app-region`), purple selection highlight (30% opacity), focus visible outline (2px purple), `animate-fade-in` keyframes

### Key dependencies

- **Runtime:** `@monaco-editor/react` + `monaco-editor` (code editor/diff), `@xterm/xterm` + addons (terminal), `node-pty` (native PTY), `simple-git` (git), `react` 18, `lucide-react` (icons), `electron-updater` (auto-update)
- **Build:** `electron-vite`, `electron-builder` (packaging), `tailwindcss`, `typescript`

## Architecture Constraint: Session Independence

Each terminal session must own its Git panel state independently — **no global singletons in renderer state.**

- GitPanel state tied to the active session (worktree navigation, git paths) **must** be keyed by `activeSessionId` (e.g. `Record<string, ...>`), never a single value.
- The main-process `git.ts` uses a global `gitInstance` + `currentWorkspace`. The renderer compensates by calling `git.setWorkspace()` reactively via `useEffect` on the per-session effective path.
- Do NOT rely on `workspacePath` prop changes alone to detect session switches — two sessions can share the same cwd.
- Avoid implicit side-effects from `useEffect` for session-switch behaviors (e.g. closing terminals). Call handlers explicitly when the user performs an action.

`node-pty` is a native module that requires C++ build tools. On Windows, ensure `node-gyp` prerequisites are installed (Visual Studio Build Tools with C++ workload, or `windows-build-tools` npm package). It's externalized from the Vite bundle and loaded at runtime.
