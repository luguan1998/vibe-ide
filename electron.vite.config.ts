import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { dshClientSrcAlias } from './scripts/dsh-client-src-alias.mjs'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty'],
        input: {
          index: resolve('src/main/index.ts'),
          'computer-use': resolve('src/main/computer-use.ts')
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
    plugins: [react(), dshClientSrcAlias()],
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
