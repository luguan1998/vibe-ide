import React from 'react'
import ReactDOM from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import App from './App'
import { ThemeProvider } from './themes'
import './styles/globals.css'

// 使用本地 monaco-editor 文件，不走 CDN
loader.config({ paths: { vs: 'monaco/vs' } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
)