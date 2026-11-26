import React from 'react'
import ReactDOM from 'react-dom/client'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import App from './App'
import { ThemeProvider, useTheme } from './themes'
import { I18nProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import { getMonaco } from './utils/monacoSingleton'
import './styles/base.css'
import './styles/globals.css'

// Workers for Monaco Editor (electron-vite handles ?worker imports)
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'

window.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      default:
        return new EditorWorker()
    }
  }
}

// 直接使用打包进 bundle 的 monaco 实例，不走 CDN / 动态脚本注入
loader.config({ monaco })

// 启动时注册主题+tokenizer，全局只跑一次
getMonaco()

// monaco 全局主题随 IDE 同步：colorize 的 token 颜色解析走全局 theme service，
// options.theme 参数无法完全覆盖；不同步会导致主题切换后首个代码段颜色错。
function MonacoThemeSync(): null {
  const { theme } = useTheme()
  React.useEffect(() => {
    getMonaco().then(monaco => monaco.editor.setTheme(theme.monacoTheme))
  }, [theme.monacoTheme])
  return null
}

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

  try {
    const root = document.documentElement
    const mdf = localStorage.getItem('vibe-ide-md-font')
    if (mdf) root.style.setProperty('--md-font-family', mdf)
    const mds = localStorage.getItem('vibe-ide-md-font-size')
    if (mds) root.style.setProperty('--md-font-size', mds + 'px')
  } catch {}

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ThemeProvider>
          <I18nProvider>
            <MonacoThemeSync />
            <App />
          </I18nProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}

bootstrap()