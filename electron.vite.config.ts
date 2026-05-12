import { resolve, join, extname } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, statSync } from 'fs'
import type { Plugin } from 'vite'

function monacoLocalPlugin(): Plugin {
  const monacoPath = join(process.cwd(), 'node_modules', 'monaco-editor', 'min', 'vs')
  const mime: Record<string, string> = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.html': 'text/html',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
  }
  return {
    name: 'monaco-local',
    configureServer(server) {
      server.middlewares.use('/monaco/vs', (req, res, next) => {
        const filePath = join(monacoPath, req.url || '')
        try {
          if (!statSync(filePath).isFile()) return next()
        } catch {
          return next()
        }
        res.setHeader('Content-Type', mime[extname(filePath)] || 'application/octet-stream')
        res.end(readFileSync(filePath))
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), monacoLocalPlugin()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react/jsx-runtime'],
            xterm: ['@xterm/xterm'],
            monaco: ['monaco-editor', '@monaco-editor/react']
          }
        }
      }
    }
  }
})