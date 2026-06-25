import React from 'react'
import ReactDOM from 'react-dom/client'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import App from './App'
import { ThemeProvider } from './themes'
import { I18nProvider } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'
import { getMonaco } from './utils/monacoSingleton'
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

async function bootstrap() {
  try {
    const css = await window.api.userCss.load()
    if (css) {
      const style = document.createElement('style')
      style.id = 'user-css'
      style.textContent = css
      document.head.appendChild(style)  // 末尾注入，覆盖 globals.css
    }
  } catch { /* 加载失败不阻断启动 */ }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ThemeProvider>
          <I18nProvider>
            <App />
          </I18nProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}

bootstrap()