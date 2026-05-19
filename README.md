# Vibe IDE

**English** | [中文](README.zh-CN.md)

> A vibe coding desktop IDE with a three-panel layout — session management, native terminal, and Git/Aux/Search/File tools — built to keep your flow state uninterrupted.

---

## Screenshots

| Terminal | Git Management |
|----------|---------------|
| ![Terminal](build/term.png) | ![Git](build/git.png) |

![Diff](build/diff.png)

## Features

### 🔵 Left Panel — Session Management
- **Multi-terminal sessions** — create, clone, rename, switch, and close sessions at will
- **Claude status indicator** — lightweight character detection monitors Claude Code running state, acts as a navigation dashboard
- **Command history** — 500 entries per session, review and copy

### 🟢 Center — Terminal
- **Native terminal** — xterm.js + node-pty, PowerShell / pwsh
- **Link jump** — click file paths in terminal output (`./src/file.ts:10`) to open directly in editor
- **Right-click paste** — paste clipboard content with bracketed paste mode support
- **Shift+Enter** — insert newline without sending command
- **Font size** — `Ctrl+=` / `Ctrl+-` to adjust on the fly

### 🟡 Right Panel — Multi-Tool Sidebar
- **Git** — visual staging/unstaging, commit (Ctrl+Enter), branch checkout, stash push/pop, commit log with file-level diff, auto-refresh on file changes
- **Aux** — auxiliary sub-terminal for quick tests, automatically extracts `commands` from CLAUDE.md
- **Search** — full-text search powered by ripgrep, regex/case/glob filters
- **File** — file tree navigator, browse and open files

### 🟣 Editor & Diff
- **Monaco Editor** — edit files directly, syntax highlight for 30+ languages
- **Git Diff** — side-by-side diff comparison with per-hunk details
- **Save** — `Ctrl+S` writes back to disk, triggers git refresh

### ⚫️ Theme
- Purple-toned dark theme with **11 color schemes** to switch between

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Electron + electron-vite |
| **UI** | React 18 + TypeScript + Tailwind CSS |
| **Terminal** | xterm.js + node-pty |
| **Editor** | Monaco Editor (`@monaco-editor/react`) |
| **Git** | simple-git |
| **Search** | ripgrep (rg) + Node.js fallback |
| **Icons** | lucide-react |
| **Packaging** | electron-builder |

---

## Quick Start

### Prerequisites

- Node.js >= 18
- npm
- Windows (primary target)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/luguan/vibe-ide.git
cd vibe-ide

# Install dependencies
npm install

# Start dev mode with hot reload
npm run dev
```

> **Note:** `node-pty` is a native module requiring C++ build tools on Windows. Make sure `node-gyp` prerequisites are installed (Visual Studio Build Tools with C++ workload).

### Build

```bash
# Compile the project
npm run build

# Package Windows installer
npm run build:win
```

### Preview Built App

```bash
npm run preview
```

---

## Project Structure

```
src/
├── main/            # Main process (Node.js)
│   ├── index.ts     # App lifecycle, window management, IPC handlers
│   ├── pty.ts       # node-pty terminal session management
│   ├── git.ts       # simple-git version control operations
│   ├── file.ts      # File system read/write, directory tree
│   └── search.ts    # ripgrep content search
├── preload/
│   └── index.ts     # contextBridge layer
├── renderer/
│   └── src/
│       ├── App.tsx              # Three-panel layout, session management, global state
│       ├── components/
│       │   ├── SessionPanel.tsx # Left sidebar session list
│       │   ├── TerminalView.tsx # xterm.js terminal view
│       │   ├── DiffViewer.tsx   # Monaco Editor / Diff viewer
│       │   ├── RightPanel.tsx   # Right panel orchestrator
│       │   ├── GitTab.tsx       # Git version control tab
│       │   ├── AuxTab.tsx       # Aux terminal + CLAUDE.md commands
│       │   ├── FileTab.tsx      # File explorer + arch doc tree
│       │   ├── FileIcons.tsx    # Shared file icon utilities
│       │   ├── DocTree.tsx      # Shared CLAUDE.md parser + doc tree
│       │   └── SearchPanel.tsx  # File content search
│       └── themes/              # 11 theme color schemes
└── shared/
    └── types.ts     # IPC channel constants + shared type definitions
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Focus search panel |
| `Ctrl+S` | Save file edits |
| `Ctrl+Enter` | Commit Git changes |
| `Ctrl+↑` / `Ctrl+↓` | Switch terminal session |
| `Ctrl+←` / `Ctrl+→` | Switch right panel tab |
| `Ctrl+=` / `Ctrl+-` | Increase / decrease terminal font size |
| `Shift+Enter` | Insert newline in terminal (without sending) |
| `Right-click` | Terminal copy / paste |
| `Esc` | Close diff view / go back |

---

## Related Projects

- [electron-vite](https://github.com/alex8088/electron-vite)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)

---

## License

[MIT](LICENSE)
