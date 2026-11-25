import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './themes'
import { I18nProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import { PetWindowRoot } from './components/DesktopPet/PetWindowRoot'
import { applyMdFont, applySnippetsCss, applyUiFont } from './petWindowCss'
import './styles/globals.css'

async function bootstrap() {
  // 先挂监听再读值：避免"读完值 → 挂监听"之间漏掉一次 storage 写入
  window.addEventListener('storage', (e) => {
    if (e.key === 'vibe-ide-md-font' || e.key === 'vibe-ide-md-font-size') applyMdFont()
    else if (e.key === 'vibe-ide-font-family') applyUiFont()
  })
  applyMdFont()
  applyUiFont()
  await applySnippetsCss()

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
