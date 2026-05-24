export interface ThemeCSSVariables {
  'ide-bg': string
  'ide-sidebar': string
  'ide-panel': string
  'ide-border': string
  'ide-text': string
  'ide-text-muted': string
  'ide-accent': string
  'ide-accent-hover': string
  'ide-success': string
  'ide-danger': string
  'ide-warning': string
  'ide-hover': string
  'ide-active': string
  'scrollbar-track': string
  'scrollbar-thumb': string
  'scrollbar-thumb-hover': string
  'selection-bg': string
  'selection-opacity': string
  'focus-outline': string
  'monaco-margin-bg': string
}

export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  fontWeight?: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
  allowTransparency?: boolean
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface TitleBarTheme {
  color: string
  symbolColor: string
  backgroundColor: string
}

export interface IDETheme {
  id: string
  label: string
  css: ThemeCSSVariables
  terminal: TerminalTheme
  monacoTheme: string
  monacoRules?: Array<{ token: string; foreground: string; fontStyle?: string }>
  titleBar: TitleBarTheme
}
