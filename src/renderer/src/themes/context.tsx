import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { IDETheme } from './types'
import { THEMES, DEFAULT_THEME_ID } from './definitions'

interface ThemeContextValue {
  theme: IDETheme
  themes: IDETheme[]
  setTheme: (id: string) => void
  currentThemeId: string
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'vibe-ide-theme'

function applyCSSVariables(theme: IDETheme): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.css)) {
    root.style.setProperty(`--${key}`, value)
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
  }, [currentThemeId, currentTheme])

  useEffect(() => {
    try {
      if (window.api?.theme) {
        window.api.theme.setTitleBar(currentTheme.titleBar)
      }
    } catch {}
  }, [currentTheme])

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
