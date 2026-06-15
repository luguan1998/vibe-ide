import { IDETheme } from './types'

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r} ${g} ${b}`
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function t(hex: string): string { return hexToRgb(hex) }

const vibeDark: IDETheme = {
  id: 'vibe-dark',
  label: 'Vibe Dark',
  css: {
    'ide-bg': t('#1a1a2e'),
    'ide-sidebar': t('#16213e'),
    'ide-panel': t('#0f3460'),
    'ide-border': t('#2a2a4a'),
    'ide-text': t('#e0e0e0'),
    'ide-text-muted': t('#8888aa'),
    'ide-accent': t('#7c3aed'),
    'ide-accent-hover': t('#6d28d9'),
    'ide-success': t('#10b981'),
    'ide-danger': t('#ef4444'),
    'ide-warning': t('#f59e0b'),
    'ide-hover': t('#2a2a48'),
    'ide-active': t('#363656'),
    'scrollbar-track': t('#1a1a2e'),
    'scrollbar-thumb': t('#3a3a5a'),
    'scrollbar-thumb-hover': t('#5a5a7a'),
    'selection-bg': t('#7c3aed'),
    'selection-opacity': '0.3',
    'focus-outline': t('#7c3aed'),
    'monaco-margin-bg': t('#1a1a2e')
  },
  terminal: {
    background: '#1a1a2e',
    foreground: '#e0e0e0',
    cursor: '#7c3aed',
    cursorAccent: '#1a1a2e',
    selectionBackground: 'rgba(124, 58, 237, 0.3)',
    black: '#000000', red: '#e74c3c', green: '#10b981', yellow: '#f59e0b',
    blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: '#e0e0e0',
    brightBlack: '#555555', brightRed: '#ff6b6b', brightGreen: '#34d399',
    brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c084fc',
    brightCyan: '#22d3ee', brightWhite: '#ffffff'
  },
  monacoTheme: 'vibe-ide-default',
  monacoRules: [
    { token: 'comment', foreground: '#8888aa', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#a855f7' },
    { token: 'string', foreground: '#10b981' },
    { token: 'number', foreground: '#f59e0b' },
    { token: 'type', foreground: '#6d28d9' },
    { token: 'function', foreground: '#7c3aed' },
    { token: 'variable', foreground: '#e0e0e0' },
    { token: 'constant', foreground: '#3b82f6' },
    { token: 'regexp', foreground: '#ef4444' }
  ],
  titleBar: { color: '#1a1a2e', symbolColor: '#8888aa', backgroundColor: '#1a1a2e' }
}

const oneDark: IDETheme = {
  id: 'one-dark',
  label: 'One Dark',
  css: {
    'ide-bg': t('#282c34'),
    'ide-sidebar': t('#21252b'),
    'ide-panel': t('#2c313a'),
    'ide-border': t('#3a3f4b'),
    'ide-text': t('#abb2bf'),
    'ide-text-muted': t('#5c6370'),
    'ide-accent': t('#61afef'),
    'ide-accent-hover': t('#528bff'),
    'ide-success': t('#98c379'),
    'ide-danger': t('#e06c75'),
    'ide-warning': t('#d19a66'),
    'ide-hover': t('#353d47'),
    'ide-active': t('#3d4550'),
    'scrollbar-track': t('#282c34'),
    'scrollbar-thumb': t('#4b5263'),
    'scrollbar-thumb-hover': t('#5c6370'),
    'selection-bg': t('#61afef'),
    'selection-opacity': '0.3',
    'focus-outline': t('#61afef'),
    'monaco-margin-bg': t('#282c34')
  },
  terminal: {
    background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', cursorAccent: '#282c34',
    selectionBackground: hexToRgba('#61afef', 0.3),
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
    brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
    brightCyan: '#56b6c2', brightWhite: '#ffffff'
  },
  monacoTheme: 'vibe-ide-one-dark',
  monacoRules: [
    { token: 'comment', foreground: '#5c6370', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#c678dd' },
    { token: 'string', foreground: '#98c379' },
    { token: 'number', foreground: '#d19a66' },
    { token: 'type', foreground: '#e5c07b' },
    { token: 'function', foreground: '#61afef' },
    { token: 'variable', foreground: '#e06c75' },
    { token: 'constant', foreground: '#56b6c2' },
    { token: 'regexp', foreground: '#56b6c2' }
  ],
  titleBar: { color: '#21252b', symbolColor: '#5c6370', backgroundColor: '#21252b' }
}

const dracula: IDETheme = {
  id: 'dracula',
  label: 'Dracula',
  css: {
    'ide-bg': t('#282a36'),
    'ide-sidebar': t('#21222c'),
    'ide-panel': t('#343746'),
    'ide-border': t('#44475a'),
    'ide-text': t('#f8f8f2'),
    'ide-text-muted': t('#6272a4'),
    'ide-accent': t('#bd93f9'),
    'ide-accent-hover': t('#caa9fa'),
    'ide-success': t('#50fa7b'),
    'ide-danger': t('#ff5555'),
    'ide-warning': t('#f1fa8c'),
    'ide-hover': t('#343746'),
    'ide-active': t('#44475a'),
    'scrollbar-track': t('#282a36'),
    'scrollbar-thumb': t('#44475a'),
    'scrollbar-thumb-hover': t('#6272a4'),
    'selection-bg': t('#bd93f9'),
    'selection-opacity': '0.3',
    'focus-outline': t('#bd93f9'),
    'monaco-margin-bg': t('#282a36')
  },
  terminal: {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#bd93f9', cursorAccent: '#282a36',
    selectionBackground: hexToRgba('#bd93f9', 0.3),
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff'
  },
  monacoTheme: 'vibe-ide-dracula',
  monacoRules: [
    { token: 'comment', foreground: '#6272a4', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#ff79c6' },
    { token: 'string', foreground: '#f1fa8c' },
    { token: 'number', foreground: '#bd93f9' },
    { token: 'type', foreground: '#8be9fd' },
    { token: 'function', foreground: '#50fa7b' },
    { token: 'variable', foreground: '#f8f8f2' },
    { token: 'constant', foreground: '#bd93f9' },
    { token: 'regexp', foreground: '#ff5555' }
  ],
  titleBar: { color: '#21222c', symbolColor: '#6272a4', backgroundColor: '#21222c' }
}

const nord: IDETheme = {
  id: 'nord',
  label: 'Nord',
  css: {
    'ide-bg': t('#2e3440'),
    'ide-sidebar': t('#3b4252'),
    'ide-panel': t('#434c5e'),
    'ide-border': t('#4c566a'),
    'ide-text': t('#d8dee9'),
    'ide-text-muted': t('#9aa5b4'),
    'ide-accent': t('#88c0d0'),
    'ide-accent-hover': t('#81a1c1'),
    'ide-success': t('#a3be8c'),
    'ide-danger': t('#bf616a'),
    'ide-warning': t('#ebcb8b'),
    'ide-hover': t('#434c5e'),
    'ide-active': t('#4c566a'),
    'scrollbar-track': t('#2e3440'),
    'scrollbar-thumb': t('#4c566a'),
    'scrollbar-thumb-hover': t('#616e88'),
    'selection-bg': t('#88c0d0'),
    'selection-opacity': '0.3',
    'focus-outline': t('#88c0d0'),
    'monaco-margin-bg': t('#2e3440')
  },
  terminal: {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#88c0d0', cursorAccent: '#2e3440',
    selectionBackground: hexToRgba('#88c0d0', 0.3),
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb', brightWhite: '#eceff4'
  },
  monacoTheme: 'vibe-ide-nord',
  monacoRules: [
    { token: 'comment', foreground: '#616e88', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#81a1c1' },
    { token: 'string', foreground: '#a3be8c' },
    { token: 'number', foreground: '#b48ead' },
    { token: 'type', foreground: '#8fbcbb' },
    { token: 'function', foreground: '#88c0d0' },
    { token: 'variable', foreground: '#d8dee9' },
    { token: 'constant', foreground: '#b48ead' },
    { token: 'regexp', foreground: '#ebcb8b' }
  ],
  titleBar: { color: '#3b4252', symbolColor: '#9aa5b4', backgroundColor: '#3b4252' }
}

const solarizedDark: IDETheme = {
  id: 'solarized-dark',
  label: 'Solarized Dark',
  css: {
    'ide-bg': t('#002b36'),
    'ide-sidebar': t('#073642'),
    'ide-panel': t('#073642'),
    'ide-border': t('#586e75'),
    'ide-text': t('#93a4b3'),
    'ide-text-muted': t('#657b83'),
    'ide-accent': t('#268bd2'),
    'ide-accent-hover': t('#2aa198'),
    'ide-success': t('#859900'),
    'ide-danger': t('#dc322f'),
    'ide-warning': t('#b58900'),
    'ide-hover': t('#0f4b5a'),
    'ide-active': t('#155f6e'),
    'scrollbar-track': t('#002b36'),
    'scrollbar-thumb': t('#586e75'),
    'scrollbar-thumb-hover': t('#93a4b3'),
    'selection-bg': t('#268bd2'),
    'selection-opacity': '0.3',
    'focus-outline': t('#268bd2'),
    'monaco-margin-bg': t('#002b36')
  },
  terminal: {
    background: '#002b36', foreground: '#93a4b3', cursor: '#268bd2', cursorAccent: '#002b36',
    selectionBackground: hexToRgba('#268bd2', 0.3),
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#6c71c4', cyan: '#2aa198', white: '#93a1a1',
    brightBlack: '#586e75', brightRed: '#dc322f', brightGreen: '#859900',
    brightYellow: '#b58900', brightBlue: '#268bd2', brightMagenta: '#6c71c4',
    brightCyan: '#2aa198', brightWhite: '#fdf6e3'
  },
  monacoTheme: 'vibe-ide-solarized-dark',
  monacoRules: [
    { token: 'comment', foreground: '#586e75', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#859900' },
    { token: 'string', foreground: '#2aa198' },
    { token: 'number', foreground: '#d33682' },
    { token: 'type', foreground: '#b58900' },
    { token: 'function', foreground: '#268bd2' },
    { token: 'variable', foreground: '#93a4b3' },
    { token: 'constant', foreground: '#6c71c4' },
    { token: 'regexp', foreground: '#dc322f' }
  ],
  titleBar: { color: '#073642', symbolColor: '#657b83', backgroundColor: '#073642' }
}

const solarizedLight: IDETheme = {
  id: 'solarized-light',
  label: 'Solarized Light',
  css: {
    'ide-bg': t('#fdf6e3'),
    'ide-sidebar': t('#eee8d5'),
    'ide-panel': t('#f5eedb'),
    'ide-border': t('#d3cbb7'),
    'ide-text': t('#657b83'),
    'ide-text-muted': t('#93a1a1'),
    'ide-accent': t('#268bd2'),
    'ide-accent-hover': t('#2aa198'),
    'ide-success': t('#859900'),
    'ide-danger': t('#dc322f'),
    'ide-warning': t('#b58900'),
    'ide-hover': t('#e6ddbe'),
    'ide-active': t('#dbd0ae'),
    'scrollbar-track': t('#fdf6e3'),
    'scrollbar-thumb': t('#d3cbb7'),
    'scrollbar-thumb-hover': t('#93a1a1'),
    'selection-bg': t('#268bd2'),
    'selection-opacity': '0.25',
    'focus-outline': t('#268bd2'),
    'monaco-margin-bg': t('#fdf6e3')
  },
  terminal: {
    background: '#fdf6e3', foreground: '#657b83', cursor: '#268bd2', cursorAccent: '#fdf6e3',
    selectionBackground: hexToRgba('#268bd2', 0.25),
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#6c71c4', cyan: '#2aa198', white: '#93a1a1',
    brightBlack: '#586e75', brightRed: '#dc322f', brightGreen: '#859900',
    brightYellow: '#b58900', brightBlue: '#268bd2', brightMagenta: '#6c71c4',
    brightCyan: '#2aa198', brightWhite: '#fdf6e3',
    fontWeight: '500',
    allowTransparency: false
  },
  monacoTheme: 'vibe-ide-solarized-light',
  titleBar: { color: '#eee8d5', symbolColor: '#93a1a1', backgroundColor: '#eee8d5' }
}

const monokai: IDETheme = {
  id: 'monokai',
  label: 'Monokai',
  css: {
    'ide-bg': t('#272822'),
    'ide-sidebar': t('#1e1f1c'),
    'ide-panel': t('#1a1b18'),
    'ide-border': t('#3e3d32'),
    'ide-text': t('#f8f8f2'),
    'ide-text-muted': t('#75715e'),
    'ide-accent': t('#f92672'),
    'ide-accent-hover': t('#d91e62'),
    'ide-success': t('#a6e22e'),
    'ide-danger': t('#f92672'),
    'ide-warning': t('#e6db74'),
    'ide-hover': t('#3e3d32'),
    'ide-active': t('#49483e'),
    'scrollbar-track': t('#272822'),
    'scrollbar-thumb': t('#49483e'),
    'scrollbar-thumb-hover': t('#75715e'),
    'selection-bg': t('#f92672'),
    'selection-opacity': '0.3',
    'focus-outline': t('#f92672'),
    'monaco-margin-bg': t('#272822')
  },
  terminal: {
    background: '#272822', foreground: '#f8f8f2', cursor: '#f92672', cursorAccent: '#272822',
    selectionBackground: hexToRgba('#f92672', 0.3),
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#e6db74',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e',
    brightYellow: '#e6db74', brightBlue: '#66d9ef', brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4', brightWhite: '#ffffff'
  },
  monacoTheme: 'vibe-ide-monokai',
  monacoRules: [
    { token: 'comment', foreground: '#75715e', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#f92672' },
    { token: 'string', foreground: '#e6db74' },
    { token: 'number', foreground: '#ae81ff' },
    { token: 'type', foreground: '#66d9ef' },
    { token: 'function', foreground: '#a6e22e' },
    { token: 'variable', foreground: '#f8f8f2' },
    { token: 'constant', foreground: '#ae81ff' },
    { token: 'regexp', foreground: '#e6db74' }
  ],
  titleBar: { color: '#1e1f1c', symbolColor: '#75715e', backgroundColor: '#1e1f1c' }
}

const monokaiPro: IDETheme = {
  id: 'monokai-pro',
  label: 'Monokai Pro',
  css: {
    'ide-bg': t('#272822'),
    'ide-sidebar': t('#1e1f1c'),
    'ide-panel': t('#2d2e27'),
    'ide-border': t('#3e3d32'),
    'ide-text': t('#f8f8f2'),
    'ide-text-muted': t('#75715e'),
    'ide-accent': t('#a6e22e'),
    'ide-accent-hover': t('#b6f442'),
    'ide-success': t('#a6e22e'),
    'ide-danger': t('#f92672'),
    'ide-warning': t('#e6db74'),
    'ide-hover': t('#3e3d32'),
    'ide-active': t('#49483e'),
    'scrollbar-track': t('#272822'),
    'scrollbar-thumb': t('#49483e'),
    'scrollbar-thumb-hover': t('#75715e'),
    'selection-bg': t('#a6e22e'),
    'selection-opacity': '0.3',
    'focus-outline': t('#a6e22e'),
    'monaco-margin-bg': t('#272822')
  },
  terminal: {
    background: '#272822', foreground: '#f8f8f2', cursor: '#a6e22e', cursorAccent: '#272822',
    selectionBackground: hexToRgba('#a6e22e', 0.3),
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#e6db74',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e',
    brightYellow: '#e6db74', brightBlue: '#66d9ef', brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4', brightWhite: '#ffffff'
  },
  monacoTheme: 'vibe-ide-monokai-pro',
  monacoRules: [
    { token: 'comment', foreground: '#75715e', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#a6e22e' },
    { token: 'string', foreground: '#e6db74' },
    { token: 'number', foreground: '#ae81ff' },
    { token: 'type', foreground: '#66d9ef' },
    { token: 'function', foreground: '#a6e22e' },
    { token: 'variable', foreground: '#f8f8f2' },
    { token: 'constant', foreground: '#ae81ff' },
    { token: 'regexp', foreground: '#e6db74' }
  ],
  titleBar: { color: '#1e1f1c', symbolColor: '#75715e', backgroundColor: '#1e1f1c' }
}

const vscodeDark: IDETheme = {
  id: 'vscode-dark',
  label: 'VS Code Dark',
  css: {
    'ide-bg': t('#1e1e1e'),
    'ide-sidebar': t('#252526'),
    'ide-panel': t('#2d2d2d'),
    'ide-border': t('#3c3c3c'),
    'ide-text': t('#d4d4d4'),
    'ide-text-muted': t('#858585'),
    'ide-accent': t('#007acc'),
    'ide-accent-hover': t('#1a8ad4'),
    'ide-success': t('#4ec9b0'),
    'ide-danger': t('#f44747'),
    'ide-warning': t('#cca700'),
    'ide-hover': t('#2a2d2e'),
    'ide-active': t('#37373d'),
    'scrollbar-track': t('#1e1e1e'),
    'scrollbar-thumb': t('#424242'),
    'scrollbar-thumb-hover': t('#555555'),
    'selection-bg': t('#007acc'),
    'selection-opacity': '0.3',
    'focus-outline': t('#007acc'),
    'monaco-margin-bg': t('#1e1e1e')
  },
  terminal: {
    background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#007acc', cursorAccent: '#1e1e1e',
    selectionBackground: hexToRgba('#007acc', 0.3),
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
    brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
    brightCyan: '#29b8db', brightWhite: '#ffffff'
  },
  monacoTheme: 'vibe-ide-vscode-dark',
  monacoRules: [
    { token: 'comment', foreground: '#6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#569cd6' },
    { token: 'string', foreground: '#ce9178' },
    { token: 'number', foreground: '#b5cea8' },
    { token: 'type', foreground: '#4ec9b0' },
    { token: 'function', foreground: '#dcdcaa' },
    { token: 'variable', foreground: '#9cdcfe' },
    { token: 'constant', foreground: '#4fc1ff' },
    { token: 'regexp', foreground: '#d16969' }
  ],
  titleBar: { color: '#252526', symbolColor: '#858585', backgroundColor: '#252526' }
}

const githubLight: IDETheme = {
  id: 'github-light',
  label: 'GitHub Light',
  css: {
    'ide-bg': t('#ffffff'),
    'ide-sidebar': t('#f6f8fa'),
    'ide-panel': t('#f6f8fa'),
    'ide-border': t('#d0d7de'),
    'ide-text': t('#1f2328'),
    'ide-text-muted': t('#656d76'),
    'ide-accent': t('#0969da'),
    'ide-accent-hover': t('#0550ae'),
    'ide-success': t('#1a7f37'),
    'ide-danger': t('#cf222e'),
    'ide-warning': t('#9a6700'),
    'ide-hover': t('#eaecf0'),
    'ide-active': t('#dfe2e7'),
    'scrollbar-track': t('#ffffff'),
    'scrollbar-thumb': t('#c0c8d0'),
    'scrollbar-thumb-hover': t('#8b949e'),
    'selection-bg': t('#0969da'),
    'selection-opacity': '0.2',
    'focus-outline': t('#0969da'),
    'monaco-margin-bg': t('#ffffff')
  },
  terminal: {
    background: '#ffffff', foreground: '#1f2328', cursor: '#0969da', cursorAccent: '#ffffff',
    selectionBackground: hexToRgba('#0969da', 0.2),
    black: '#24292f', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700',
    blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37',
    brightYellow: '#9a6700', brightBlue: '#0969da', brightMagenta: '#8250df',
    brightCyan: '#1b7c83', brightWhite: '#1f2328',
    fontWeight: '500',
    allowTransparency: false
  },
  monacoTheme: 'vibe-ide-github-light',
  titleBar: { color: '#f6f8fa', symbolColor: '#656d76', backgroundColor: '#f6f8fa' }
}

const tokyoNight: IDETheme = {
  id: 'tokyo-night',
  label: 'Tokyo Night',
  css: {
    'ide-bg': t('#1a1b26'),
    'ide-sidebar': t('#16161e'),
    'ide-panel': t('#1f2335'),
    'ide-border': t('#3b4261'),
    'ide-text': t('#c0caf5'),
    'ide-text-muted': t('#565f89'),
    'ide-accent': t('#7aa2f7'),
    'ide-accent-hover': t('#89b4fa'),
    'ide-success': t('#9ece6a'),
    'ide-danger': t('#f7768e'),
    'ide-warning': t('#e0af68'),
    'ide-hover': t('#292e42'),
    'ide-active': t('#3b4261'),
    'scrollbar-track': t('#1a1b26'),
    'scrollbar-thumb': t('#3b4261'),
    'scrollbar-thumb-hover': t('#565f89'),
    'selection-bg': t('#7aa2f7'),
    'selection-opacity': '0.3',
    'focus-outline': t('#7aa2f7'),
    'monaco-margin-bg': t('#1a1b26')
  },
  terminal: {
    background: '#1a1b26', foreground: '#c0caf5', cursor: '#7aa2f7', cursorAccent: '#1a1b26',
    selectionBackground: hexToRgba('#7aa2f7', 0.3),
    black: '#1a1b26', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
    brightBlack: '#565f89', brightRed: '#f7768e', brightGreen: '#9ece6a',
    brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff', brightWhite: '#ffffff'
  },
  monacoTheme: 'vibe-ide-tokyo-night',
  monacoRules: [
    { token: 'comment', foreground: '#565f89', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#bb9af7' },
    { token: 'string', foreground: '#9ece6a' },
    { token: 'number', foreground: '#ff9e64' },
    { token: 'type', foreground: '#2ac3de' },
    { token: 'function', foreground: '#7aa2f7' },
    { token: 'variable', foreground: '#c0caf5' },
    { token: 'constant', foreground: '#ff9e64' },
    { token: 'regexp', foreground: '#f7768e' }
  ],
  titleBar: { color: '#16161e', symbolColor: '#565f89', backgroundColor: '#16161e' }
}

// 🎵 Hatsune Miku — 初音未来印象色主题
// 官方苍绿 #39C5BB 为核心，樱粉点缀，深黛底色如舞台夜幕
const miku: IDETheme = {
  id: 'miku',
  label: 'Hatsune Miku',
  css: {
    'ide-bg': t('#1b413f'),
    'ide-sidebar': t('#153533'),
    'ide-panel': t('#224f4c'),
    'ide-border': t('#2d5a57'),
    'ide-text': t('#d4eaea'),
    'ide-text-muted': t('#5c7a7a'),
    'ide-accent': t('#39C5BB'),
    'ide-accent-hover': t('#5ddbd2'),
    'ide-success': t('#39C5BB'),
    'ide-danger': t('#ff6b8a'),
    'ide-warning': t('#f0c060'),
    'ide-hover': t('#224f4c'),
    'ide-active': t('#2d5a57'),
    'scrollbar-track': t('#1b413f'),
    'scrollbar-thumb': t('#2d5a57'),
    'scrollbar-thumb-hover': t('#5c7a7a'),
    'selection-bg': t('#39C5BB'),
    'selection-opacity': '0.3',
    'focus-outline': t('#39C5BB'),
    'monaco-margin-bg': t('#1b413f')
  },
  terminal: {
    background: '#1b413f',
    foreground: '#e8f4f4',
    cursor: '#39C5BB',
    cursorAccent: '#1b413f',
    selectionBackground: hexToRgba('#39C5BB', 0.3),
    black: '#1a3030',
    red: '#ff7b9b',
    green: '#4ddbc8',
    yellow: '#f5cc6e',
    blue: '#6db8f0',
    magenta: '#d090ff',
    cyan: '#6de0d8',
    white: '#e0f0f0',
    brightBlack: '#6e8a8a',
    brightRed: '#ffa8c0',
    brightGreen: '#6de8da',
    brightYellow: '#f8e090',
    brightBlue: '#90d0ff',
    brightMagenta: '#e0b8ff',
    brightCyan: '#9af0e8',
    brightWhite: '#ffffff'
  },
  monacoTheme: 'vibe-ide-miku',
  monacoRules: [
    { token: 'comment', foreground: '#6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#569cd6' },
    { token: 'string', foreground: '#c586c0' },
    { token: 'number', foreground: '#b5cea8' },
    { token: 'type', foreground: '#4ec9b0' },
    { token: 'function', foreground: '#dcdcaa' },
    { token: 'variable', foreground: '#9cdcfe' },
    { token: 'constant', foreground: '#4fc1ff' },
    { token: 'regexp', foreground: '#d16969' }
  ],
  titleBar: { color: '#153533', symbolColor: '#5c7a7a', backgroundColor: '#153533' }
}

// 🎵 Hatsune Miku Light — 初音未来亮色主题
// 白底绿字亮紫点缀，清新明亮如晨光下的初音
const mikuLight: IDETheme = {
  id: 'miku-light',
  label: 'Hatsune Light',
  css: {
    'ide-bg': t('#f9fdfc'),
    'ide-sidebar': t('#eef7f5'),
    'ide-panel': t('#f2faf8'),
    'ide-border': t('#d0e4e0'),
    'ide-text': t('#1a2a27'),
    'ide-text-muted': t('#7a9a95'),
    'ide-accent': t('#39C5BB'),
    'ide-accent-hover': t('#2db5ab'),
    'ide-success': t('#39C5BB'),
    'ide-danger': t('#e05575'),
    'ide-warning': t('#c88830'),
    'ide-hover': t('#ddece7'),
    'ide-active': t('#cce5dc'),
    'scrollbar-track': t('#f9fdfc'),
    'scrollbar-thumb': t('#c8ddd9'),
    'scrollbar-thumb-hover': t('#a0bab5'),
    'selection-bg': t('#bfa0f0'),
    'selection-opacity': '0.25',
    'focus-outline': t('#39C5BB'),
    'monaco-margin-bg': t('#f9fdfc')
  },
  terminal: {
    background: '#f9fdfc',
    foreground: '#1a2a27',
    cursor: '#39C5BB',
    cursorAccent: '#f9fdfc',
    selectionBackground: hexToRgba('#bfa0f0', 0.25),
    black: '#d0e4e0',
    red: '#e05575',
    green: '#39C5BB',
    yellow: '#c88830',
    blue: '#5b9bd5',
    magenta: '#b080e0',
    cyan: '#39C5BB',
    white: '#1a2a27',
    brightBlack: '#a0bab5',
    brightRed: '#f07090',
    brightGreen: '#5ddbd2',
    brightYellow: '#e0a040',
    brightBlue: '#80b8f0',
    brightMagenta: '#c8a8f0',
    brightCyan: '#6de0d8',
    brightWhite: '#0a1a17',
    fontWeight: '500',
    allowTransparency: false
  },
  monacoTheme: 'vibe-ide-miku-light',
  monacoRules: [
    { token: 'comment', foreground: '#7a9a95', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#7c3aed' },
    { token: 'string', foreground: '#059669' },
    { token: 'number', foreground: '#ca8a04' },
    { token: 'type', foreground: '#0d9488' },
    { token: 'function', foreground: '#2563eb' },
    { token: 'variable', foreground: '#1a2a27' },
    { token: 'constant', foreground: '#ea580c' },
    { token: 'regexp', foreground: '#e11d48' }
  ],
  titleBar: { color: '#eef7f5', symbolColor: '#7a9a95', backgroundColor: '#eef7f5' }
}

const catppuccin: IDETheme = {
  id: 'catppuccin-mocha',
  label: 'Catppuccin',
  css: {
    'ide-bg': t('#1e1e2e'),
    'ide-sidebar': t('#181825'),
    'ide-panel': t('#313244'),
    'ide-border': t('#45475a'),
    'ide-text': t('#cdd6f4'),
    'ide-text-muted': t('#6c7086'),
    'ide-accent': t('#cba6f7'),
    'ide-accent-hover': t('#d4b8fa'),
    'ide-success': t('#a6e3a1'),
    'ide-danger': t('#f38ba8'),
    'ide-warning': t('#f9e2af'),
    'ide-hover': t('#313244'),
    'ide-active': t('#45475a'),
    'scrollbar-track': t('#1e1e2e'),
    'scrollbar-thumb': t('#45475a'),
    'scrollbar-thumb-hover': t('#6c7086'),
    'selection-bg': t('#cba6f7'),
    'selection-opacity': '0.3',
    'focus-outline': t('#cba6f7'),
    'monaco-margin-bg': t('#1e1e2e')
  },
  terminal: {
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#cba6f7', cursorAccent: '#1e1e2e',
    selectionBackground: hexToRgba('#cba6f7', 0.3),
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#cba6f7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
    brightCyan: '#94e2d5', brightWhite: '#a6adc8'
  },
  monacoTheme: 'vibe-ide-catppuccin',
  monacoRules: [
    { token: 'comment', foreground: '#6c7086', fontStyle: 'italic' },
    { token: 'keyword', foreground: '#cba6f7' },
    { token: 'string', foreground: '#a6e3a1' },
    { token: 'number', foreground: '#fab387' },
    { token: 'type', foreground: '#89b4fa' },
    { token: 'function', foreground: '#89b4fa' },
    { token: 'variable', foreground: '#cdd6f4' },
    { token: 'constant', foreground: '#fab387' },
    { token: 'regexp', foreground: '#f38ba8' }
  ],
  titleBar: { color: '#181825', symbolColor: '#6c7086', backgroundColor: '#181825' }
}

export const THEMES: IDETheme[] = [
  vscodeDark,
  vibeDark,
  oneDark,
  dracula,
  nord,
  solarizedDark,
  solarizedLight,
  monokai,
  monokaiPro,
  githubLight,
  tokyoNight,
  catppuccin,
  miku,
  mikuLight
]

export const DEFAULT_THEME_ID = 'vscode-dark'
