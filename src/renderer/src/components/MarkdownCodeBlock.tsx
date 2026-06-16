import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@renderer/themes/context'
import { getMonaco } from '@renderer/utils/monacoSingleton'
import mermaid from 'mermaid'

const LANG_MAP: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell',
  bash: 'shell', zsh: 'shell', rb: 'ruby', yml: 'yaml',
  md: 'markdown', jsx: 'javascript', tsx: 'typescript',
  csharp: 'csharp', cs: 'csharp', cpp: 'cpp', cc: 'cpp',
  java: 'java', kt: 'kotlin', scala: 'scala', go: 'go',
  rs: 'rust', swift: 'swift', objc: 'objective-c',
  sql: 'sql', mysql: 'sql', postgres: 'sql',
  dockerfile: 'dockerfile', make: 'makefile',
  toml: 'ini', ini: 'ini', conf: 'ini',
  less: 'less', scss: 'scss', sass: 'scss',
  xml: 'xml', svg: 'xml', html: 'html',
  lua: 'lua', r: 'r', perl: 'perl', php: 'php',
  dart: 'dart', elixir: 'elixir', erlang: 'erlang',
  graphql: 'graphql', proto: 'protobuf',
  vb: 'vb', ps1: 'powershell', ps: 'powershell',
  coffee: 'coffee', clojure: 'clojure',
}

function mapLanguage(lang: string): string {
  return LANG_MAP[lang] || lang
}

// Concurrency limiter: max 2 simultaneous colorize calls
const MAX_CONCURRENT = 2
let running = 0
const queue: (() => void)[] = []

function enqueue(task: () => void): () => void {
  let cancelled = false
  const run = () => { if (!cancelled) task() }
  if (running < MAX_CONCURRENT) {
    running++
    run()
  } else {
    queue.push(run)
  }
  return () => { cancelled = true }
}

function colorizeDone() {
  running--
  if (queue.length > 0) {
    running++
    queue.shift()!()
  }
}

let mermaidInitialized = false

function MermaidBlock({ code }: { code: string }) {
  const { theme } = useTheme()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const isDark = !theme.monacoTheme.includes('light')
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
      })
      mermaidInitialized = true
    } else {
      mermaid.initialize({ theme: isDark ? 'dark' : 'default' })
    }
    const id = `mermaid-${Math.random().toString(36).slice(2)}`
    mermaid.render(id, code).then(({ svg: renderedSvg }) => {
      if (!cancelled) {
        setSvg(renderedSvg)
        setError(null)
      }
    }).catch((err: any) => {
      if (!cancelled) {
        setError(err.message || 'Mermaid render error')
        setSvg(null)
      }
    })
    return () => { cancelled = true }
  }, [code, theme.monacoTheme])

  if (error) {
    return (
      <div className="md-mermaid md-mermaid-error-state">
        <div className="md-mermaid-error">{error}</div>
        <pre><code>{code}</code></pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="md-mermaid">
        <span className="md-code-lang">mermaid</span>
        <div className="text-ide-text-muted text-sm">Rendering...</div>
      </div>
    )
  }

  return (
    <div className="md-mermaid">
      <span className="md-code-lang">mermaid</span>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const { theme } = useTheme()
  const [html, setHtml] = useState<string | null>(null)
  const monacoRef = useRef<any>(null)
  const monacoLang = mapLanguage(language)

  useEffect(() => {
    let cancel = () => {}
    getMonaco().then(monaco => {
      monacoRef.current = monaco
      cancel = enqueue(() => {
        monaco.editor.colorize(code, monacoLang, { theme: theme.monacoTheme }).then((h: string) => {
          colorizeDone()
          setHtml(h)
        }).catch(colorizeDone)
      })
    })
    return () => { cancel() }
  }, [code, monacoLang])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    monaco.editor.colorize(code, monacoLang, { theme: theme.monacoTheme }).then((h: string) => setHtml(h))
  }, [theme.monacoTheme, code, monacoLang])

  return (
    <div className="md-code-block">
      {language !== 'plaintext' && <span className="md-code-lang">{language}</span>}
      {html
        ? <pre><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
        : <pre><code>{code}</code></pre>
      }
    </div>
  )
}

function getMarkdownCodeOverrides(): Record<string, React.ComponentType<any>> {
  return {
    pre: ({ children }: any) => <>{children}</>,
    code: ({ className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const code = String(children).replace(/\n$/, '')
      if (match?.[1] === 'mermaid') {
        return <MermaidBlock code={code} />
      }
      if (match || code.includes('\n')) {
        return <CodeBlock language={match?.[1] ?? 'plaintext'} code={code} />
      }
      return <code className={className} {...props}>{children}</code>
    },
  }
}

export { CodeBlock, MermaidBlock, getMarkdownCodeOverrides }
