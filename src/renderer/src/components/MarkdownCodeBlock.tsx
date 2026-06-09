import React, { useState, useEffect, useRef } from 'react'
import { useTheme } from '@renderer/themes/context'
import { getMonaco } from '@renderer/utils/monacoSingleton'

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

function CodeBlock({ language, code }: { language: string; code: string }) {
  const { theme } = useTheme()
  const [html, setHtml] = useState<string | null>(null)
  const monacoRef = useRef<any>(null)
  const monacoLang = mapLanguage(language)

  useEffect(() => {
    let cancelled = false
    getMonaco().then(monaco => {
      if (cancelled) return
      monacoRef.current = monaco
      monaco.editor.colorize(code, monacoLang, {}).then(h => {
        if (!cancelled) setHtml(h)
      })
    })
    return () => { cancelled = true }
  }, [code, monacoLang])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    monaco.editor.setTheme(theme.monacoTheme)
    monaco.editor.colorize(code, monacoLang, {}).then(h => setHtml(h))
  }, [theme.monacoTheme])

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
      if (match || code.includes('\n')) {
        return <CodeBlock language={match?.[1] ?? 'plaintext'} code={code} />
      }
      return <code className={className} {...props}>{children}</code>
    },
  }
}

export { CodeBlock, getMarkdownCodeOverrides }