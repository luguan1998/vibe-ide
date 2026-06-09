import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getKindStyle } from '../utils/kindColors'
import { useI18n } from '../i18n'

interface OutlinePanelProps {
  filePath: string
  fullPath: string
  onNavigate: (line: number, headingName?: string) => void
}

interface OutlineItem {
  name: string
  kind: string
  line: number
  children?: OutlineItem[]
}

const KIND_LABELS: Record<string, string> = {
  function: 'Fn', method: 'Me', class: 'Cl', interface: 'If',
  variable: 'Va', constant: 'Ct', type_alias: 'Ty', component: 'Co',
  enum: 'En', module: 'Mo', property: 'Pr',
}

function getKindLabel(kind: string): string { return KIND_LABELS[kind] || kind.slice(0, 2) }

const CODE_EXTS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb',
    'cs', 'cpp', 'c', 'h', 'hpp', 'php', 'swift', 'kt', 'scala',
    'vue', 'svelte',
  ])
  const MD_EXTS = new Set(['md', 'mdx', 'markdown'])

  function isMarkdown(filePath: string): boolean {
    return MD_EXTS.has(filePath.split('.').pop()?.toLowerCase() || '')
  }
  function isCode(filePath: string): boolean {
    return CODE_EXTS.has(filePath.split('.').pop()?.toLowerCase() || '')
  }

function getLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
    cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
    vue: 'vue', svelte: 'svelte',
  }
  return map[ext] || 'unknown'
}

function parseMarkdownOutline(content: string): OutlineItem[] {
  const headings: OutlineItem[] = []
  const lines = content.split('\n')
  let inFenced = false      // inside ``` or ~~~ block
  let fenceChar = ''        // ` or ~
  let fenceLen = 0          // opening fence length (3+)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Track fenced code block boundaries
    if (!inFenced) {
      const fence = line.match(/^(`{3,}|~{3,})/)
      if (fence) {
        inFenced = true
        fenceChar = fence[1][0]
        fenceLen = fence[1].length
        continue
      }
    } else {
      // Closing fence: same char, same or longer length, optional trailing spaces
      if (line.match(new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`))) {
        inFenced = false
      }
      continue
    }

    const m = line.match(/^(#{1,6})\s+(.+)$/)
    if (m) {
      const level = m[1].length
      headings.push({ name: m[2].replace(/[*_`~]/g, '').trim(), kind: `heading-${level}`, line: i + 1 })
    }
  }

  // Build tree: nest headings by level
  const root: OutlineItem[] = []
  const stack: OutlineItem[] = [] // stack[i] = current parent at depth i+1
  for (const h of headings) {
    const level = parseInt(h.kind.split('-')[1])
    // Pop stack until we find a parent whose level < current
    while (stack.length > 0 && parseInt(stack[stack.length - 1].kind.split('-')[1]) >= level) {
      stack.pop()
    }
    h.children = [] // reserve for future nesting
    if (stack.length === 0) {
      root.push(h)
    } else {
      stack[stack.length - 1].children!.push(h)
    }
    stack.push(h)
  }

  // Remove empty children arrays (leaf headings)
  function cleanEmpty(item: OutlineItem) {
    if (item.children && item.children.length === 0) delete item.children
    else item.children?.forEach(cleanEmpty)
  }
  root.forEach(cleanEmpty)
  return root
}

// Code outline regex parser
const BLOCK_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'throw', 'new', 'try', 'catch', 'else', 'do', 'case', 'break', 'continue', 'delete', 'typeof', 'instanceof', 'void', 'await', 'yield', 'super', 'import', 'from'])

function parseCodeOutline(content: string, lang: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = content.split('\n')

  let currentClass: OutlineItem | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (lang === 'typescript' || lang === 'javascript') {
      // class/interface/enum/type
      const classMatch = line.match(/^(export\s+)?(default\s+)?(abstract\s+)?(class|interface|enum)\s+(\w+)/)
      if (classMatch) {
        currentClass = { name: classMatch[5], kind: classMatch[4], line: i + 1, children: [] }
        items.push(currentClass)
        continue
      }
      const typeMatch = line.match(/^(export\s+)?type\s+(\w+)\s*=/)
      if (typeMatch) {
        currentClass = null
        items.push({ name: typeMatch[2], kind: 'type_alias', line: i + 1 })
        continue
      }
      // function
      const fnMatch = line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/)
      if (fnMatch) {
        currentClass = null
        items.push({ name: fnMatch[3], kind: 'function', line: i + 1 })
        continue
      }
      // arrow function / const
      const constMatch = line.match(/^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(?/)
      if (constMatch) {
        const isFn = line.includes('=>') || line.match(/\)\s*:\s*\w+\s*=>/)
        if (isFn) {
          items.push({ name: constMatch[2], kind: 'function', line: i + 1 })
        } else {
          items.push({ name: constMatch[2], kind: 'constant', line: i + 1 })
        }
        currentClass = null
        continue
      }
      // method inside class (indented, but use raw line to detect indentation)
      if (currentClass) {
        const rawLine = lines[i]
        if (!rawLine.match(/^\s{2,}/)) continue // must be indented
        const trimmedMethod = rawLine.trim()
        if (trimmedMethod.startsWith('//') || trimmedMethod.startsWith('*') || trimmedMethod.startsWith('/*')) continue
        const methodMatch = trimmedMethod.match(/^(?:async\s+)?(\w+)\s*\(/)
        if (methodMatch && !BLOCK_KEYWORDS.has(methodMatch[1])) {
          if (['constructor', 'get', 'set', 'static', 'public', 'private', 'protected'].includes(methodMatch[1])) {
            const realMethod = trimmedMethod.match(/^(?:async\s+)?(?:get|set|static|public|private|protected)\s+(\w+)\s*\(/)
            if (realMethod && !BLOCK_KEYWORDS.has(realMethod[1])) {
              currentClass.children!.push({ name: realMethod[1], kind: 'method', line: i + 1 })
            }
          } else {
            currentClass.children!.push({ name: methodMatch[1], kind: 'method', line: i + 1 })
          }
        }
      }
    } else if (lang === 'python') {
      const classMatch = line.match(/^class\s+(\w+)/)
      if (classMatch) {
        currentClass = { name: classMatch[1], kind: 'class', line: i + 1, children: [] }
        items.push(currentClass)
        continue
      }
      const fnMatch = line.match(/^(async\s+)?def\s+(\w+)/)
      if (fnMatch) {
        const isMethod = currentClass && !line.startsWith('def ') && lines[i - 1]?.trim() !== '' && lines[i - 1]?.trim().startsWith('@') || (i > 0 && lines[i - 1]?.trim() === '')
        // Simple heuristic: if indented, it's inside the class
        if (currentClass && line.startsWith('  ') || line.startsWith('\t')) {
          currentClass.children!.push({ name: fnMatch[2], kind: 'method', line: i + 1 })
        } else {
          currentClass = null
          items.push({ name: fnMatch[2], kind: 'function', line: i + 1 })
        }
      }
    } else if (lang === 'go') {
      const typeMatch = line.match(/^type\s+(\w+)\s+(struct|interface)/)
      if (typeMatch) {
        currentClass = { name: typeMatch[1], kind: typeMatch[2] === 'struct' ? 'class' : 'interface', line: i + 1, children: [] }
        items.push(currentClass)
        continue
      }
      const fnMatch = line.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/)
      if (fnMatch) {
        if (currentClass && line.includes(`*${currentClass.name}`) || line.includes(`${currentClass.name})`)) {
          currentClass.children!.push({ name: fnMatch[1], kind: 'method', line: i + 1 })
        } else {
          currentClass = null
          items.push({ name: fnMatch[1], kind: 'function', line: i + 1 })
        }
      }
    } else if (lang === 'rust') {
      const structMatch = line.match(/^(pub\s+)?struct\s+(\w+)/)
      if (structMatch) {
        currentClass = { name: structMatch[2], kind: 'class', line: i + 1, children: [] }
        items.push(currentClass)
        continue
      }
      const enumMatch = line.match(/^(pub\s+)?enum\s+(\w+)/)
      if (enumMatch) {
        currentClass = null
        items.push({ name: enumMatch[2], kind: 'enum', line: i + 1 })
        continue
      }
      const traitMatch = line.match(/^(pub\s+)?trait\s+(\w+)/)
      if (traitMatch) {
        currentClass = { name: traitMatch[2], kind: 'interface', line: i + 1, children: [] }
        items.push(currentClass)
        continue
      }
      const fnMatch = line.match(/^(pub\s+)?(async\s+)?fn\s+(\w+)/)
      if (fnMatch) {
        items.push({ name: fnMatch[3], kind: 'function', line: i + 1 })
        currentClass = null
      }
    } else {
      // Generic: try to catch class/function patterns
      const classMatch = line.match(/^(class|interface|struct)\s+(\w+)/)
      if (classMatch) {
        currentClass = { name: classMatch[2], kind: classMatch[1] === 'interface' ? 'interface' : 'class', line: i + 1, children: [] }
        items.push(currentClass)
        continue
      }
      const fnMatch = line.match(/^(function|def|fn|func)\s+(\w+)/)
      if (fnMatch) {
        items.push({ name: fnMatch[2], kind: 'function', line: i + 1 })
        currentClass = null
      }
    }
  }
  return items
}

function HeadingBadge({ level }: { level: number }) {
  return (
    <span className="text-[10px] font-bold leading-none shrink-0 select-none"
      style={{ color: `rgb(var(--ide-accent) / ${Math.max(0.35, 1 - level * 0.12)})` }}>
      {'#'.repeat(level)}
    </span>
  )
}

function OutlineItemRow({ item, depth, collapsedSet, onToggle, onNavigate }: {
  item: OutlineItem
  depth: number
  collapsedSet: Set<string>
  onToggle: (key: string) => void
  onNavigate: (line: number, headingName?: string) => void
}) {
  const hasChildren = item.children && item.children.length > 0
  const isHeading = item.kind.startsWith('heading-')
  const headingLevel = isHeading ? parseInt(item.kind.split('-')[1]) : 0
  const key = `${item.kind}:${item.name}:${item.line}`
  const isCollapsed = collapsedSet.has(key)

  return (
    <>
      <div
        className="flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-ide-hover rounded group"
        style={{ paddingLeft: `${4 + depth * 12}px` }}
        onClick={() => onNavigate(item.line, isHeading ? item.name : undefined)}
      >
        {hasChildren && (
          <button
            className="w-4 h-4 flex items-center justify-center text-ide-text-muted shrink-0 hover:text-ide-text"
            onClick={(e) => { e.stopPropagation(); onToggle(key) }}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
              <path d="M6 4l4 4-4 4z" />
            </svg>
          </button>
        )}
        {!hasChildren && <span className="w-4 shrink-0" />}
        {isHeading ? (
          <HeadingBadge level={headingLevel} />
        ) : (
          <span
            className="text-[10px] font-bold leading-none px-0.5 rounded shrink-0"
            style={getKindStyle(item.kind)}
          >
            {getKindLabel(item.kind)}
          </span>
        )}
        <span className="text-xs text-ide-text truncate flex-1">{item.name}</span>
        <span className="text-[10px] text-ide-text-muted/50 shrink-0 group-hover:text-ide-text-muted">{item.line}</span>
      </div>
      {hasChildren && !isCollapsed && item.children!.map(child => (
        <OutlineItemRow
          key={`${child.kind}:${child.name}:${child.line}`}
          item={child}
          depth={depth + 1}
          collapsedSet={collapsedSet}
          onToggle={onToggle}
          onNavigate={onNavigate}
        />
      ))}
    </>
  )
}

export default React.memo(function OutlinePanel({ filePath, fullPath, onNavigate }: OutlinePanelProps) {
  const { t } = useI18n()
  const [items, setItems] = useState<OutlineItem[]>([])
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const pendingRef = useRef<string>(fullPath)

  const md = isMarkdown(filePath)
  const code = !md && isCode(filePath)
  const lang = code ? getLanguageId(filePath) : 'unknown'

  useEffect(() => {
    if (!md && !code) {
      setLoading(false)
      setItems([])
      return
    }
    pendingRef.current = fullPath
    setLoading(true)
    setItems([])

    window.api.file.read(fullPath).then(result => {
      if (pendingRef.current !== fullPath) return
      if (result.error) { setLoading(false); return }
      const content = result.content
      if (md) {
        setItems(parseMarkdownOutline(content))
      } else {
        setItems(parseCodeOutline(content, lang))
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [fullPath, md, code, lang])

  const handleToggle = useCallback((key: string) => {
    setCollapsedSet(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleNavigate = useCallback((line: number, headingName?: string) => {
    onNavigate(line, headingName)
  }, [onNavigate])

  const fileName = filePath.replace(/[\\/]/g, '/').split('/').pop() || filePath

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-ide-border shrink-0">
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-ide-text-muted shrink-0">
            <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H3.75A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9.75 4.25V1.5Zm6.75 3.5V1.5h2.5v2.75c0 .138.112.25.25.25h2.75v7.75a.25.25 0 0 1-.25.25h-9.5a.25.25 0 0 1-.25-.25V6Z" />
          </svg>
          <span className="text-xs font-medium text-ide-text truncate">{fileName}</span>
        </div>
      </div>

      {/* Outline list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {loading && (
          <div className="px-2 py-4 text-xs text-ide-text-muted text-center">{t('Loading...')}</div>
        )}
        {!loading && items.length === 0 && (
          <div className="px-2 py-4 text-xs text-ide-text-muted text-center">{t('No outline')}</div>
        )}
        {!loading && items.map(item => (
          <OutlineItemRow
            key={`${item.kind}:${item.name}:${item.line}`}
            item={item}
            depth={0}
            collapsedSet={collapsedSet}
            onToggle={handleToggle}
            onNavigate={handleNavigate}
          />
        ))}
      </div>
    </div>
  )
})