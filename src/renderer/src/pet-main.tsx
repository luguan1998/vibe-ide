import React from 'react'
import ReactDOM from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import { ThemeProvider } from './themes'
import { I18nProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import { PetWindowRoot } from './components/DesktopPet/PetWindowRoot'
import { setMonacoPreInit } from './utils/monacoSingleton'
import './styles/globals.css'

// AI 回复里的代码块要用 monaco colorize：首次出现时动态加载，避免宠物窗口预载 6MB。
// 只 colorize 不建 model，语言服务 worker（ts/json/css/html）用不到，不打包。
setMonacoPreInit(async () => {
  const monaco = await import('monaco-editor')
  const EditorWorker = await import('monaco-editor/esm/vs/editor/editor.worker?worker')
  ;(window as any).MonacoEnvironment = {
    getWorker(): Worker { return new EditorWorker.default() }
  }
  loader.config({ monaco })
})

async function bootstrap() {
  try {
    const { css } = await window.api.snippets.load()
    if (css) {
      const style = document.createElement('style')
      style.id = 'custom-css'
      style.textContent = css
      document.head.appendChild(style)
    }
  } catch { /* 加载失败不阻断启动 */ }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ThemeProvider variant="pet">
          <I18nProvider>
            <PetWindowRoot />
          </I18nProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}

bootstrap()
