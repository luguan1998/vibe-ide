import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Terminal, ILinkProvider, ILink, IBufferRange, IBuffer, IBufferLine } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { eventMatchesBinding, getShortcuts } from '../shortcuts'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'

import { useTheme } from '../themes'
import { loadFilterRules } from './FileTab'
import { EDITABLE_EXTENSIONS, FILE_PATH_REGEX, parseFilePath, isBareFilename } from '../utils/filePathUtils'
import '@xterm/xterm/css/xterm.css'

function readTerminalBgImage(): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--terminal-bg-image').trim()
  } catch {
    return ''
  }
}

function readForceDomRenderer(): boolean {
  try {
    return localStorage.getItem('vibe-ide-force-dom-renderer') === '1'
  } catch {
    return false
  }
}

interface TerminalViewProps {
  sessionId: string
  sessionName?: string
  sessionCwd?: string
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  onCommand?: (command: string) => void
  showHeader?: boolean
  fontSize?: number
  fontFamily?: string
  isAux?: boolean
  isActive?: boolean
  onAgentStatusChange?: (sessionId: string, status: 'running' | 'idle') => void
  onOscTitle?: (sessionId: string, title: string) => void
  ocrEnabled?: boolean
  newlineShortcut?: string // e.g. "Shift+Enter"
  pageDownShortcut?: string // e.g. "PageDown"
  pageUpShortcut?: string // e.g. "PageUp"
}

export interface TerminalViewHandle {
  focus: () => void
  clearBuffer: () => void
  appendText: (text: string) => void
}


/**
 * 解析路径文本并尝试打开文件
 * - 先用 parseFilePath 解析
 * - 直接读文件，成功则跳转
 * - 若失败且原始文本是裸文件名，递归搜索 cwd 子目录
 * - 搜索唯一匹配则跳转，否则静默失败（不触发 App.tsx ENONET 报错）
 */
async function resolveAndOpenFile(
  rawText: string,
  cwd: string,
  onOpenFile: (fullPath: string, lineNumber?: number) => void,
  onMultipleMatches?: (matches: string[], lineNumber?: number) => void
): Promise<boolean> {
  const parsed = parseFilePath(rawText, cwd)
  if (!parsed) return false

  // 尝试直接读文件验证路径存在
  try {
    const result = await window.api.file.read(parsed.fullPath)
    if (!result.error) {
      onOpenFile(parsed.fullPath, parsed.lineNumber)
      return true
    }
    // 文件存在但不可读（超大/二进制）→ 仍打开，DiffViewer 会展示 Force Open 按钮
    if (result.error.startsWith('File too large') || result.error === 'Cannot display binary file') {
      onOpenFile(parsed.fullPath, parsed.lineNumber)
      return true
    }
  } catch {
    // 读失败，继续尝试搜索
  }

  // 直接路径不存在 → 检查是否为裸文件名，递归搜索
  // 从 parseFilePath 已清理的 fullPath 中提取文件名，避免 rawText 尾部标点干扰搜索
  const cleanFileName = parsed.fullPath.split(/[\\\/]/).pop() || ''

  if (isBareFilename(cleanFileName) && cwd) {
    try {
      const findResult = await window.api.file.find(cwd, cleanFileName, loadFilterRules())
      if (findResult.matches) {
        if (findResult.matches.length === 1) {
          onOpenFile(findResult.matches[0], parsed.lineNumber)
          return true
        }
        if (findResult.matches.length >= 2) {
          onMultipleMatches?.(findResult.matches, parsed.lineNumber)
          return true
        }
      }
    } catch {
      // find 不可用（例如 preload 未更新），静默失败
    }
  }

  return false
}

/**
 * Strip ANSI escape codes from terminal output
 */
function stripAnsiForCommand(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // Strip other control chars
}

/**
 * Extract the shell command from a terminal line (prompt + command, or raw input).
 * Returns null only for empty Enter or whitespace-only lines.
 */
function extractShellCommand(line: string): string | null {
  let clean = line.trim()
  if (!clean) return null

  // Try to find a known prompt boundary and strip it
  const promptEnds = [
    '> ', '$ ', '# ', '] ', ') ', '❯ ', '┃ ', '▶ ', '→ ', 'λ ',
    '>', '$', '#', ']', ')', '❯', '┃', '▶', '→', 'λ'
  ]
  let bestIdx = -1
  let bestLen = 0

  for (const end of promptEnds) {
    const idx = clean.lastIndexOf(end)
    if (idx > bestIdx || (idx === bestIdx && end.length > bestLen)) {
      bestIdx = idx
      bestLen = end.length
    }
  }

  if (bestIdx >= 0) {
    const after = clean.slice(bestIdx + bestLen).trim()
    // Non-empty text after prompt → real command
    if (after && !/^[%<>❯┃▶→λ\s]*$/.test(after)) return after
    // Prompt found but nothing after → empty Enter, skip
    return null
  }

  // No known prompt — return the whole stripped line (e.g. Claude Code, custom prompts)
  if (/^[%<>❯┃▶→λ\s]*$/.test(clean)) return null
  return clean
}

/**
 * 将行字符串中的字符索引映射到 terminal buffer 的 cell 位置（1-based）
 * 正确处理 CJK 宽字符（width=2 占 2 cell）和 width=0 的尾随 cell
 */
function mapStringIndexToCell(line: IBufferLine, stringIndex: number): number {
  let cellX = 0
  let strIdx = 0
  for (let i = 0; i < line.length && strIdx <= stringIndex; i++) {
    const cell = line.getCell(i)
    if (!cell) continue
    const width = cell.getWidth()
    if (width === 0) continue
    if (strIdx === stringIndex) return cellX + 1
    strIdx += cell.getChars().length || 1
    cellX += width
  }
  return cellX + 1
}

/**
 * 自定义链接提供者，用于检测文件路径并提供点击跳转
 */
class FileLinkProvider implements ILinkProvider {
  private _terminal: Terminal
  private _cwd: string
  private _onOpenFile: (fullPath: string, lineNumber?: number) => void
  private _onShowFilePicker?: (matches: string[], lineNumber?: number) => void

  constructor(
    terminal: Terminal,
    cwd: string,
    onOpenFile: (fullPath: string, lineNumber?: number) => void,
    onShowFilePicker?: (matches: string[], lineNumber?: number) => void
  ) {
    this._terminal = terminal
    this._cwd = cwd
    this._onOpenFile = onOpenFile
    this._onShowFilePicker = onShowFilePicker
  }

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const links: ILink[] = []

    // 获取当前行的文本
    const line = this._terminal.buffer.active.getLine(y - 1)
    if (!line) {
      callback(undefined)
      return
    }

    const lineText = line.translateToString(true)
    if (!lineText) {
      callback(undefined)
      return
    }

    // 重置正则并匹配
    FILE_PATH_REGEX.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = FILE_PATH_REGEX.exec(lineText)) !== null) {
      const matchedText = match[0]
      const startIndex = match.index

      // 跳过 URL（http/https/ftp 等），交给 WebLinksAddon 处理
      if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(matchedText)) continue

      // 解析路径
      const parsed = parseFilePath(matchedText, this._cwd)
      if (!parsed) continue

      const startX = mapStringIndexToCell(line, startIndex)
      const endX = mapStringIndexToCell(line, startIndex + matchedText.length)

      const range: IBufferRange = {
        start: { x: startX, y: y },
        end: { x: endX, y: y }
      }

      const link: ILink = {
        range,
        text: matchedText,
        activate: (_event: MouseEvent, _text: string) => {
          resolveAndOpenFile(matchedText, this._cwd, this._onOpenFile, this._onShowFilePicker)
        },
        hover: (_event: MouseEvent, _text: string) => {
          // 可以在这里添加 tooltip 提示
        },
        leave: (_event: MouseEvent, _text: string) => {
          // 清理 hover 状态
        },
        decorations: {
          pointerCursor: true,
          underline: true
        }
      }

      links.push(link)
    }

    callback(links.length > 0 ? links : undefined)
  }
}

const DETECTION_DELAY = 2000  // term 启动 2s 后开始检测
const IDLE_THRESHOLD = 1000   // 2秒无输出 → 判空闲
const RUNNING_DEBOUNCE = 1000  // 3s 连续输出 → 切忙碌
// OSC 标题检测正则（模块级常量，避免每次 onData 重新编译）
// 匹配 OSC 0 (图标+标题) / OSC 1 (图标) / OSC 2 (窗口标题)
const OSC_TITLE_RE = /\x1b\](0|1|2);([^\x07\x1b]*?)(\x07|\x1b\\)/g

/**
 * 🧘 过滤所有 ANSI escape 序列（CSI/OSC/回退符），同时提取 OSC 标题
 * 一次正则扫描完成 strip + 标题提取，避免重复遍历
 */
function stripAnsiAndExtractOscTitle(data: string): { clean: string; oscTitle: string | null } {
  let oscTitle: string | null = null
  const clean = data
    .replace(/\x1b\[[\x20-\x3F]*[\x40-\x7E]/g, '')  // CSI
    .replace(OSC_TITLE_RE, (_m, _code, text) => {
      if (!oscTitle) oscTitle = text.trim()  // 取第一个 OSC 标题
      return ''
    })
    .replace(/[\b\x08]/g, '')                // 回退符
  return { clean, oscTitle }
}

function stripAnsiEscapes(data: string): string {
  return stripAnsiAndExtractOscTitle(data).clean
}

function hasPrompt(lineText: string): boolean {
  return lineText.startsWith('> ')
}

function findPrevPrompt(buf: IBuffer, fromY: number): number {
  for (let y = fromY; y >= 0; y--) {
    const line = buf.getLine(y)
    if (line && hasPrompt(line.translateToString(true))) return y
  }
  return -1
}

function findNextPrompt(buf: IBuffer, fromY: number): number {
  for (let y = fromY; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (line && hasPrompt(line.translateToString(true))) return y
  }
  return -1
}

const TerminalView = React.memo(forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ sessionId, sessionName, sessionCwd, onOpenFile, onCommand, showHeader = true, fontSize = 14, fontFamily = 'Cascadia Code', isAux = false, isActive = true, ocrEnabled = true, onAgentStatusChange, onOscTitle, newlineShortcut = 'Shift+Enter', pageDownShortcut = 'PageDown', pageUpShortcut = 'PageUp'}: TerminalViewProps, ref) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const searchDecoRef = useRef<any>({})
  const [bgImage] = useState(() => isAux ? '' : readTerminalBgImage())
  const [forceDomRenderer] = useState(() => !isAux && readForceDomRenderer())
  const [searchState, setSearchState] = useState<{ visible: boolean; query: string; index: number; count: number } | null>(null)
  const searchStateRef = useRef(searchState)
  searchStateRef.current = searchState
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dataHandlerRef = useRef<any>(null)
  const exitHandlerRef = useRef<any>(null)
  const linkProviderRef = useRef<any>(null)
  const [isReady, setIsReady] = useState(false)
  const { theme: currentTheme } = useTheme()
  const newlineShortcutRef = useRef(newlineShortcut)
  newlineShortcutRef.current = newlineShortcut
  const pageDownShortcutRef = useRef(pageDownShortcut)
  pageDownShortcutRef.current = pageDownShortcut
  const pageUpShortcutRef = useRef(pageUpShortcut)
  pageUpShortcutRef.current = pageUpShortcut
  const onOscTitleRef = useRef(onOscTitle)
  onOscTitleRef.current = onOscTitle
  const onAgentStatusChangeRef = useRef(onAgentStatusChange)
  onAgentStatusChangeRef.current = onAgentStatusChange
  // File picker modal — ref ensures fresh callback without effect re-runs
  const [filePicker, setFilePicker] = useState<{
    matches: string[]
    lineNumber?: number
  } | null>(null)
  const filePickerRef = useRef<((matches: string[], lineNumber?: number) => void) | null>(null)
  filePickerRef.current = (matches: string[], lineNumber?: number) => {
    setFilePicker({ matches: matches.slice(0, 10), lineNumber })
  }
  const detectionReadyRef = useRef(false)    // 1s 延时后才开始检测
  const lastPromptJumpRef = useRef<number>(-1) // Alt+↑↓ 上次跳转到的提示行索引
  const lastOutputRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef<'running' | 'idle'>('idle')
  const activationStartRef = useRef(0)

  const mountedRef = useRef(false)

  const ocrEnabledRef = useRef(ocrEnabled)
  ocrEnabledRef.current = ocrEnabled

  // OCR drag-and-drop state
  const [ocrState, setOcrState] = useState<'idle' | 'dragover' | 'processing' | 'success' | 'error'>('idle')
  const [ocrMessage, setOcrMessage] = useState('')
  const ocrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearOcrTimer = useCallback(() => {
    if (ocrTimerRef.current) { clearTimeout(ocrTimerRef.current); ocrTimerRef.current = null }
  }, [])

  const pasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            const file = new File([blob], `clipboard.${type.split('/')[1] || 'png'}`, { type })
            setOcrState('processing')
            try {
              const text = await window.api.ocr.recognize(
                (file as any).path
                  ? (file as any).path as string
                  : { buffer: new Uint8Array(await file.arrayBuffer()), name: file.name }
              )
              if (!mountedRef.current) return
              const sanitized = text.replace(/[\r\n]+/g, ' ').trim()
              if (sanitized) {
                xtermRef.current?.paste(sanitized)
                setOcrMessage(sanitized.slice(0, 120))
                setOcrState('success')
                ocrTimerRef.current = setTimeout(() => { setOcrState('idle'); setOcrMessage('') }, 600)
              } else {
                setOcrMessage('No text found')
                setOcrState('error')
                ocrTimerRef.current = setTimeout(() => { setOcrState('idle'); setOcrMessage('') }, 1500)
              }
            } catch (err: any) {
              if (!mountedRef.current) return
              setOcrMessage(err.message || 'OCR failed')
              setOcrState('error')
              ocrTimerRef.current = setTimeout(() => { setOcrState('idle'); setOcrMessage('') }, 1500)
            }
            return true
          }
        }
      }
      // No image → return false so caller can fallback to text paste
      return false
    } catch {
      return false
    }
  }, [])

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.ico', '.svg'])

  const findDropImage = (files: FileList): File | null => {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const isImage = f.type.startsWith('image/')
        || IMAGE_EXTS.has('.' + f.name.split('.').pop()?.toLowerCase())
      if (isImage) return f
    }
    return null
  }

  useImperativeHandle(ref, () => ({
    focus: () => {
      xtermRef.current?.focus()
    },
    clearBuffer: () => {
      const term = xtermRef.current
      if (!term) return
      if (term.buffer.active.type === 'alternate') return

      const origCols = term.cols
      const origRows = term.rows

      term.resize(origCols, 1)
      window.api.terminal.resize(sessionId, origCols, 1)

      term.clear()
      term.write('\x1b[3J')

      term.resize(origCols, origRows)
      window.api.terminal.resize(sessionId, origCols, origRows)
      try { fitAddonRef.current?.fit() } catch {}
      try { searchAddonRef.current?.clearDecorations() } catch {}
    },
    appendText: (text: string) => {
      const term = xtermRef.current
      if (!term) return
      const buf = term.buffer.active
      const line = buf.getLine(buf.cursorY)?.translateToString(true) ?? ''
      const sep = line.trim() ? '; ' : ''
      term.paste(sep + text)
    }
  }), [])

  // Initialize xterm.js
  useEffect(() => {
    mountedRef.current = true
    if (!terminalRef.current) return

    // Clean up previous terminal
    if (xtermRef.current) {
      xtermRef.current.dispose()
    }

    const termBgOverride = terminalRef.current
      ? getComputedStyle(terminalRef.current).getPropertyValue('--term-bg').trim()
      : ''
    const termBackground = termBgOverride ? `rgb(${termBgOverride})` : currentTheme.terminal.background
    const term = new Terminal({
      theme: bgImage ? { ...currentTheme.terminal, background: 'transparent' } : { ...currentTheme.terminal, background: termBackground },
      fontFamily: `${fontFamily}, Consolas, JetBrains Mono, Fira Code, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, monospace`,
      fontSize,
      fontWeight: currentTheme.terminal.fontWeight || '400',
      letterSpacing: 0,
      lineHeight: 1.0,
      cursorBlink: false,
      cursorStyle: 'bar',
      scrollback: isAux ? 500 : 10000,
      allowTransparency: bgImage ? true : (currentTheme.terminal.allowTransparency ?? true),
      allowProposedApi: true,
      drawBoldTextInBrightColors: false,
      rescaleOverlappingGlyphs: true,
    } as any)

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    const clipboardAddon = new ClipboardAddon()
    term.loadAddon(clipboardAddon)

    const unicodeGraphemesAddon = new UnicodeGraphemesAddon()
    term.loadAddon(unicodeGraphemesAddon)

    // aux terminal skips URL linking, search, and file-path linking — saves CPU & memory
    let searchResultDisposer: { dispose(): void } | null = null
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      if ((window as any).__vibeBrowse) (window as any).__vibeBrowse(uri)
      else window.open(uri, '_blank')
    })
    term.loadAddon(webLinksAddon)

    if (!isAux) {
      const searchAddon = new SearchAddon()
      searchAddonRef.current = searchAddon
      searchResultDisposer = searchAddon.onDidChangeResults((r: { resultIndex: number; resultCount: number }) => {
        setSearchState(prev => prev ? { ...prev, index: r.resultIndex, count: r.resultCount } : prev)
      })
      term.loadAddon(searchAddon)
    }

    // WebGL 渲染器在 term.open 之前挂载 → 从首帧起即为 renderer。
    // 若在 open 之后挂载(canvas 已画过),canvas→WebGL 切换会对已有 buffer 首帧渲染乱码,
    // 直到下一次 resize/refresh 才恢复 —— 即"第一次打开乱码、最大化最小化后正常"bug。
    if (!forceDomRenderer) {
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          webglAddon.dispose()
          if (webglAddonRef.current === webglAddon) webglAddonRef.current = null
          term.refresh(0, term.rows - 1)
        })
        term.loadAddon(webglAddon)
        webglAddonRef.current = webglAddon
      } catch {
        // WebGL 不可用 → 回退内置 canvas 渲染器
      }
    }

    term.open(terminalRef.current)
    fitAddon.fit()

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit()
          xtermRef.current.refresh(0, xtermRef.current.rows - 1)
        }
      })
    })

    // 聚焦感知光标闪烁：失焦时静默以降低空闲渲染开销
    let textareaEl: HTMLTextAreaElement | undefined
    const onTextareaFocus = () => { term.options.cursorBlink = true }
    const onTextareaBlur = () => { term.options.cursorBlink = false }
    const onWindowBlur = () => { term.options.cursorBlink = false }
    const onWindowFocus = () => {
      if (document.activeElement === textareaEl) {
        term.options.cursorBlink = true
      }
    }
    if (term.textarea) {
      textareaEl = term.textarea
      textareaEl.addEventListener('focus', onTextareaFocus)
      textareaEl.addEventListener('blur', onTextareaBlur)
    }
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('focus', onWindowFocus)

    xtermRef.current = term
    fitAddonRef.current = fitAddon
    setIsReady(true)

    // Custom key bindings: newline (configurable), Ctrl+C → copy selection
    // Must use DOM capture to intercept before xterm.js's internal handlers
    const onKeyDown = (e: KeyboardEvent) => {
      // Terminal search bar: Escape closes it, Alt+F toggles it (skip for aux)
      if (!isAux && searchStateRef.current?.visible) {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopImmediatePropagation()
          searchAddonRef.current?.clearDecorations()
          setSearchState(null)
          return
        }
      }
      const bindings = getShortcuts()
      if (!isAux && eventMatchesBinding(e, bindings['terminal.search'])) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (searchStateRef.current?.visible) {
          searchAddonRef.current?.clearDecorations()
          setSearchState(null)
        } else {
          setSearchState({ visible: true, query: '', index: 0, count: 0 })
        }
        return
      }
      if (eventMatchesBinding(e, newlineShortcutRef.current)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        window.api.terminal.write(sessionId, '\x1b\r')
        return
      }
      // 📜 翻页快捷键：有滚动条时操作视口，无滚动条时透传 PTY（shell 自有行为）
      //    baseY > 0 表示用户已向上滚动，此时 buffer 一定有 scrollback
      //    不在最底部时 pageDown 翻页；已在最底部则放行，避免吞掉 shell 的 history 键
      if (eventMatchesBinding(e, pageDownShortcutRef.current)) {
        if (term.buffer.active.baseY > 0) {
          e.preventDefault()
          e.stopImmediatePropagation()
          term.scrollLines(term.rows - 1)
          return
        }
        // baseY === 0 已在最底部 → 不做拦截，让 xterm 把 \x1b[6~ 发给 PTY
      }
      //    length > rows 意味着内容超出一屏，存在滚动条；一屏内则透传给 shell
      if (eventMatchesBinding(e, pageUpShortcutRef.current)) {
        if (term.buffer.active.length > term.rows) {
          e.preventDefault()
          e.stopImmediatePropagation()
          term.scrollLines(-(term.rows - 1))
          return
        }
        // 缓冲区不足一屏 → 不做拦截，让 xterm 把 \x1b[5~ 发给 PTY
      }
      // Alt+Up/Down: jump between shell prompt lines
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
          e.preventDefault()
          e.stopImmediatePropagation()
          const buf = term.buffer.active
          if (e.code === 'ArrowUp') {
            const fromY = lastPromptJumpRef.current >= 0
              ? lastPromptJumpRef.current - 1
              : buf.viewportY + buf.cursorY - 1
            if (fromY >= 0) {
              const targetY = findPrevPrompt(buf, fromY)
              if (targetY >= 0) {
                lastPromptJumpRef.current = targetY
                term.scrollLines(Math.max(0, targetY - Math.floor(term.rows / 3)) - buf.viewportY)
                return
              }
            }
          } else {
            const fromY = lastPromptJumpRef.current >= 0
              ? lastPromptJumpRef.current + 1
              : buf.viewportY + buf.cursorY + 1
            if (fromY < buf.length) {
              const targetY = findNextPrompt(buf, fromY)
              if (targetY >= 0) {
                lastPromptJumpRef.current = targetY
                term.scrollLines(Math.max(0, targetY - Math.floor(term.rows / 3)) - buf.viewportY)
                return
              }
            }
          }
        }
      }
      if (e.key.toLowerCase() === 'c' && e.ctrlKey && !e.metaKey) {
        const sel = term.getSelection()
        if (sel) {
          e.preventDefault()
          e.stopImmediatePropagation()
          navigator.clipboard.writeText(sel).catch(() => {})
        }
      }
      // Ctrl+V: check clipboard for image → OCR, fallback to text paste
      if (e.key.toLowerCase() === 'v' && e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ;(async () => {
          if (ocrEnabledRef.current) {
            const didOcr = await pasteFromClipboard()
            if (didOcr) return
          }
          try {
            const text = await navigator.clipboard.readText()
            if (text) xtermRef.current?.paste(text)
          } catch {}
        })()
        return
      }
    }
    terminalRef.current?.addEventListener('keydown', onKeyDown, true)

    // OCR drag/drop handlers — capture phase to intercept before xterm.js textarea
    // Uses dragover timer approach: dragover fires ~every 200ms while dragging over element.
    // When the mouse leaves, dragover stops firing, timer expires, overlay hides.
    const el = terminalRef.current
    let dragHideTimer: ReturnType<typeof setTimeout> | null = null

    const isFileDrag = (e: DragEvent) =>
      e.dataTransfer?.types.includes('Files') || (e.dataTransfer?.files && e.dataTransfer.files.length > 0)

    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      if (dragHideTimer) { clearTimeout(dragHideTimer); dragHideTimer = null }
      setOcrState('dragover')
    }

    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (dragHideTimer) { clearTimeout(dragHideTimer); dragHideTimer = null }
      setOcrState('idle')
      clearOcrTimer()

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      const file = findDropImage(files)
      if (!file || !ocrEnabledRef.current) return

      setOcrState('processing')
      try {
        const filePath = (file as any).path as string | undefined
        const text = filePath
          ? await window.api.ocr.recognize(filePath)
          : await window.api.ocr.recognize({ buffer: new Uint8Array(await file.arrayBuffer()), name: file.name })
        if (!mountedRef.current) return
        const sanitized = text.replace(/[\r\n]+/g, ' ').trim()
        if (sanitized) {
          xtermRef.current?.paste(sanitized)
          setOcrMessage(sanitized.slice(0, 120))
          setOcrState('success')
          ocrTimerRef.current = setTimeout(() => { setOcrState('idle'); setOcrMessage('') }, 600)
        } else {
          setOcrMessage('No text found in image')
          setOcrState('error')
          ocrTimerRef.current = setTimeout(() => { setOcrState('idle'); setOcrMessage('') }, 1500)
        }
      } catch (err: any) {
        if (!mountedRef.current) return
        setOcrMessage(err.message || 'OCR failed')
        setOcrState('error')
        ocrTimerRef.current = setTimeout(() => { setOcrState('idle'); setOcrMessage('') }, 1500)
      }
    }

    // Cleanup timer when drag leaves the terminal area
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      // Ignore if relatedTarget is still within the terminal container
      const rt = e.relatedTarget
      if (rt instanceof Node && el?.contains(rt)) return
      dragHideTimer = setTimeout(() => {
        setOcrState('idle')
        dragHideTimer = null
      }, 200)
    }

    if (el && !isAux) {
      el.addEventListener('dragover', onDragOver, true)
      el.addEventListener('dragleave', onDragLeave, true)
      el.addEventListener('drop', onDrop, true)
    }

    // Handle terminal data input
    term.onData((data: string) => {
      // 丢弃焦点 in/out (\x1b[I/\x1b[O)：转发给 pty 会被 shell 回显成 [I/[O 垃圾
      if (data !== '\x1b[I' && data !== '\x1b[O') {
        window.api.terminal.write(sessionId, data)
      }

      // Track commands by reading xterm buffer on Enter (uses echoed text, not raw keystrokes)
      if (onCommand) {
        for (const ch of data) {
          if (ch === '\r') {
            const buffer = term.buffer.active
            // Skip command extraction when in alternate screen (TUI apps: vim, htop, etc.)
            if (buffer.type === 'alternate') continue
            const cursorY = buffer.baseY + buffer.cursorY
            const line = buffer.getLine(cursorY)
            if (line) {
              const lineText = line.translateToString(true)
              const clean = stripAnsiForCommand(lineText)
              const cmd = extractShellCommand(clean)
              if (cmd) onCommand(cmd)
            }
          }
        }
      }
    })

    // Handle resize — double rAF ensures layout is settled before measuring
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current) {
          try {
            const rect = terminalRef.current?.getBoundingClientRect()
            if (!rect || rect.width === 0 || rect.height === 0) return
            fitAddonRef.current.fit()
            window.api.terminal.resize(sessionId, xtermRef.current.cols, xtermRef.current.rows)
          } catch (e) {
            // Ignore fit errors during resize
          }
        }
        resizeTimer = null
      }, 300)
    }

    window.addEventListener('resize', onResize)

    return () => {
      mountedRef.current = false
      if (dragHideTimer) clearTimeout(dragHideTimer)
      if (el) {
        el.removeEventListener('keydown', onKeyDown, true)
        el.removeEventListener('dragover', onDragOver, true)
        el.removeEventListener('dragleave', onDragLeave, true)
        el.removeEventListener('drop', onDrop, true)
      }
      window.removeEventListener('resize', onResize)
      if (resizeTimer) clearTimeout(resizeTimer)
      if (textareaEl) {
        textareaEl.removeEventListener('focus', onTextareaFocus)
        textareaEl.removeEventListener('blur', onTextareaBlur)
      }
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      if (ocrTimerRef.current) { clearTimeout(ocrTimerRef.current); ocrTimerRef.current = null }
      searchResultDisposer?.dispose?.()
      if (webglAddonRef.current) {
        try { webglAddonRef.current.dispose() } catch {}
        webglAddonRef.current = null
      }
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      setIsReady(false)
    }
  }, []) // Initialize once

  // Update terminal theme when it changes
  useEffect(() => {
    if (xtermRef.current) {
      const termBgOverride = terminalRef.current
        ? getComputedStyle(terminalRef.current).getPropertyValue('--term-bg').trim()
        : ''
      const termBackground = termBgOverride ? `rgb(${termBgOverride})` : currentTheme.terminal.background
      xtermRef.current.options.theme = bgImage
        ? { ...currentTheme.terminal, background: 'transparent' }
        : { ...currentTheme.terminal, background: termBackground }
      xtermRef.current.options.allowTransparency = bgImage ? true : (currentTheme.terminal.allowTransparency ?? true)
      xtermRef.current.options.fontWeight = currentTheme.terminal.fontWeight || '400'
      if (!bgImage) {
        const el = terminalRef.current?.querySelector('.xterm') as HTMLElement | null
        if (el) el.style.backgroundColor = termBackground
        const vp = terminalRef.current?.querySelector('.xterm-viewport') as HTMLElement | null
        if (vp) vp.style.backgroundColor = termBackground
      }
    }
  }, [currentTheme])

  // 切回 session 时 display:none→flex，需恢复尺寸 + 重建可能丢失的 WebGL context
  useEffect(() => {
    if (!isActive || !xtermRef.current || !isReady) return
    const term = xtermRef.current

    if (!forceDomRenderer && !webglAddonRef.current) {
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          webglAddon.dispose()
          if (webglAddonRef.current === webglAddon) webglAddonRef.current = null
          term.refresh(0, term.rows - 1)
        })
        term.loadAddon(webglAddon)
        webglAddonRef.current = webglAddon
      } catch {}
    }

    try { fitAddonRef.current?.fit() } catch {}
    try { term.clearTextureAtlas() } catch {}
    term.refresh(0, term.rows - 1)
  }, [isActive, isReady])

  // Update font size dynamically without recreating terminal
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize
      try { fitAddonRef.current?.fit() } catch {}
    }
  }, [fontSize])
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontFamily = `${fontFamily}, Consolas, JetBrains Mono, Fira Code, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, monospace`
      try { fitAddonRef.current?.fit() } catch {}
    }
  }, [fontFamily])

  // Listen for terminal data from PTY
  useEffect(() => {
    if (!xtermRef.current || !isReady) return

    // Remove only our own previous listeners
    if (dataHandlerRef.current) {
      window.api.terminal.removeDataListener(dataHandlerRef.current)
    }
    if (exitHandlerRef.current) {
      window.api.terminal.removeExitListener(exitHandlerRef.current)
    }

    prevStatusRef.current = 'idle'
    activationStartRef.current = 0
    lastOutputRef.current = 0
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }

    // Register new listeners and store handlers for cleanup
    dataHandlerRef.current = window.api.terminal.onData((data: { id: string; data: string }) => {
      if (data.id === sessionId && xtermRef.current) {
        xtermRef.current.write(data.data)

        // Agent idle detection + OSC title extraction (main terminals only)
        // 一次 stripAnsiAndExtractOscTitle 同时完成 OSC 标题提取和 ANSI strip，避免重复正则扫描
        if (!isAux && (onAgentStatusChangeRef.current || onOscTitleRef.current) && detectionReadyRef.current) {
          const { clean, oscTitle } = stripAnsiAndExtractOscTitle(data.data)

          // OSC 标题 → 通知父组件
          if (oscTitle && onOscTitleRef.current) {
            onOscTitleRef.current(sessionId, oscTitle)
          }

          // Idle 检测
          if (onAgentStatusChangeRef.current && clean.trim()) {

            lastOutputRef.current = Date.now()
            const wasIdle = prevStatusRef.current === 'idle'

            // 🌀 累计活动达 RUNNING_DEBOUNCE → running
            if (wasIdle) {
              if (activationStartRef.current === 0) {
                activationStartRef.current = Date.now()
              }
              if (Date.now() - activationStartRef.current >= RUNNING_DEBOUNCE) {
                prevStatusRef.current = 'running'
                activationStartRef.current = 0
                onAgentStatusChangeRef.current(sessionId, 'running')
              }
            }

            // 🔄 重置静默定时器：停止输出 IDLE_THRESHOLD 后 → idle
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
            idleTimerRef.current = setTimeout(() => {
              if (Date.now() - lastOutputRef.current >= IDLE_THRESHOLD) {
                prevStatusRef.current = 'idle'
                onAgentStatusChangeRef.current!(sessionId, 'idle')
              }
              if (activationStartRef.current > 0 &&
                  Date.now() - lastOutputRef.current >= IDLE_THRESHOLD + RUNNING_DEBOUNCE) {
                activationStartRef.current = 0
              }
              idleTimerRef.current = null
            }, IDLE_THRESHOLD)
          }
        }
      }
    })

    exitHandlerRef.current = window.api.terminal.onExit((data: { id: string; exitCode: number }) => {
      if (data.id === sessionId && xtermRef.current) {
        const term = xtermRef.current
        // Restore xterm out of any TUI leftover state a force-killed TUI failed to reset
        // (alt screen / hidden cursor / mouse tracking), then show exit line.
        term.write('\x1b[?1049l\x1b[?25h\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1l\x1b[0m')
        const code = data.exitCode
        const suffix = (code === undefined || code === null) ? '' : ` with code ${code}`
        term.write(`\r\n[Process exited${suffix}]\r\n`)
      }
    })

    // Resize PTY to match terminal dimensions
    if (xtermRef.current) {
      window.api.terminal.resize(sessionId, xtermRef.current.cols, xtermRef.current.rows)
    }

    // 🌀 延时 1s 后开启检测（避免终端初始化数据误触发）
    detectionReadyRef.current = false
    const detectionTimer = setTimeout(() => {
      detectionReadyRef.current = true
    }, DETECTION_DELAY)

    return () => {
      onAgentStatusChangeRef.current?.(sessionId, 'idle')
      if (dataHandlerRef.current) {
        window.api.terminal.removeDataListener(dataHandlerRef.current)
        dataHandlerRef.current = null
      }
      if (exitHandlerRef.current) {
        window.api.terminal.removeExitListener(exitHandlerRef.current)
        exitHandlerRef.current = null
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
      clearTimeout(detectionTimer)
    }
  }, [sessionId, isReady])

  // Register file link provider when terminal is ready (skip for aux)
  useEffect(() => {
    if (!xtermRef.current || !isReady || !onOpenFile || isAux) return

    // 清理之前的 link provider
    if (linkProviderRef.current) {
      linkProviderRef.current.dispose()
    }

    // 注册新的 FileLinkProvider
    const provider = new FileLinkProvider(
      xtermRef.current,
      sessionCwd || '',
      onOpenFile,
      filePickerRef.current ?? undefined
    )
    linkProviderRef.current = xtermRef.current.registerLinkProvider(provider)

    return () => {
      if (linkProviderRef.current) {
        linkProviderRef.current.dispose()
        linkProviderRef.current = null
      }
    }
  }, [sessionCwd, isReady, onOpenFile])

  // 选中文本跳转：mousedown 时若有选中文字且匹配路径正则，则跳转
  useEffect(() => {
    if (!terminalRef.current || !isReady || !onOpenFile) return

    const handleMouseDown = (e: MouseEvent) => {
      const term = xtermRef.current
      if (!term) return
      if (e.button !== 0) return

      const selection = term.getSelection()
      if (!selection) return

      const trimmed = selection.trim()
      if (!trimmed) return

      const cwd = sessionCwd || ''
      const parsed = parseFilePath(trimmed, cwd)
      if (!parsed) return

      e.preventDefault()
      e.stopPropagation()
      term.clearSelection()
      resolveAndOpenFile(trimmed, cwd, onOpenFile, filePickerRef.current ?? undefined)
    }

    const el = terminalRef.current
    el.addEventListener('mousedown', handleMouseDown, true)
    return () => el.removeEventListener('mousedown', handleMouseDown, true)
  }, [sessionCwd, isReady, onOpenFile])

  // Escape 键关闭文件选择器（capture 阶段拦截，防止 Esc 传递到终端）
  useEffect(() => {
    if (!filePicker) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setFilePicker(null)
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [filePicker])

  // Auto-fit on mount and when container resizes (debounced 100ms)
  useEffect(() => {
    if (!fitAddonRef.current) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let prevCols = 0
    let prevRows = 0
    const observer = new ResizeObserver(() => {
      if (!fitAddonRef.current || !xtermRef.current) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          const rect = terminalRef.current?.getBoundingClientRect()
          if (!rect || rect.width === 0 || rect.height === 0) return
          fitAddonRef.current!.fit()
          const c = xtermRef.current!.cols
          const r = xtermRef.current!.rows
          if (c !== prevCols || r !== prevRows) {
            prevCols = c
            prevRows = r
            window.api.terminal.resize(sessionId, c, r)
          }
        } catch (e) {
          // Ignore
        }
      }, 200)
    })

    if (terminalRef.current) {
      observer.observe(terminalRef.current)
    }

    // Initial fit after a small delay to ensure DOM is ready
    setTimeout(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit()
        } catch (e) {
          // Ignore
        }
      }
    }, 100)

    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [isReady])

  // Handle right-click: copy selection / paste clipboard
  const handleContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!xtermRef.current) return

    const sel = xtermRef.current.getSelection()
    if (sel) {
      try { await navigator.clipboard.writeText(sel) } catch {}
    } else {
      if (ocrEnabled) {
        const didOcr = await pasteFromClipboard()
        if (didOcr) return
      }
      try {
        const text = await navigator.clipboard.readText()
        if (text) xtermRef.current.paste(text)
      } catch {}
    }
  }, [sessionId, pasteFromClipboard, ocrEnabled])

  useEffect(() => {
    if (searchState?.visible) requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchState?.visible])

  // Sync search highlight colors to current theme
  useEffect(() => {
    const sel = currentTheme.terminal.selectionBackground || 'rgba(124,58,237,0.3)'
    const hex = sel.replace(/rgba?\((\d+),\s*(\d+),\s*(\d+).*/, (_: string, r: string, g: string, b: string) =>
      '#' + [r, g, b].map(x => parseInt(x).toString(16).padStart(2, '0')).join('')
    )
    const cursor = currentTheme.terminal.cursor || '#7c3aed'
    searchDecoRef.current = {
      matchBackground: hex,
      matchBorder: cursor + '66',
      matchOverviewRuler: hex,
      activeMatchBackground: cursor,
      activeMatchBorder: cursor,
      activeMatchColorOverviewRuler: cursor,
    }
  }, [currentTheme])

  const doSearch = useCallback((query: string) => {
    const addon = searchAddonRef.current
    if (!addon || !query) { addon?.clearDecorations(); return }
    addon.findNext(query, { incremental: true, decorations: searchDecoRef.current })
  }, [])

  return (
    <div className="flex flex-col h-full term-view">
      {/* Terminal tab header - 可选显示 */}
      {showHeader && (
        <div className="h-10 px-3 flex items-center border-b border-ide-border shrink-0 bg-ide-sidebar/50 term-view__header">
          <span className="text-sm text-ide-text-muted">{sessionName || sessionId.slice(0, 12)}</span>
          {sessionCwd && <span className="text-xs text-ide-text-muted ml-2 opacity-70 truncate">{sessionCwd}</span>}
        </div>
      )}

      {/* flex-col + flex-1 ensures terminalRef is sized by flex, not by xterm.js content.
          h-full resolves to auto when parent is a flex item without explicit height,
          making terminalRef content-sized → xterm.js stale canvas height prevents shrinking. */}
      <div
        className="flex-1 overflow-hidden flex flex-col relative term-view__canvas"
        onContextMenu={handleContextMenu}
      >
        <div ref={terminalRef} className="flex-1 min-h-0 relative overflow-hidden">
          {/* OCR drag overlay */}
          {ocrState !== 'idle' && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none term-view__ocr-overlay"
              style={{ backgroundColor: currentTheme.terminal.background }}
            >
              <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-xl border shadow-2xl pointer-events-auto"
                style={{
                  backgroundColor: currentTheme.terminal.background,
                  borderColor: ocrState === 'error' ? 'rgba(239,68,68,0.5)'
                    : ocrState === 'success' ? 'rgba(34,197,94,0.5)'
                    : 'var(--ide-border)',
                }}
              >
                {ocrState === 'dragover' && (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-ide-accent">
                      <rect x="3" y="3" width="18" height="18" rx="3"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                    </svg>
                    <span className="text-sm text-ide-text font-medium">Drop image to OCR</span>
                  </>
                )}
                {ocrState === 'processing' && (
                  <>
                    <svg className="w-8 h-8 text-ide-accent animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.25"/>
                      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                    <span className="text-sm text-ide-text">Recognizing text...</span>
                  </>
                )}
                {ocrState === 'success' && (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-emerald-400">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <div className="flex flex-col items-center gap-1 max-w-sm">
                      <span className="text-sm text-emerald-400 font-medium">Text pasted</span>
                      {ocrMessage && (
                        <span className="text-xs text-ide-text-muted text-center truncate max-w-[280px]" title={ocrMessage}>
                          {ocrMessage}
                        </span>
                      )}
                    </div>
                  </>
                )}
                {ocrState === 'error' && (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-red-400">
                      <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round"/>
                    </svg>
                    <span className="text-sm text-red-400">{ocrMessage}</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Terminal search bar — VSCode-style */}
        {searchState?.visible && (
          <div className="absolute top-2 right-3 flex items-center border border-ide-border/60 rounded shadow-md z-10 term-view__search"
            style={{ backgroundColor: currentTheme.terminal.background }}>
            <div className="flex items-center gap-1 px-2 py-0.5">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-ide-text-muted/50 shrink-0">
                <circle cx="6.5" cy="6.5" r="5"/><path d="M10.5 10.5l4 4" strokeLinecap="round"/>
              </svg>
              <input ref={searchInputRef} type="text" value={searchState.query}
                onChange={e => { setSearchState(prev => prev ? { ...prev, query: e.target.value } : null); doSearch(e.target.value) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) searchAddonRef.current?.findPrevious(searchState.query, { decorations: searchDecoRef.current }); else searchAddonRef.current?.findNext(searchState.query, { decorations: searchDecoRef.current }) }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); searchAddonRef.current?.clearDecorations(); setSearchState(null) }
                }}
                placeholder="Crunched"
                className="bg-transparent text-[13px] text-ide-text outline-none w-44 placeholder:text-ide-text-muted/40 term-view__search-input" />
            </div>
            {searchState.count > 0 && (
              <span className="text-[11px] text-ide-text-muted/50 tabular-nums shrink-0 mr-1">
                {searchState.index >= 0 ? searchState.index + 1 : '?'} of {searchState.count}
              </span>
            )}
            <div className="flex items-center border-l border-ide-border/60 pl-0.5 pr-1 gap-0.5 py-0.5">
              <button className="w-5 h-5 flex items-center justify-center rounded text-ide-text-muted/40 hover:text-ide-text hover:bg-ide-hover/60 transition-colors shrink-0"
                onClick={() => searchAddonRef.current?.findPrevious(searchState.query, { decorations: searchDecoRef.current })} title="Previous Match">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5"><polyline points="11 10 7 6 11 2"/></svg>
              </button>
              <button className="w-5 h-5 flex items-center justify-center rounded text-ide-text-muted/40 hover:text-ide-text hover:bg-ide-hover/60 transition-colors shrink-0"
                onClick={() => searchAddonRef.current?.findNext(searchState.query, { decorations: searchDecoRef.current })} title="Next Match">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5"><polyline points="5 2 9 6 5 10"/></svg>
              </button>
              <button className="w-5 h-5 flex items-center justify-center rounded text-ide-text-muted/40 hover:text-ide-text hover:bg-ide-hover/60 transition-colors shrink-0"
                onClick={() => { searchAddonRef.current?.clearDecorations(); setSearchState(null) }} title="Close">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* File Picker Modal — 多文件匹配选择器 */}
      {filePicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 term-view__filepicker"
          onClick={() => setFilePicker(null)}
        >
          <div
            className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[500px] max-h-[400px] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-ide-border shrink-0 flex items-center justify-between">
              <span className="text-sm font-medium text-ide-text">
                {filePicker.matches.length} 个匹配文件
              </span>
              <button
                className="text-ide-text-muted hover:text-ide-text text-lg leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-ide-hover"
                onClick={() => setFilePicker(null)}
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filePicker.matches.map((fullPath) => {
                const cwdNorm = (sessionCwd || '').replace(/\\/g, '/')
                const pathNorm = fullPath.replace(/\\/g, '/')
                const relativePath = cwdNorm
                  ? pathNorm.startsWith(cwdNorm)
                    ? pathNorm.slice(cwdNorm.length).replace(/^\//, '')
                    : pathNorm
                  : pathNorm
                return (
                  <button
                    key={fullPath}
                    className="w-full text-left px-3 py-2 rounded hover:bg-ide-hover transition-colors term-view__filepicker-item"
                    onClick={() => {
                      if (onOpenFile) onOpenFile(fullPath, filePicker.lineNumber)
                      setFilePicker(null)
                    }}
                  >
                    <div className="text-sm text-ide-text truncate">{relativePath}</div>
                    <div className="text-xs text-ide-text-muted truncate mt-0.5">{fullPath}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}))

export default TerminalView