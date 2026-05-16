# Vibe IDE

**English** | [中文](README.zh-CN.md)

> A vibe coding desktop IDE with native terminal, Git management, code editing, and file search — built to keep your flow state uninterrupted.

---

## Features

- **Native Terminal** — Powered by xterm.js + node-pty with PowerShell/pwsh support, multi-session management, and clickable file paths in terminal output
- **Git Integration** — Visual staging/unstaging, commits, branch switching, stash operations, commit history viewer, and auto-refresh on file changes
- **Code Editor & Diff** — Monaco Editor with file editing and Git diff comparison, syntax highlighting for 30+ languages
- **Full-Text Search** — High-speed content search via ripgrep with regex, case-sensitive, and file type filters
- **Multi-Session Management** — Create, clone, rename, and close terminal sessions with 500-command history per session
- **Dark Theme** — Purple-toned dark theme with 11 color schemes to switch between
- **Electron Desktop App** — Native window experience with draggable title bar and resizable three-panel layout

---

## Screenshots

| Terminal | Git Management | Diff View |
|----------|---------------|-----------|
| ![Terminal](build/term.png) | ![Git](build/git.png) | ![Diff](build/diff.png) |

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
│       │   ├── GitPanel.tsx     # Right panel with Git/Aux/Search/File tabs
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

---

## Related Projects

- [electron-vite](https://github.com/alex8088/electron-vite)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)

---

## License

[MIT](LICENSE)
