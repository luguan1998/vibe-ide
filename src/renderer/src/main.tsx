import React from 'react'
import ReactDOM from 'react-dom/client'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import App from './App'
import { ThemeProvider } from './themes'
import './styles/globals.css'

// 直接使用打包进 bundle 的 monaco 实例，不走 CDN / 动态脚本注入
loader.config({ monaco })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
)