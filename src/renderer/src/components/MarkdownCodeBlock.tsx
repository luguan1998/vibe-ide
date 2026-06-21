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

class MermaidErrorBoundary extends React.Component<{ children: React.ReactNode; code: string }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode; code: string }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="md-mermaid md-mermaid-error-state">
          <div className="md-mermaid-error">Mermaid render error</div>
          <pre><code>{this.props.code}</code></pre>
        </div>
      )
    }
    return this.props.children
  }
}

function MermaidBlock({ code }: { code: string }) {
  const { theme } = useTheme()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; panX: number; panY: number }>({ dragging: false, startX: 0, startY: 0, panX: 0, panY: 0 })

  useEffect(() => {
    let cancelled = false
    const isDark = !theme.monacoTheme.includes('light')
    try {
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
    } catch (err: any) {
      if (!cancelled) {
        setError(err?.message || 'Mermaid init error')
        setSvg(null)
      }
    }
    const id = `mermaid-${Math.random().toString(36).slice(2)}`
    ;(async () => {
      try {
        const { svg: renderedSvg } = await mermaid.render(id, code)
        if (!cancelled) {
          setSvg(renderedSvg)
          setError(null)
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Mermaid render error')
          setSvg(null)
        }
      }
    })()
    return () => { cancelled = true }
  }, [code, theme.monacoTheme])

  useEffect(() => {
    if (!zoomed) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setZoomed(false)
        setScale(1)
        setPan({ x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [zoomed])

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
    <>
      <div
        className="md-mermaid cursor-zoom-in hover:shadow-lg hover:border-ide-accent/30 transition-shadow"
        onClick={() => setZoomed(true)}
      >
        <span className="md-code-lang">mermaid</span>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pt-10 animate-fade-in"
          onClick={() => { setZoomed(false); setScale(1); setPan({ x: 0, y: 0 }) }}
        >
          <div
            className="bg-ide-bg rounded-lg shadow-2xl w-[88vw] h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-ide-border shrink-0 bg-ide-sidebar gap-2">
              <span className="md-code-lang static text-xs">mermaid</span>
              <div className="flex items-center gap-0.5">
                <button
                  className="w-6 h-6 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors text-sm leading-none select-none"
                  onClick={() => setScale(s => Math.max(0.1, +(s * 0.8).toFixed(2)))}
                  title="Zoom out"
                >−</button>
                <button
                  className="min-w-[42px] h-6 rounded text-xs text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors font-mono select-none"
                  onClick={() => { setScale(1); setPan({ x: 0, y: 0 }) }}
                  title="Reset zoom"
                >{Math.round(scale * 100)}%</button>
                <button
                  className="w-6 h-6 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors text-sm leading-none select-none"
                  onClick={() => setScale(s => Math.min(10, +(s * 1.25).toFixed(2)))}
                  title="Zoom in"
                >+</button>
              </div>
              <button
                className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none shrink-0"
                onClick={() => { setZoomed(false); setScale(1); setPan({ x: 0, y: 0 }) }}
              >
                ×
              </button>
            </div>
            <div
              className="overflow-auto p-4 flex items-center justify-center flex-1 cursor-grab"
              onWheel={(e) => {
                e.stopPropagation()
                setScale(s => {
                  const next = e.deltaY < 0 ? s * 1.15 : s * 0.85
                  return Math.min(10, Math.max(0.1, +next.toFixed(2)))
                })
              }}
              onMouseDown={(e) => {
                if (e.button !== 0) return
                dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
                ;(e.currentTarget as HTMLElement).style.cursor = 'grabbing'
              }}
              onMouseMove={(e) => {
                if (!dragRef.current.dragging) return
                setPan({
                  x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
                  y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
                })
              }}
              onMouseUp={() => {
                dragRef.current.dragging = false
              }}
              onMouseLeave={() => {
                if (dragRef.current.dragging) {
                  dragRef.current.dragging = false
                }
              }}
            >
              <div
                style={{
                  transform: `scale(${scale}) translate(${pan.x / scale}px, ${pan.y / scale}px)`,
                  transition: dragRef.current.dragging ? 'none' : 'transform 0.15s ease-out',
                }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const { theme } = useTheme()
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const monacoRef = useRef<any>(null)
  const monacoLang = mapLanguage(language)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [code])

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
    <div className="md-code-block group">
      {language !== 'plaintext' && <span className="md-code-lang">{language}</span>}
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-ide-bg/80 hover:bg-ide-hover text-ide-text-muted hover:text-ide-text opacity-0 group-hover:opacity-100 transition-opacity z-10"
        title="Copy code"
      >
        {copied ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-success">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
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
        return <MermaidErrorBoundary code={code}><MermaidBlock code={code} /></MermaidErrorBoundary>
      }
      if (match || code.includes('\n')) {
        return <CodeBlock language={match?.[1] ?? 'plaintext'} code={code} />
      }
      return <code className={className} {...props}>{children}</code>
    },
  }
}

export { CodeBlock, MermaidBlock, getMarkdownCodeOverrides }
