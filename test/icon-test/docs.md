# Vibe IDE

A desktop IDE built with Electron, React, and TypeScript.

## Features

- **Terminal**: Native terminal powered by xterm.js
- **Git**: Version control with simple-git integration
- **Editor**: Monaco editor with diff support
- **Search**: Content search via ripgrep

## Getting Started

```bash
npm install
npm run dev
```

## Architecture

```
src/
├── main/       # Main process
├── preload/    # Context bridge
└── renderer/   # React UI
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev with hot reload |
| `npm run build` | Compile all layers |
| `npm run build:win` | Package win exe |
