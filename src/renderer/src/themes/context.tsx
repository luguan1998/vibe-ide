import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { IDETheme } from './types'
import { THEMES, DEFAULT_THEME_ID } from './definitions'
import { getMonaco } from '@renderer/utils/monacoSingleton'
import { syncTitleBarOverlay } from '@renderer/utils/titlebarSync'

interface ThemeContextValue {
  theme: IDETheme
  themes: IDETheme[]
  setTheme: (id: string) => void
  currentThemeId: string
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'vibe-ide-theme'

// 羽毛笔 cursor 路径（笔尖在左下 0,35.667）
const BRUSH_PATH = 'M0,35.667c0,0,11.596-37.07,35.738-35.55c0,0-2.994,4.849-10.551,6.416c0,0,3.518,0.429,6.369-0.522c0,0-1.711,5.515-11.025,6.273c0,0,5.133,1.331,7.414,0.57c0,0-0.619,4.111-10.102,6.154c-0.562,0.12-4.347,1.067-1.306,1.448c0,0,4.371,0.763,5.514,0.381c0,0-3.744,5.607-12.928,5.132c-0.903-0.047-1.332,0-1.332,0L0,35.667z'

function applyCSSVariables(theme: IDETheme): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.css)) {
    root.style.setProperty(`--${key}`, value)
  }
  // Brush cursor: generated per theme accent at runtime (CSS url() cannot read variables)
  const accent = theme.css['ide-accent']
  const rgb = accent.split(/\s+/).map(Number)
  if (rgb.length === 3 && rgb.every((n) => Number.isFinite(n))) {
    const hex = '#' + rgb.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')
    const fillEnc = hex.replace('#', '%23')
    const svg = `%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 35.738 35.738'%3E%3Cpath fill='${fillEnc}' d='${BRUSH_PATH}'/%3E%3C/svg%3E`
    root.style.setProperty('--brush-cursor', `url("data:image/svg+xml,${svg}") 1 23, crosshair`)
  }
}

function getInitialTheme(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && THEMES.some((t) => t.id === stored)) return stored
  } catch {}
  return DEFAULT_THEME_ID
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentThemeId, setCurrentThemeId] = useState(getInitialTheme)

  const currentTheme = THEMES.find((t) => t.id === currentThemeId) ?? THEMES[0]

  useEffect(() => {
    applyCSSVariables(currentTheme)
    syncTitleBarOverlay()
  }, [currentThemeId, currentTheme])

  // monaco 全局主题随 IDE 同步：colorize 的 token 颜色解析走全局 theme service，
  // options.theme 参数无法完全覆盖；不同步会导致主题切换后首个代码段颜色错。
  useEffect(() => {
    let cancelled = false
    getMonaco().then(monaco => {
      if (!cancelled) monaco.editor.setTheme(currentTheme.monacoTheme)
    })
    return () => { cancelled = true }
  }, [currentTheme.monacoTheme])

  const setTheme = useCallback((id: string) => {
    setCurrentThemeId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {}
  }, [])

  return (
    <ThemeContext.Provider value={{ theme: currentTheme, themes: THEMES, setTheme, currentThemeId }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
