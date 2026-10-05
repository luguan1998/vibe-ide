import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty'],
        input: {
          index: resolve('src/main/index.ts'),
          'computer-use': resolve('src/main/computer-use.ts'),
          'browser-use': resolve('src/main/browser-use.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
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
    // markdown 渲染的 deep/dynamic import 在运行中被 Vite “发现”
    // → 重新预构建 → 全页 reload（内存峰值）。启动时一次性预构建，杜绝运行时发现。
    optimizeDeps: {
      include: [
        'react-markdown',
        'remark-gfm',
        'remark-parse',
        'unified'
      ]
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react/jsx-runtime'],
            xterm: ['@xterm/xterm'],
            monaco: ['monaco-editor', '@monaco-editor/react'],
            mermaid: ['mermaid']
          }
        }
      }
    }
  }
})
