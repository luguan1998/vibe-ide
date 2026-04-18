# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vibe IDE — an Electron-based desktop IDE with native terminal, git management, and session management. Built with electron-vite, React, and Tailwind CSS.

## Commands

### Development (start the app)
```bash
npm install        # First time: install dependencies (node-pty requires native build tools)
npm run dev        # Start dev mode with hot reload (launches Electron window)
```

### Build
```bash
npm run build      # Compile all layers (main, preload, renderer) to ./out/
npm run preview    # Run the built app from ./out/ (no hot reload)
```

There are no tests, linting, or formatting commands configured.

## Architecture

### Electron multi-process structure (electron-vite)

The app follows standard Electron separation with electron-vite managing builds:

- **Main process** (`src/main/`) — Node.js side, runs in Electron main process
  - `index.ts` — App lifecycle, window creation, IPC handler registration. Frameless window with `titleBarOverlay`.
  - `pty.ts` — Terminal session management via `node-pty`. Spawns PTY processes, pipes data through IPC. `node-pty` is externalized (not bundled by Rollup).
  - `git.ts` — Git operations via `simple-git`. All git commands (status, log, diff, add, reset, commit, branch, checkout, stash). Maintains a workspace path that changes when user opens a directory.
  - `file.ts` — File system operations (read, write, list, tree). Builds recursive file trees up to configurable depth.

- **Preload** (`src/preload/index.ts`) — Bridge between main and renderer via `contextBridge.exposeInMainWorld('api', ...)`. Exposes `window.api` with four namespaces: `terminal`, `git`, `file`, `workspace`.

- **Renderer** (`src/renderer/src/`) — React app (browser side)
  - `App.tsx` — Three-panel layout: left (SessionPanel), center (TerminalView), right (GitPanel). Resizable panels with drag handles.
  - `components/SessionPanel.tsx` — Terminal session list, create/switch/close sessions
  - `components/TerminalView.tsx` — xterm.js terminal rendering with FitAddon and WebLinksAddon. Writes to PTY via IPC, reads PTY output via IPC events.
  - `components/GitPanel.tsx` — Git management UI with tabs (Changes/Log/Branches). Stage/unstage, commit, stash, diff viewing, branch checkout.
  - `components/DiffViewer.tsx` — File diff viewer with inline diff and Monaco Editor modes. Supports switching between diff view and edit mode with file save.

- **Shared** (`src/shared/types.ts`) — IPC channel constants (`IPC_CHANNELS`) and TypeScript interfaces shared across all three Electron layers. This is the contract between main and renderer.

### IPC communication pattern

All renderer-to-main communication uses Electron IPC:
- **invoke** (request/response): `pty:create`, `pty:close`, all `git:*` and `file:*` channels
- **send** (fire-and-forget): `pty:write`, `pty:resize`
- **on** (main→renderer push): `pty:data`, `pty:exit`

### Key config

- `electron.vite.config.ts` — `node-pty` is explicitly external from Rollup bundling; renderer uses `@renderer` and `@shared` path aliases
- `tsconfig.web.json` — defines path aliases `@renderer/*` → `src/renderer/src/*`, `@shared/*` → `src/shared/*`
- `tsconfig.node.json` — covers main/preload/shared (no path aliases)
- Tailwind theme — custom `ide-*` color palette (dark purple theme: bg `#1a1a2e`, accent `#7c3aed`)
- CSS — custom scrollbar, xterm padding, Monaco margin override, titlebar drag regions, `animate-fade-in`

### Native dependency note

`node-pty` is a native module that requires C++ build tools. On Windows, ensure `node-gyp` prerequisites are installed (Visual Studio Build Tools with C++ workload, or `windows-build-tools` npm package). It's externalized from the Vite bundle and loaded at runtime.