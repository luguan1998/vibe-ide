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
    // dsh markdown 渲染（shiki/katex/micromark）经 dshClientSrcAlias 走 vendor 源码，
    // 其 deep/dynamic import 在运行中被 Vite “发现” → 重新预构建 → 全页 reload（内存峰值）。
    // 启动时一次性预构建 + @shikijs/langs/* glob 覆盖全部语言子包，杜绝运行时发现。
    optimizeDeps: {
      include: [
        'shiki/core',
        'shiki/engine/javascript',
        '@shikijs/langs/*',
        'katex',
        'mdast-util-from-markdown',
        'mdast-util-gfm',
        'mdast-util-math',
        'micromark-extension-gfm',
        'micromark-extension-math',
        'micromark-util-sanitize-uri',
        'micromark-core-commonmark',
        'micromark-util-character',
        'micromark-util-classify-character',
        'micromark-util-symbol',
        'micromark-factory-space',
        'anser',
        'react-markdown',
        'remark-gfm',
        'remark-parse',
        'unified'
      ]
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
