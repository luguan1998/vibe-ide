# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vibe IDE — an Electron-based desktop IDE with native terminal, git management, file diff/edit, content search, and session management. Built with electron-vite, React, TypeScript, and Tailwind CSS.

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

There are no tests, linting, or formatting commands configured.

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

- **Main process** (`src/main/`) — Node.js side, runs in Electron main process
  - `index.ts` — App lifecycle, frameless `BrowserWindow` (1400x900, min 900x600) with `titleBarOverlay` (height 36, bg `#1a1a2e`). Fixes Windows GPU cache permissions, adds `--no-sandbox` flag, registers all IPC handlers. Sets app model ID `com.vibe-ide`.
  - `pty.ts` — Terminal session management via `node-pty`. Spawns pwsh.exe (preferred) or powershell.exe with `-NoLogo`. Implements 600ms startup banner discard (buffers initial output, then clears screen + sends `Clear-Host` for a clean prompt). Exposes `registerPtyHandlers()` and `cleanupTerminals()`. Maintains internal `terminals` Map.
  - `git.ts` — Git operations via `simple-git`. All git commands: status, log, diff, add, reset, commit, branch, checkout, stash (list/push/pop), init, show. Maintains workspace path and a file watcher (`fs.watch`) that uses a 2-second cooldown to batch `git:changed` push events for auto-refresh. Should `WATCHER_SKIP` regex skip `.git`, `node_modules`, and common build dirs.
  - `file.ts` — File system operations (read, write, list, tree). `file:tree` builds recursive file trees up to configurable depth (default 3), skips hidden dirs, `node_modules`, `.git`.
  - `search.ts` — Content search via `search:grep`. Tries ripgrep (`rg --json`) as a subprocess first (200 max results, 15s timeout), falls back to Node.js native implementation. Skips `node_modules`, `.git`, `dist`, `build`, etc. Supports regex, case-sensitive, and include pattern (glob) options. Files over 1MB are skipped.

- **Preload** (`src/preload/index.ts`) — Bridge between main and renderer via `contextBridge.exposeInMainWorld('api', ...)`. Exposes `window.api` with five namespaces: `terminal`, `git`, `file`, `workspace`, `search`. All `invoke` channels use `ipcRenderer.invoke()`, all `send` channels use `ipcRenderer.send()`, all `on` channels use `ipcRenderer.on()` with cleanup methods (`removeDataListener`, `removeExitListener`, `removeChangedListener`).

- **Renderer** (`src/renderer/src/`) — React app (browser side)
  - `App.tsx` — Three-panel layout: left (SessionPanel), center (TerminalView / DiffViewer), right (GitPanel with sub-tabs). Resizable panels with drag handles. Manages sessions, active session, auxiliary right terminal, diff file state, search focus trigger, command history (per session, 500 max), and `showSquiggles` config. Auto-creates first session on mount. Ctrl+F captured in capture phase to focus search panel.
  - `components/SessionPanel.tsx` — Terminal session list with create (+), switch, clone, close, and inline rename. Right-click context menu (Clone, Rename, History, Close). History modal shows per-session command history with copy buttons (entries truncated to 80 chars).
  - `components/TerminalView.tsx` — xterm.js terminal (`React.memo`). Uses FitAddon, WebLinksAddon, ClipboardAddon. Custom dark purple theme (bg `#1a1a2e`, cursor `#7c3aed`). Font: JetBrains Mono / Fira Code / Cascadia Code / Consolas, 14px, 10000-line scrollback. `FileLinkProvider` (implements `ILinkProvider`) detects Windows absolute paths and relative paths (`./src/file.ts:10`) in terminal output — click to open in DiffViewer. Right-click pastes clipboard text via xterm's `paste()` (respects bracketed paste mode). Tracks command history by reading scrollback on Enter, stripping ANSI codes, and extracting shell commands via prompt boundary regex.
  - `components/GitPanel.tsx` — Right panel with bottom tab navigation: Git / Aux / Search / File. Git section has three sub-tabs:
    - **Changes** — Staged/unstaged/untracked file lists with per-file stage/unstage, Stage All / Unstage All, stash push/pop, commit message textarea (Ctrl+Enter to commit).
    - **Log** — Last 50 commits, expandable to show changed files with +/- counts, click file to open diff.
    - **Branches** — List all branches, click to checkout.
    Detects non-git directories and shows "git init" button. Listens to `git:changed` push events for auto-refresh. Auto-calls `git.setWorkspace()` when `workspacePath` changes.
  - `components/DiffViewer.tsx` — File diff viewer/editor using Monaco Editor (`React.memo`). Two modes: **diff** (`DiffEditor`) and **edit** (`Editor`). Parses unified diff content for Monaco. File type → Monaco language mapping (~30 languages). Supports line number jump on mount. Ctrl+S saves edited content back to filesystem, triggers git refresh. Stage/unstage buttons. Shows +/- stats in header.
  - `components/SearchPanel.tsx` — Content search panel. 300ms debounced input, regex toggle, case-sensitive toggle, optional include pattern (e.g. `*.ts`). Results grouped by file (expandable/collapsible), showing line numbers and content snippets (max 200 chars). Total count display with truncation warning at 200. Click result to open file in DiffViewer. Loading spinner during search. Focus trigger via `focusTrigger` prop (incremented by Ctrl+F).

- **Shared** (`src/shared/types.ts`) — IPC channel constants (`IPC_CHANNELS`) and TypeScript interfaces shared across all three Electron layers. This is the contract between main and renderer.

### IPC communication pattern

All renderer-to-main communication uses Electron IPC:

**Terminal channels:**
- `pty:create` (invoke) — Create new PTY session
- `pty:write` (send) — Write data to PTY
- `pty:resize` (send) — Resize PTY cols/rows
- `pty:rename` (invoke) — Rename a session
- `pty:close` (invoke) — Close PTY session
- `pty:data` (on) — Main→renderer: PTY output data
- `pty:exit` (on) — Main→renderer: PTY process exit

**Git channels:**
- `git:setWorkspace` (invoke) — Set working directory, start file watcher
- `git:status` (invoke) — Get working tree status
- `git:log` (invoke) — Get commit log (50 entries)
- `git:diff` (invoke) — Get diff (supports --cached and file path)
- `git:add` (invoke) — Stage files
- `git:reset` (invoke) — Unstage files
- `git:commit` (invoke) — Commit with message
- `git:branches` (invoke) — List branches
- `git:checkout` (invoke) — Checkout branch
- `git:stashList` (invoke) — List stashes
- `git:stashPush` (invoke) — Push stash
- `git:stashPop` (invoke) — Pop stash
- `git:init` (invoke) — Initialize git repo
- `git:show` (invoke) — Show commit details with per-file diffs
- `git:changed` (on) — Main→renderer: file watcher push event (2s cooldown)

**File channels:**
- `file:read` (invoke) — Read file content
- `file:write` (invoke) — Write file content (auto-creates parent dirs)
- `file:list` (invoke) — List directory entries
- `file:tree` (invoke) — Recursive file tree (configurable depth, default 3)

**Workspace channels:**
- `workspace:open` (invoke) — Open directory dialog, changes global workspace
- `workspace:current` (invoke) — Get current workspace path
- `workspace:pickDir` (invoke) — Open directory dialog without changing global state

**Search channels:**
- `search:grep` (invoke) — Search file contents (ripgrep with Node.js fallback)

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

- **Runtime:** `@anthropic-ai/claude-code` (Claude CLI), `@monaco-editor/react` + `monaco-editor` (code editor/diff), `@xterm/xterm` + addons (terminal), `node-pty` (native PTY), `simple-git` (git), `react` 18, `lucide-react` (icons), `electron-updater` (auto-update)
- **Build:** `electron-vite`, `electron-builder` (packaging), `tailwindcss`, `typescript`

### Native dependency note

`node-pty` is a native module that requires C++ build tools. On Windows, ensure `node-gyp` prerequisites are installed (Visual Studio Build Tools with C++ workload, or `windows-build-tools` npm package). It's externalized from the Vite bundle and loaded at runtime.
