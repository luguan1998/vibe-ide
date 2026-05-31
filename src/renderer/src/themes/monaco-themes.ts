import { THEMES } from './definitions'

function rgbToHex(rgb: string): string {
  const parts = rgb.includes(',') ? rgb.split(',').map(s => s.trim()) : rgb.split(' ')
  const [r, g, b] = parts.map((s) => parseInt(s, 10))
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function registerMonacoThemes(monaco: any): void {
  for (const theme of THEMES) {
    const css = theme.css
    const bg = rgbToHex(css['ide-bg'])
    const fg = rgbToHex(css['ide-text'])
    const accent = rgbToHex(css['ide-accent'])
    const muted = rgbToHex(css['ide-text-muted'])
    const border = rgbToHex(css['ide-border'])
    const hover = rgbToHex(css['ide-hover'])
    const sidebar = rgbToHex(css['ide-sidebar'])
    const success = rgbToHex(css['ide-success'])
    const danger = rgbToHex(css['ide-danger'])
    const warning = rgbToHex(css['ide-warning'])
    const accentHover = rgbToHex(css['ide-accent-hover'])
    const panel = rgbToHex(css['ide-panel'])
    const scrollThumb = rgbToHex(css['scrollbar-thumb'])
    const scrollThumbHover = rgbToHex(css['scrollbar-thumb-hover'])
    const isLight = theme.id === 'github-light' || theme.id === 'solarized-light' || theme.id === 'miku-light'

    monaco.editor.defineTheme(theme.monacoTheme, {
      base: isLight ? 'vs' : 'vs-dark',
      inherit: true,
      rules: theme.monacoRules ?? [
        { token: 'comment', foreground: muted, fontStyle: 'italic' },
        { token: 'keyword', foreground: accent },
        { token: 'string', foreground: success },
        { token: 'number', foreground: warning },
        { token: 'type', foreground: accentHover },
        { token: 'function', foreground: accent },
        { token: 'variable', foreground: fg },
        { token: 'constant', foreground: accentHover },
        { token: 'regexp', foreground: danger }
      ],
      colors: {
        'editor.background': bg,
        'editor.foreground': fg,
        'editor.lineHighlightBackground': hover,
        'editor.selectionBackground': accent + '33',
        'editorCursor.foreground': accent,
        'editorLineNumber.foreground': muted,
        'editorLineNumber.activeForeground': fg,
        'editorWidget.background': panel,
        'editorWidget.border': border,
        'editorBracketMatch.background': accent + '30',
        'editorBracketMatch.border': accent + '80',
        'editorGutter.background': bg,
        'editorRuler.foreground': border,
        'editorOverviewRuler.border': border,
        'scrollbar.background': 'transparent',
        'scrollbarSlider.background': scrollThumb + '59',
        'scrollbarSlider.hoverBackground': scrollThumbHover + '8C',
        'scrollbarSlider.activeBackground': scrollThumbHover + 'BF',
        'editorOverviewRuler.background': bg,
        'editorStickyScroll.background': sidebar,
        'minimap.background': bg,
        'input.background': hover,
        'input.border': border,
        'input.foreground': fg,
        'dropdown.background': sidebar,
        'dropdown.border': border,
        'dropdown.foreground': fg,
        'list.activeSelectionBackground': accent + '40',
        'list.hoverBackground': hover,
        'list.inactiveSelectionBackground': accent + '20',
        'diffEditor.insertedTextBackground': success + '20',
        'diffEditor.removedTextBackground': danger + '20',
        'diffEditor.insertedLineBackground': success + '15',
        'diffEditor.removedLineBackground': danger + '15',
        'sash.hoverBorder': 'transparent',
        'focusBorder': bg
      }
    })
  }
}
