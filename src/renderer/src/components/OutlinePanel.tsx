import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
  const lines = content.split(/\r?\n/)
  let inFenced = false
  let fenceChar = ''
  let fenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!inFenced) {
      const fence = line.match(/^(`{3,}|~{3,})/)
      if (fence) {
        inFenced = true
        fenceChar = fence[1][0]
        fenceLen = fence[1].length
        continue
      }
    } else {
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

  const root: OutlineItem[] = []
  const stack: OutlineItem[] = []
  for (const h of headings) {
    const level = parseInt(h.kind.split('-')[1])
    while (stack.length > 0 && parseInt(stack[stack.length - 1].kind.split('-')[1]) >= level) {
      stack.pop()
    }
    h.children = []
    if (stack.length === 0) {
      root.push(h)
    } else {
      stack[stack.length - 1].children!.push(h)
    }
    stack.push(h)
  }

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
  const lines = content.split(/\r?\n/)

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
        if (!rawLine.match(/^\s{2,}/)) continue
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

// Collect all unique kinds from outline items (recursive)
function collectKinds(items: OutlineItem[]): string[] {
  const kinds = new Set<string>()
  function walk(list: OutlineItem[]) {
    for (const item of list) {
      kinds.add(item.kind)
      if (item.children) walk(item.children)
    }
  }
  walk(items)
  // Sort: function/method first, then class/interface, then rest alphabetically
  const order = ['function', 'method', 'class', 'interface', 'type_alias', 'enum', 'constant', 'variable', 'property', 'module', 'component']
  const sorted = [...kinds].sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b)
    if (ai >= 0 && bi >= 0) return ai - bi
    if (ai >= 0) return -1
    if (bi >= 0) return 1
    return a.localeCompare(b)
  })
  return sorted
}

// Filter outline tree: keep items whose kind is in filter, or have descendants in filter
function filterItems(items: OutlineItem[], kinds: Set<string>): OutlineItem[] {
  if (kinds.size === 0) return items
  function filter(list: OutlineItem[]): OutlineItem[] {
    const out: OutlineItem[] = []
    for (const item of list) {
      const childMatch = item.children ? filter(item.children) : []
      if (kinds.has(item.kind) || childMatch.length > 0) {
        out.push({ ...item, children: childMatch.length > 0 ? childMatch : item.children && kinds.has(item.kind) ? item.children : undefined })
      }
    }
    return out
  }
  return filter(items)
}

function HeadingBadge({ level }: { level: number }) {
  return (
    <span className="text-[10px] font-bold leading-none shrink-0 select-none"
      style={{ color: `rgb(var(--ide-accent) / ${Math.max(0.35, 1 - level * 0.12)})` }}>
      {'#'.repeat(level)}
    </span>
  )
}

function OutlineItemRow({ item, depth, collapsedSet, onToggle, onNavigate, isMd }: {
  item: OutlineItem
  depth: number
  collapsedSet: Set<string>
  onToggle: (key: string) => void
  onNavigate: (line: number, headingName?: string) => void
  isMd: boolean
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
        style={{ paddingLeft: isMd ? `${4 + depth * 14}px` : `${4 + depth * 12}px` }}
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
        {isHeading && !isMd ? (
          <HeadingBadge level={headingLevel} />
        ) : !isHeading ? (
          <span
            className="text-[10px] font-bold leading-none px-0.5 rounded shrink-0"
            style={getKindStyle(item.kind)}
          >
            {getKindLabel(item.kind)}
          </span>
        ) : null}
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
          isMd={isMd}
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

  // Kind filter: only for code files, default only 'function' active
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set(['function']))

  // Reset filter when file changes
  useEffect(() => {
    setKindFilter(new Set(['function']))
  }, [fullPath])

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

  // Available kinds from parsed items (code mode only)
  const availableKinds = useMemo(() => collectKinds(items), [items])

  // Filtered items
  const filteredItems = useMemo(
    () => code ? filterItems(items, kindFilter) : items,
    [code, items, kindFilter]
  )

  const handleToggleKind = useCallback((kind: string) => {
    setKindFilter(prev => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      // Don't allow empty filter — at least one kind must be active
      if (next.size === 0) return prev
      return next
    })
  }, [])

  const fileName = filePath.replace(/[\\/]/g, '/').split('/').pop() || filePath

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-ide-border shrink-0">
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" className="w-3 h-3 text-ide-accent shrink-0">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M1 3C1 2.44772 1.44772 2 2 2H14C14.5523 2 15 2.44772 15 3V6C15 6.55228 14.5523 7 14 7H2C1.44772 7 1 6.55228 1 6V3ZM2 3H14V6H2L2 3Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M2 9C1.44772 9 1 9.44772 1 10V13C1 13.5523 1.44772 14 2 14H5C5.55228 14 6 13.5523 6 13V10C6 9.44772 5.55228 9 5 9H2ZM5 10H2V13H5V10Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11 9C10.4477 9 10 9.44772 10 10V13C10 13.5523 10.4477 14 11 14H14C14.5523 14 15 13.5523 15 13V10C15 9.44772 14.5523 9 14 9H11ZM14 10H11V13H14V10Z"/>
          </svg>
          <span className="text-xs font-medium text-ide-text truncate">{fileName}</span>
        </div>
      </div>

      {/* Outline list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {loading && (
          <div className="px-2 py-4 text-xs text-ide-text-muted text-center">{t('Loading...')}</div>
        )}
        {!loading && filteredItems.length === 0 && (
          <div className="px-2 py-4 text-xs text-ide-text-muted text-center">{t('No outline')}</div>
        )}
        {!loading && filteredItems.map(item => (
          <OutlineItemRow
            key={`${item.kind}:${item.name}:${item.line}`}
            item={item}
            depth={0}
            collapsedSet={collapsedSet}
            onToggle={handleToggle}
            onNavigate={handleNavigate}
            isMd={md}
          />
        ))}
      </div>

      {/* Kind filter bar (code mode only) */}
      {code && !loading && availableKinds.length > 0 && (
        <div className="px-2 py-1.5 border-t border-ide-border shrink-0 flex items-center gap-1 flex-wrap">
          {availableKinds.map(kind => {
            const active = kindFilter.has(kind)
            return (
              <button
                key={kind}
                onClick={() => handleToggleKind(kind)}
                className={`text-[10px] font-bold leading-none px-1.5 py-0.5 rounded transition-colors ${
                  active
                    ? 'bg-ide-accent/20 text-ide-accent'
                    : 'text-ide-text-muted/40 hover:text-ide-text-muted'
                }`}
              >
                {getKindLabel(kind)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})