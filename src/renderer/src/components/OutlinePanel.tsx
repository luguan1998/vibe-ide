import React, { useState, useEffect, useCallback, useRef } from 'react'
import { getKindStyle } from '../utils/kindColors'
import { useI18n } from '../i18n'

interface OutlinePanelProps {
  filePath: string
  fullPath: string
  content?: string  // 从 DiffViewer 直接传入，省 IPC file.read
  hasExternalProvider?: boolean  // true = DiffViewer 会通过 content prop 传入内容，不需要自己读
  onNavigate: (line: number, headingName?: string) => void
}

interface OutlineItem {
  name: string
  kind: string
  line: number
  children?: OutlineItem[]
}

const OUTLINE_LINE_LIMIT = 3000

// Per-language kind filter cache (in-memory, session only)
const langFilterCache = new Map<string, Set<string>>()

function getLangFilter(lang: string): Set<string> {
  const cached = langFilterCache.get(lang)
  return cached ? new Set(cached) : new Set(['function', 'method', 'class'])
}

// 手动取行，避免 split 全量分配后再 slice；limit 行即停
function takeLines(content: string, limit: number): string[] {
  const lines: string[] = []
  let start = 0
  const len = content.length
  for (let i = 0; i < len; i++) {
    if (content[i] === '\n') {
      // strip trailing \r if present (\r\n case)
      const end = i > start && content[i - 1] === '\r' ? i - 1 : i
      lines.push(content.substring(start, end))
      start = i + 1
      if (lines.length >= limit) return lines
    } else if (content[i] === '\r' && (i + 1 >= len || content[i + 1] !== '\n')) {
      // standalone \r (old Mac line ending)
      lines.push(content.substring(start, i))
      start = i + 1
      if (lines.length >= limit) return lines
    }
  }
  if (start < len && lines.length < limit) lines.push(content.substring(start))
  return lines
}

const KIND_LABELS: Record<string, string> = {
  function: 'Fn', method: 'Me', class: 'Cl', interface: 'If',
  variable: 'Va', constant: 'Ct', type_alias: 'Ty', component: 'Co',
  enum: 'En', module: 'Ns', property: 'Pr',
}

function getKindLabel(kind: string): string { return KIND_LABELS[kind] || kind.slice(0, 2) }

const CODE_EXTS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb',
    'cs', 'cpp', 'c', 'h', 'hpp', 'php', 'swift', 'kt', 'scala',
    'vue', 'svelte', 'dart',
  ])
  const MD_EXTS = new Set(['md', 'mdx', 'markdown'])

  export function isMarkdown(filePath: string): boolean {
    return MD_EXTS.has(filePath.split('.').pop()?.toLowerCase() || '')
  }
  export function isCode(filePath: string): boolean {
    return CODE_EXTS.has(filePath.split('.').pop()?.toLowerCase() || '')
  }

function getLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
    cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
    vue: 'vue', svelte: 'svelte', dart: 'dart',
  }
  return map[ext] || 'unknown'
}

function parseMarkdownOutline(content: string): OutlineItem[] {
  const lines = takeLines(content, OUTLINE_LINE_LIMIT)
  const headings: OutlineItem[] = []
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

// Code outline regex parser — 惰性正则：按 kinds 预建 pattern 表，循环外过滤，循环内只遍历小表
const BLOCK_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'throw', 'new', 'try', 'catch', 'else', 'do', 'case', 'break', 'continue', 'delete', 'typeof', 'instanceof', 'void', 'await', 'yield', 'super', 'import', 'from'])

const C_TYPE_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'throw', 'new', 'delete', 'try', 'catch', 'class', 'struct', 'enum', 'namespace', 'typedef', 'using', 'template', 'include', 'define', 'sizeof', 'alignof', 'static_assert', 'public', 'private', 'protected', 'friend', 'operator', 'virtual', 'override', 'final', 'const', 'constexpr', 'volatile', 'extern', 'static', 'inline', 'register', 'mutable', 'thread_local', 'noexcept', 'decltype', 'auto', 'void', 'int', 'char', 'float', 'double', 'bool', 'long', 'short', 'unsigned', 'signed', 'size_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'string', 'wstring', 'nullptr'])

type PatternEntry = {
  regex: RegExp
  resolve: (m: RegExpMatchArray, lineIdx: number, rawLine: string) => OutlineItem | { item: OutlineItem; classCtx: true; push: boolean } | null
}

// ── TS/JS pattern builder ──
function buildTSPatterns(kinds: Set<string>): PatternEntry[] {
  const needMethod = kinds.has('method')
  const trackClass = kinds.has('class') || kinds.has('interface') || kinds.has('enum') || needMethod
  const patterns: PatternEntry[] = []

  if (trackClass) {
    patterns.push({
      regex: /^(export\s+)?(default\s+)?(abstract\s+)?(class|interface|enum)\s+(\w+)/,
      resolve: (m, i, _raw) => {
        const kind = m[4] as string
        const item: OutlineItem = { name: m[5], kind, line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has(kind) }
      }
    })
  }
  if (kinds.has('type_alias')) {
    patterns.push({
      regex: /^(export\s+)?type\s+(\w+)\s*=/,
      resolve: (m, i) => ({ name: m[2], kind: 'type_alias', line: i + 1 })
    })
  }
  if (kinds.has('function')) {
    patterns.push({
      regex: /^(export\s+)?(async\s+)?function\s+(\w+)/,
      resolve: (m, i) => ({ name: m[3], kind: 'function', line: i + 1 })
    })
  }
  // const → arrow function / constant 共用一条正则，resolve 内分流
  if (kinds.has('function') || kinds.has('constant')) {
    patterns.push({
      regex: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(?/,
      resolve: (m, i, rawLine) => {
        const isArrowFn = rawLine.includes('=>') || /\)\s*:\s*\w+\s*=>/.test(rawLine)
        if (isArrowFn && kinds.has('function')) {
          return { name: m[2], kind: 'function', line: i + 1 }
        }
        if (!isArrowFn && kinds.has('constant')) {
          return { name: m[2], kind: 'constant', line: i + 1 }
        }
        return null
      }
    })
  }
  return patterns
}

// ── Python pattern builder ──
function buildPythonPatterns(kinds: Set<string>): PatternEntry[] {
  const needMethod = kinds.has('method')
  const trackClass = kinds.has('class') || needMethod
  const patterns: PatternEntry[] = []

  if (trackClass) {
    patterns.push({
      regex: /^class\s+(\w+)/,
      resolve: (m, i, _raw) => {
        const item: OutlineItem = { name: m[1], kind: 'class', line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has('class') }
      }
    })
  }

  // def is handled entirely in the fallback below (like TS/JS/Java),
  // so it doesn't reset currentClass in the main pattern loop.
  return patterns
}

// ── Go pattern builder ──
function buildGoPatterns(kinds: Set<string>): PatternEntry[] {
  const needMethod = kinds.has('method')
  const trackClass = kinds.has('class') || kinds.has('interface') || needMethod
  const patterns: PatternEntry[] = []

  if (trackClass) {
    patterns.push({
      regex: /^type\s+(\w+)\s+(struct|interface)/,
      resolve: (m, i, _raw) => {
        const kind = m[2] === 'struct' ? 'class' : 'interface'
        const item: OutlineItem = { name: m[1], kind, line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has(kind) }
      }
    })
  }
  if (kinds.has('function') || kinds.has('method')) {
    patterns.push({
      regex: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/,
      resolve: (m, i, _raw) => ({ name: m[1], kind: 'function', line: i + 1 })
      // method 判断需要 currentClass 上下文，在主循环里处理
    })
  }
  return patterns
}

// ── Rust pattern builder ──
function buildRustPatterns(kinds: Set<string>): PatternEntry[] {
  const needMethod = kinds.has('method')
  const trackClass = kinds.has('class') || kinds.has('interface') || needMethod
  const patterns: PatternEntry[] = []

  if (trackClass) {
    patterns.push({
      regex: /^(pub\s+)?struct\s+(\w+)/,
      resolve: (m, i, _raw) => {
        const item: OutlineItem = { name: m[2], kind: 'class', line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has('class') }
      }
    })
    patterns.push({
      regex: /^(pub\s+)?trait\s+(\w+)/,
      resolve: (m, i, _raw) => {
        const item: OutlineItem = { name: m[2], kind: 'interface', line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has('interface') }
      }
    })
  }
  if (kinds.has('enum')) {
    patterns.push({
      regex: /^(pub\s+)?enum\s+(\w+)/,
      resolve: (m, i) => ({ name: m[2], kind: 'enum', line: i + 1 })
    })
  }
  if (kinds.has('function')) {
    patterns.push({
      regex: /^(pub\s+)?(async\s+)?fn\s+(\w+)/,
      resolve: (m, i) => ({ name: m[3], kind: 'function', line: i + 1 })
    })
  }
  return patterns
}

// ── C/C++ resolve helper ──
function resolveCFunction(fnName: string, lineIdx: number, rawLine: string, kinds: Set<string>): OutlineItem | null {
  if (BLOCK_KEYWORDS.has(fnName) || C_TYPE_KEYWORDS.has(fnName)) return null
  const isMethod = rawLine.charCodeAt(0) === 32 && rawLine.charCodeAt(1) === 32 || rawLine.charCodeAt(0) === 9
  if (isMethod && kinds.has('method')) return { name: fnName, kind: 'method', line: lineIdx + 1 }
  if (!isMethod && kinds.has('function')) return { name: fnName, kind: 'function', line: lineIdx + 1 }
  return null
}

// ── C/C++ pattern builder ──
function buildCPatterns(kinds: Set<string>): PatternEntry[] {
  const needMethod = kinds.has('method')
  const trackClass = kinds.has('class') || kinds.has('interface') || kinds.has('enum') || needMethod
  const patterns: PatternEntry[] = []

  // namespace → module kind
  if (kinds.has('module')) {
    patterns.push({
      regex: /^namespace\s+(\w+)/,
      resolve: (m, i) => ({ name: m[1], kind: 'module', line: i + 1 })
    })
  }
  if (trackClass) {
    // struct / class
    patterns.push({
      regex: /^(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+(\w+)/,
      resolve: (m, i, _raw) => {
        const item: OutlineItem = { name: m[1], kind: 'class', line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has('class') }
      }
    })
    // enum / enum class
    patterns.push({
      regex: /^enum\s+(class\s+)?(\w+)/,
      resolve: (m, i, _raw) => {
        const item: OutlineItem = { name: m[2], kind: 'enum', line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has('enum') }
      }
    })
  }
  // typedef → type_alias
  if (kinds.has('type_alias')) {
    patterns.push({
      regex: /^typedef\s+[^;]*\b(\w+)\s*;/,
      resolve: (m, i) => ({ name: m[1], kind: 'type_alias', line: i + 1 })
    })
  }
  // #define → constant
  if (kinds.has('constant')) {
    patterns.push({
      regex: /^#define\s+(\w+)/,
      resolve: (m, i) => ({ name: m[1], kind: 'constant', line: i + 1 })
    })
  }
  // function declarations / definitions — 确定性正则，无 {n,m} 回溯
  // 三条正则分别匹配 1/2/3 词返回类型，各自确定性 O(1)
  const cQual = '(?:inline\\s+|static\\s+|extern\\s+|virtual\\s+|constexpr\\s+)?'
  const cTpl = '(?:template\\s*<[^>]*>\\s*)?'
  if (kinds.has('function') || kinds.has('method')) {
    // 单词返回类型：void foo( / int bar(
    patterns.push({
      regex: new RegExp(`^${cTpl}${cQual}\\w+\\s+(\\w+)\\s*\\(`),
      resolve: (m, i, rawLine) => resolveCFunction(m[1], i, rawLine, kinds)
    })
    // 双词返回类型：unsigned int foo( / const char bar( / long long baz(
    patterns.push({
      regex: new RegExp(`^${cTpl}${cQual}(?:const\\s+|unsigned\\s+|signed\\s+|long\\s+|short\\s+)\\w+\\s+(\\w+)\\s*\\(`),
      resolve: (m, i, rawLine) => resolveCFunction(m[1], i, rawLine, kinds)
    })
    // 三词返回类型：unsigned long long foo( / const unsigned char bar(
    patterns.push({
      regex: new RegExp(`^${cTpl}${cQual}(?:unsigned\\s+|signed\\s+)(?:long\\s+|short\\s+)\\w+\\s+(\\w+)\\s*\\(`),
      resolve: (m, i, rawLine) => resolveCFunction(m[1], i, rawLine, kinds)
    })
  }
  return patterns
}

// ── Java pattern builder ──
const JAVA_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'throw', 'new', 'try', 'catch', 'else', 'do', 'case', 'break', 'continue', 'synchronized', 'super', 'this', 'instanceof', 'default', 'finally', 'assert'])

function buildJavaPatterns(kinds: Set<string>): PatternEntry[] {
  const needMethod = kinds.has('method')
  const trackClass = kinds.has('class') || kinds.has('interface') || kinds.has('enum') || needMethod
  const patterns: PatternEntry[] = []

  if (trackClass) {
    patterns.push({
      regex: /^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+)?(class|interface|enum)\s+(\w+)/,
      resolve: (m, i) => {
        const kind = m[1]
        const item: OutlineItem = { name: m[2], kind, line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has(kind) }
      }
    })
  }

  // Methods are handled entirely in the fallback below (like TS/JS),
  // so they don't reset currentClass in the main pattern loop.
  return patterns
}

// ── Kotlin pattern builder ──
const KOTLIN_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'when', 'try', 'catch', 'finally', 'return', 'throw', 'break', 'continue', 'super', 'this', 'in', 'is', 'as'])

function buildKotlinPatterns(kinds: Set<string>): PatternEntry[] {
  const needMethod = kinds.has('method')
  const trackClass = kinds.has('class') || kinds.has('interface') || kinds.has('enum') || needMethod
  const patterns: PatternEntry[] = []

  if (trackClass) {
    // enum class (must come before regular class)
    if (kinds.has('enum')) {
      patterns.push({
        regex: /^(?:public\s+|private\s+|protected\s+|internal\s+)?enum\s+class\s+(\w+)/,
        resolve: (m, i) => {
          const item: OutlineItem = { name: m[1], kind: 'enum', line: i + 1, children: [] }
          return { item, classCtx: true, push: true }
        }
      })
    }
    // class / interface / object
    patterns.push({
      regex: /^(?:public\s+|private\s+|protected\s+|internal\s+)?(?:abstract\s+|open\s+|data\s+|sealed\s+)?(class|interface|object)\s+(\w+)/,
      resolve: (m, i) => {
        const kind = m[1] === 'object' ? 'class' : m[1]
        const item: OutlineItem = { name: m[2], kind, line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has(kind) }
      }
    })
  }

  return patterns
}

// ── Dart pattern builder ──
const DART_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'try', 'catch', 'finally', 'return', 'throw', 'break', 'continue', 'assert', 'await', 'yield', 'new', 'super', 'this', 'in', 'is', 'as', 'typedef', 'import', 'export', 'library', 'part', 'factory'])

function buildDartPatterns(kinds: Set<string>): PatternEntry[] {
  const needMethod = kinds.has('method')
  const trackClass = kinds.has('class') || kinds.has('interface') || kinds.has('enum') || needMethod
  const patterns: PatternEntry[] = []

  if (trackClass) {
    // enum (must come before class/mixin since it uses 'enum' keyword)
    patterns.push({
      regex: /^(?:abstract\s+)?(class|mixin|enum|extension)\s+(\w+)/,
      resolve: (m, i) => {
        let kind = m[1]
        if (kind === 'mixin' || kind === 'extension') kind = 'class'
        const item: OutlineItem = { name: m[2], kind, line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has(kind) }
      }
    })
  }

  return patterns
}

// ── Generic pattern builder ──
function buildGenericPatterns(kinds: Set<string>): PatternEntry[] {
  const patterns: PatternEntry[] = []
  if (kinds.has('class') || kinds.has('interface')) {
    patterns.push({
      regex: /^(class|interface|struct)\s+(\w+)/,
      resolve: (m, i, _raw) => {
        const kind = m[1] === 'interface' ? 'interface' : 'class'
        const item: OutlineItem = { name: m[2], kind, line: i + 1, children: [] }
        return { item, classCtx: true, push: kinds.has(kind) }
      }
    })
  }
  if (kinds.has('function')) {
    patterns.push({
      regex: /^(function|def|fn|func)\s+(\w+)/,
      resolve: (m, i) => ({ name: m[2], kind: 'function', line: i + 1 })
    })
  }
  return patterns
}

function parseCodeOutline(content: string, lang: string, kinds: Set<string>): OutlineItem[] {
  const lines = takeLines(content, OUTLINE_LINE_LIMIT)
  const items: OutlineItem[] = []
  let currentClass: OutlineItem | null = null
  const needMethod = kinds.has('method')
  const showClassInTree = kinds.has('class') || kinds.has('interface') || kinds.has('enum')

  // 循环外一次性按 kinds 预建 pattern 表
  let patterns: PatternEntry[]
  if (lang === 'typescript' || lang === 'javascript') {
    patterns = buildTSPatterns(kinds)
  } else if (lang === 'python') {
    patterns = buildPythonPatterns(kinds)
  } else if (lang === 'go') {
    patterns = buildGoPatterns(kinds)
  } else if (lang === 'rust') {
    patterns = buildRustPatterns(kinds)
  } else if (lang === 'java') {
    patterns = buildJavaPatterns(kinds)
  } else if (lang === 'kotlin') {
    patterns = buildKotlinPatterns(kinds)
  } else if (lang === 'dart') {
    patterns = buildDartPatterns(kinds)
  } else if (lang === 'c' || lang === 'cpp' || lang === 'csharp') {
    patterns = buildCPatterns(kinds)
  } else {
    patterns = buildGenericPatterns(kinds)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    let matched = false
    for (const p of patterns) {
      const m = line.match(p.regex)
      if (!m) continue
      matched = true
      const result = p.resolve(m, i, lines[i])
      if (!result) continue

      if (result && 'classCtx' in result) {
        currentClass = result.item as OutlineItem
        if (result.push) items.push(currentClass)
      } else {
        currentClass = null
        items.push(result as OutlineItem)
      }
      break
    }

    // TS/JS method detection — 只在 needMethod=true 且有 classCtx 时触发
    if (!matched && needMethod && (lang === 'typescript' || lang === 'javascript') && currentClass) {
      const rawLine = lines[i]
      if (!rawLine.match(/^\s{2,}/)) continue
      const trimmed = rawLine.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
      const mm = trimmed.match(/^(?:async\s+)?(\w+)\s*\(/)
      if (mm && !BLOCK_KEYWORDS.has(mm[1])) {
        const methodName = ['constructor', 'get', 'set', 'static', 'public', 'private', 'protected'].includes(mm[1])
          ? (trimmed.match(/^(?:async\s+)?(?:get|set|static|public|private|protected)\s+(\w+)\s*\(/)?.[1])
          : mm[1]
        if (methodName && !BLOCK_KEYWORDS.has(methodName)) {
          const methodItem = { name: methodName, kind: 'method', line: i + 1 }
          if (showClassInTree) {
            currentClass.children!.push(methodItem)
          } else {
            items.push(methodItem)
          }
        }
      }
    }

    // Java method fallback — ALL methods caught here (like TS/JS), keeping currentClass intact
    if (!matched && needMethod && lang === 'java' && currentClass) {
      const rawLine = lines[i]
      if (!rawLine.match(/^\s{2,}/)) continue
      const trimmed = rawLine.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('@')) continue

      // Full method: [modifiers]* [<type-params>] ReturnType methodName(
      let mm = trimmed.match(/^(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*(?:<[^>]*>\s*)?(\w+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*\(/)
      if (mm && !JAVA_KEYWORDS.has(mm[2])) {
        const methodItem = { name: mm[2], kind: 'method' as const, line: i + 1 }
        if (showClassInTree) currentClass.children!.push(methodItem)
        else items.push(methodItem)
        continue
      }
      // Constructor: modifiers ClassName(  (name starts uppercase)
      mm = trimmed.match(/^(?:public|private|protected)\s+([A-Z]\w*)\s*\(/)
      if (mm) {
        const methodItem = { name: mm[1], kind: 'method' as const, line: i + 1 }
        if (showClassInTree) currentClass.children!.push(methodItem)
        else items.push(methodItem)
        continue
      }
      // Package-private / bare return-type method: ReturnType methodName(
      mm = trimmed.match(/^(\w+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*\(/)
      if (mm && !JAVA_KEYWORDS.has(mm[2]) && mm[1].toLowerCase() === mm[1]) {
        const methodItem = { name: mm[2], kind: 'method' as const, line: i + 1 }
        if (showClassInTree) currentClass.children!.push(methodItem)
        else items.push(methodItem)
      }
    }

    // Kotlin function/method fallback — ALL fun caught here
    if (!matched && (kinds.has('function') || kinds.has('method')) && lang === 'kotlin') {
      const rawLine = lines[i]
      const trimmed = rawLine.trim()
      if (!trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*') && !trimmed.startsWith('@')) {
        const mm = trimmed.match(/^(?:suspend\s+)?(?:override\s+)?(?:open\s+)?(?:private\s+|protected\s+|internal\s+|public\s+)?fun\s+(\w+)\s*[\(<]/)
        if (mm && !KOTLIN_KEYWORDS.has(mm[1])) {
          const isIndented = /^\s{2,}/.test(rawLine)
          if (isIndented && kinds.has('method') && currentClass) {
            const methodItem = { name: mm[1], kind: 'method' as const, line: i + 1 }
            if (showClassInTree) currentClass.children!.push(methodItem)
            else items.push(methodItem)
          } else if (!isIndented && kinds.has('function')) {
            items.push({ name: mm[1], kind: 'function', line: i + 1 })
          }
        }
      }
    }

    // Dart method fallback — inside a class context
    if (!matched && needMethod && lang === 'dart' && currentClass) {
      const rawLine = lines[i]
      if (!rawLine.match(/^\s{2,}/)) continue
      const trimmed = rawLine.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('@')) continue
      // Method: [static|const|final]* ReturnType methodName(
      let mm = trimmed.match(/^(?:static\s+|const\s+|final\s+)*(\w+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*\(/)
      if (mm && !DART_KEYWORDS.has(mm[1]) && !DART_KEYWORDS.has(mm[2])) {
        const methodItem = { name: mm[2], kind: 'method' as const, line: i + 1 }
        if (showClassInTree) currentClass.children!.push(methodItem)
        else items.push(methodItem)
        continue
      }
      // Named constructor: ClassName.named(
      mm = trimmed.match(/^([A-Z]\w*(?:\.\w+)?)\s*\(/)
      if (mm) {
        const methodItem = { name: mm[1], kind: 'method' as const, line: i + 1 }
        if (showClassInTree) currentClass.children!.push(methodItem)
        else items.push(methodItem)
        continue
      }
      // Factory constructor: factory ClassName(
      mm = trimmed.match(/^factory\s+([A-Z]\w*)\s*\(/)
      if (mm) {
        const methodItem = { name: mm[1], kind: 'method' as const, line: i + 1 }
        if (showClassInTree) currentClass.children!.push(methodItem)
        else items.push(methodItem)
        continue
      }
      // Bare method (package-private style): ReturnType methodName( — lowercase return type
      mm = trimmed.match(/^(\w+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*\(/)
      if (mm && !DART_KEYWORDS.has(mm[1]) && !DART_KEYWORDS.has(mm[2]) && mm[1].toLowerCase() === mm[1]) {
        const methodItem = { name: mm[2], kind: 'method' as const, line: i + 1 }
        if (showClassInTree) currentClass.children!.push(methodItem)
        else items.push(methodItem)
      }
    }

    // Dart top-level function fallback — no class context
    if (!matched && kinds.has('function') && lang === 'dart' && !currentClass) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('@')) continue
      // Top-level function: ReturnType functionName(
      const mm = trimmed.match(/^(?:const\s+)?(\w+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*\(/)
      if (mm && !DART_KEYWORDS.has(mm[1]) && !DART_KEYWORDS.has(mm[2])) {
        items.push({ name: mm[2], kind: 'function', line: i + 1 })
      }
    }

    // Python function/method fallback — ALL def caught here
    if (!matched && (kinds.has('function') || kinds.has('method')) && lang === 'python') {
      const rawLine = lines[i]
      const trimmed = rawLine.trim()
      if (trimmed.startsWith('#') || trimmed.startsWith('"""') || trimmed.startsWith("'''") || trimmed.startsWith('@')) continue
      const mm = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/)
      if (mm) {
        const isIndented = /^\s{2,}/.test(rawLine)
        if (isIndented && kinds.has('method') && currentClass) {
          const methodItem = { name: mm[1], kind: 'method' as const, line: i + 1 }
          if (showClassInTree) currentClass.children!.push(methodItem)
          else items.push(methodItem)
        } else if (!isIndented && kinds.has('function')) {
          items.push({ name: mm[1], kind: 'function', line: i + 1 })
        }
      }
    }
  }
  return items
}

const LANG_KINDS: Record<string, string[]> = {
  typescript: ['function', 'method', 'class', 'interface', 'enum', 'type_alias', 'constant'],
  javascript: ['function', 'method', 'class', 'interface', 'enum', 'type_alias', 'constant'],
  python: ['function', 'method', 'class'],
  go: ['function', 'method', 'class', 'interface'],
  rust: ['function', 'method', 'class', 'interface', 'enum'],
  cpp: ['function', 'method', 'class', 'interface', 'enum', 'type_alias', 'constant', 'module'],
  c: ['function', 'method', 'class', 'interface', 'enum', 'type_alias', 'constant', 'module'],
  csharp: ['function', 'method', 'class', 'interface', 'enum', 'type_alias', 'constant'],
  java: ['function', 'method', 'class', 'interface', 'enum'],
  ruby: ['function', 'method', 'class'],
  php: ['function', 'method', 'class', 'interface'],
  swift: ['function', 'method', 'class', 'interface', 'enum'],
  kotlin: ['function', 'method', 'class', 'interface', 'enum'],
  scala: ['function', 'method', 'class', 'interface'],
  dart: ['function', 'method', 'class', 'interface', 'enum'],
  vue: ['function', 'method', 'class', 'interface', 'enum', 'type_alias', 'constant'],
  svelte: ['function', 'method', 'class', 'interface', 'enum', 'type_alias', 'constant'],
  unknown: ['function', 'method', 'class', 'interface'],
}
const KIND_ORDER = ['function', 'method', 'class', 'interface', 'type_alias', 'enum', 'constant', 'variable', 'property', 'module', 'component']

// Filter outline tree: keep items whose kind is in filter, or have descendants in filter
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
            <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 transition-transform shrink-0 ${isCollapsed ? '' : 'rotate-90'}`}>
              <path d="M5 3.5L11 8L5 12.5" />
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

export default React.memo(function OutlinePanel({ filePath, fullPath, content, hasExternalProvider, onNavigate }: OutlinePanelProps) {
  const { t } = useI18n()
  const [items, setItems] = useState<OutlineItem[]>([])
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const pendingRef = useRef<string>(fullPath)

  const md = isMarkdown(filePath)
  const code = !md && isCode(filePath)
  const lang = code ? getLanguageId(filePath) : 'unknown'

  // Kind filter: restore cached config per language, default only 'function' active
  const kindFilterRef = useRef(getLangFilter(lang))
  const [kindFilterDisplay, setKindFilterDisplay] = useState<Set<string>>(() => new Set(kindFilterRef.current))

  // Restore cached filter when language changes (file switch)
  useEffect(() => {
    if (!code) return
    const l = getLanguageId(filePath)
    const filter = getLangFilter(l)
    kindFilterRef.current = filter
    setKindFilterDisplay(new Set(filter))
  }, [fullPath, code])

  // Load outline content (Markdown always full, Code uses kindFilter)
  useEffect(() => {
    if (!md && !code) {
      setLoading(false)
      setItems([])
      return
    }
    pendingRef.current = fullPath
    setLoading(true)
    setItems([])

    const kinds = code ? kindFilterRef.current : undefined

    if (content) {
      if (md) {
        setItems(parseMarkdownOutline(content))
      } else {
        setItems(parseCodeOutline(content, lang, kinds!))
      }
      setLoading(false)
    } else if (hasExternalProvider) {
      // Wait for external provider (DiffViewer's onContentLoaded) — no duplicate file.read
      setLoading(true)
      setItems([])
    } else {
      window.api.file.read(fullPath).then(result => {
        if (pendingRef.current !== fullPath) return
        if (result.error) { setLoading(false); return }
        const c = result.content
        if (md) {
          setItems(parseMarkdownOutline(c))
        } else {
          setItems(parseCodeOutline(c, lang, kinds!))
        }
        setLoading(false)
      }).catch(() => setLoading(false))
    }
  }, [fullPath, md, code, lang, content])

  // Re-parse code outline when kindFilter changes (separate effect, not in the main load effect)
  useEffect(() => {
    if (!code || !content) return
    setItems(parseCodeOutline(content, lang, kindFilterRef.current))
  }, [kindFilterDisplay, code, content, lang])

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

  // Available kinds for this language (code mode only)
  const availableKinds = code ? (LANG_KINDS[lang] || LANG_KINDS.unknown) : []

  const handleToggleKind = useCallback((kind: string) => {
    const next = new Set(kindFilterRef.current)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    if (next.size === 0) return  // Don't allow empty filter
    kindFilterRef.current = next
    langFilterCache.set(lang, next)  // persist to in-memory cache for this language
    setKindFilterDisplay(next)  // trigger re-parse via the kindFilter effect
  }, [lang])

  const fileName = filePath.replace(/[\\/]/g, '/').split('/').pop() || filePath

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-2 py-1.5 border-b border-ide-border shrink-0">
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" className="w-3 h-3 text-ide-accent shrink-0">
            <path fillRule="evenodd" clipRule="evenodd" d="M1 3C1 2.44772 1.44772 2 2 2H14C14.5523 2 15 2.44772 15 3V6C15 6.55228 14.5523 7 14 7H2C1.44772 7 1 6.55228 1 6V3ZM2 3H14V6H2L2 3Z"/><path fillRule="evenodd" clipRule="evenodd" d="M2 9C1.44772 9 1 9.44772 1 10V13C1 13.5523 1.44772 14 2 14H5C5.55228 14 6 13.5523 6 13V10C6 9.44772 5.55228 9 5 9H2ZM5 10H2V13H5V10Z"/><path fillRule="evenodd" clipRule="evenodd" d="M11 9C10.4477 9 10 9.44772 10 10V13C10 13.5523 10.4477 14 11 14H14C14.5523 14 15 13.5523 15 13V10C15 9.44772 14.5523 9 14 9H11ZM14 10H11V13H14V10Z"/>
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
            isMd={md}
          />
        ))}
      </div>

      {/* Kind filter bar (code mode only) */}
      {code && !loading && availableKinds.length > 0 && (
        <div className="px-2 py-1.5 border-t border-ide-border shrink-0 flex items-center gap-1 flex-wrap">
          {availableKinds.map(kind => {
            const active = kindFilterDisplay.has(kind)
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