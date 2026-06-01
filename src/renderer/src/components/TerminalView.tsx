import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Terminal, ILinkProvider, ILink, IBufferRange } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { eventMatchesBinding } from '../shortcuts'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { WebglAddon } from '@xterm/addon-webgl'

import { useTheme } from '../themes'
import { loadFilterRules } from './FileTab'
import '@xterm/xterm/css/xterm.css'

// 支持的文件扩展名（可编辑）
const EDITABLE_EXTENSIONS = new Set([
  'txt', 'c', 'py', 'ts', 'tsx', 'js', 'jsx', 'md', 'json', 'html', 'htm',
  'css', 'yaml', 'yml', 'sh', 'bash', 'bat', 'cmd', 'sql', 'log', 'xml',
  'toml', 'ini', 'env', 'rs', 'go', 'java', 'cpp', 'h', 'hpp', 'cs', 'rb',
  'php', 'swift', 'kt', 'vue', 'svelte', 'scss', 'less', 'dockerfile',
  'gitignore', 'cfg', 'conf', 'makefile', 'r', 'm', 'scala', 'clj', 'lua',
  'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'vim', 'editorconfig', 'eslintrc',
  'prettierrc', 'lock', 'gradle', 'properties', 'ps1', 'vbs', 'wren'
])

// Windows 绝对路径: E:\path\file.txt 或 E:/path/file.txt (无空格，空格走引号路径)
// Unix 绝对路径: /home/user/file.ts
// 相对路径: src/file.ts 或 ./src/file.ts 或 ../src/file.ts
// 引号路径: "C:\path with spaces\file.ts" 或 '/home/user/file.ts'
// 支持行号: file.ts:10  支持行:列: file.ts:10:20
const WINDOWS_ABS_PATH = /[A-Za-z]:[\\\/][^\s:*?"<>|\r\n]+/
const UNIX_ABS_PATH = /\/[^\s:*?"<>|\r\n]+\.[a-zA-Z0-9]+/
const RELATIVE_PATH = /(?:\.{1,2}[\\\/]|[a-zA-Z0-9_])[a-zA-Z0-9_\-.\\\/]*[a-zA-Z0-9_\-.]+/
const QUOTED_PATH = /['"]([^'"\r\n]+?)['"]/
const LINE_NUMBER = /:\d+(?::\d+)?/

// 组合正则：匹配路径（可选带行号列号）
const FILE_PATH_REGEX = new RegExp(
  `(?:${QUOTED_PATH.source}|${WINDOWS_ABS_PATH.source}|${UNIX_ABS_PATH.source}|${RELATIVE_PATH.source})(${LINE_NUMBER.source})?`,
  'g'
)

interface TerminalViewProps {
  sessionId: string
  sessionName?: string
  sessionCwd?: string
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
  onCommand?: (command: string) => void
  showHeader?: boolean
  fontSize?: number
  isAux?: boolean
  onAgentStatusChange?: (sessionId: string, status: 'running' | 'idle') => void
  onOscTitle?: (sessionId: string, title: string) => void
  newlineShortcut?: string // e.g. "Shift+Enter"
  pageDownShortcut?: string // e.g. "PageDown"
  pageUpShortcut?: string // e.g. "PageUp"
}

export interface TerminalViewHandle {
  focus: () => void
}

/**
 * 解析路径文本，提取文件路径和行号
 * @param pathText 原始路径文本（可能带引号、行号:10、行:列:10:20）
 * @param cwd 当前工作目录（用于相对路径）
 * @returns { fullPath, lineNumber } 或 null（如果无效）
 */
function parseFilePath(pathText: string, cwd: string): { fullPath: string; lineNumber?: number } | null {
  // 提取行号（如果有）:10 或 :10:20（列号解析但不使用，仅防破坏匹配）
  let lineNumber: number | undefined
  let pathPart = pathText

  const lineMatch = pathText.match(/:(\d+)(?::(\d+))?$/)
  if (lineMatch) {
    lineNumber = parseInt(lineMatch[1], 10)
    pathPart = pathText.slice(0, pathText.length - lineMatch[0].length)
  }

  // 去除首尾引号（含中英文半全角：'' "" ＂＇ "" ''）
  pathPart = pathPart.replace(/^['‘’＇"“”＂]|['‘’＇"“”＂]$/g, '')

  // 剥离尾部标点（终端输出中常紧跟文件路径后，导致扩展名检测失败）
  // 覆盖半角: , ; : ! ? ) ] } > .  全角: 。 ， 、 ； ： ！ ？ ） ］ ｝ 》 〉 】 」 』
  pathPart = pathPart.replace(/[,;:!?\)\]\}>\.。，、；：！？）］｝》〉】」』]+$/g, '')

  // 检查扩展名是否支持
  const extMatch = pathPart.match(/\.(?:([a-zA-Z0-9]+)|([a-zA-Z0-9]+\.[a-zA-Z0-9]+))$/)
  if (!extMatch) return null

  const ext = extMatch[1] || extMatch[2]?.split('.').pop()?.toLowerCase()
  if (!ext || !EDITABLE_EXTENSIONS.has(ext.toLowerCase())) return null

  // 判断是绝对路径还是相对路径
  const isWinAbsolute = /^[A-Za-z]:[\\\/]/.test(pathPart)
  const isUnixAbsolute = /^\//.test(pathPart)

  let fullPath: string
  if (isWinAbsolute) {
    fullPath = pathPart
  } else if (isUnixAbsolute) {
    // Unix 绝对路径直接使用（Node fs 能处理 / 分隔符）
    fullPath = pathPart
  } else if (cwd) {
    // 相对路径，拼接 cwd
    fullPath = cwd.replace(/\\/g, '/') + '/' + pathPart.replace(/\\/g, '/')
  } else {
    return null
  }

  // 统一路径分隔符（Windows 使用反斜杠）
  fullPath = fullPath.replace(/\//g, '\\')

  return { fullPath, lineNumber }
}

/**
 * 判断是否裸文件名（无目录分隔符、无盘符）
 */
function isBareFilename(text: string): boolean {
  return !/[\\\/]/.test(text) && !/^[A-Za-z]:/.test(text)
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

  // 尝试直接读文件
  try {
    const result = await window.api.file.read(parsed.fullPath)
    if (!result.error) {
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
function mapStringIndexToCell(line: import('@xterm/xterm').IBufferLine, stringIndex: number): number {
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
const IDLE_THRESHOLD = 2000   // 2秒无输出 → 判空闲
const RUNNING_DEBOUNCE = 300  // 300ms 连续输出 → 切忙碌
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

const TerminalView = React.memo(forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ sessionId, sessionName, sessionCwd, onOpenFile, onCommand, showHeader = true, fontSize = 14, isAux = false, onAgentStatusChange, onOscTitle, newlineShortcut = 'Shift+Enter', pageDownShortcut = 'PageDown', pageUpShortcut = 'PageUp'}: TerminalViewProps, ref) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
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
  const lastOutputRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef<'running' | 'idle'>('idle')
  const activationStartRef = useRef(0)

  useImperativeHandle(ref, () => ({
    focus: () => {
      xtermRef.current?.focus()
    }
  }), [])

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current) return

    // Clean up previous terminal
    if (xtermRef.current) {
      xtermRef.current.dispose()
    }

    const term = new Terminal({
      theme: currentTheme.terminal,
      fontFamily: 'Cascadia Code, JetBrains Mono, Fira Code, Consolas, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, monospace',
      fontSize,
      fontWeight: currentTheme.terminal.fontWeight || '400',
      letterSpacing: 0,
      lineHeight: 1.0,
      cursorBlink: false,
      cursorStyle: 'bar',
      scrollback: 50000,
      allowTransparency: currentTheme.terminal.allowTransparency ?? true,
      allowProposedApi: true,
      windowsMode: true,
      drawBoldTextInBrightColors: false,
      rescaleOverlappingGlyphs: true,
      customGlyphs: true
    })

    const fitAddon = new FitAddon()
    // 🙏 覆盖默认 handleLink：原实现先 window.open() 再设 location.href，
    // 导致 Electron 的 setWindowOpenHandler 截获 about:blank 而丢弃真实 URL。
    // 此处直接 window.open(uri, '_blank')，让主进程 shell.openExternal 拿到正确链接。
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.open(uri, '_blank')
    })
    const clipboardAddon = new ClipboardAddon()
    const unicodeGraphemesAddon = new UnicodeGraphemesAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(clipboardAddon)
    term.loadAddon(unicodeGraphemesAddon)

    // WebGL 渲染器（与 VSCode 终端策略一致）。
    // 主进程已配置 ANGLE/D3D11 硬件加速 + ignore-gpu-blocklist，
    // 软件 GPU 回退已被禁用。若硬件 GPU 确实不可用，context 创建
    // 会抛异常，catch 回退到内置 DOM 渲染器。
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch {
      // WebGL2 不可用，回退到 DOM 渲染器
    }

    term.open(terminalRef.current)
    fitAddon.fit()

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
      if (e.key === 'c' && e.ctrlKey && !e.metaKey) {
        const sel = term.getSelection()
        if (sel) {
          e.preventDefault()
          e.stopImmediatePropagation()
          navigator.clipboard.writeText(sel).catch(() => {})
        }
      }
    }
    terminalRef.current?.addEventListener('keydown', onKeyDown, true)

    // Handle terminal data input
    term.onData((data: string) => {
      window.api.terminal.write(sessionId, data)

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
      terminalRef.current?.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onResize)
      if (resizeTimer) clearTimeout(resizeTimer)
      if (textareaEl) {
        textareaEl.removeEventListener('focus', onTextareaFocus)
        textareaEl.removeEventListener('blur', onTextareaBlur)
      }
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      setIsReady(false)
    }
  }, []) // Initialize once

  // Update terminal theme when it changes
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = currentTheme.terminal
      xtermRef.current.options.allowTransparency = currentTheme.terminal.allowTransparency ?? true
      xtermRef.current.options.fontWeight = currentTheme.terminal.fontWeight || '400'
      const el = terminalRef.current?.querySelector('.xterm') as HTMLElement | null
      if (el) el.style.backgroundColor = currentTheme.terminal.background
    }
  }, [currentTheme])

  // Update font size dynamically without recreating terminal
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize
      try { fitAddonRef.current?.fit() } catch {}
    }
  }, [fontSize])

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

    // Register new listeners and store handlers for cleanup
    dataHandlerRef.current = window.api.terminal.onData((data: { id: string; data: string }) => {
      if (data.id === sessionId && xtermRef.current) {
        xtermRef.current.write(data.data)

        // Agent idle detection + OSC title extraction (main terminals only)
        // 一次 stripAnsiAndExtractOscTitle 同时完成 OSC 标题提取和 ANSI strip，避免重复正则扫描
        if (!isAux && (onAgentStatusChange || onOscTitleRef.current) && detectionReadyRef.current) {
          const { clean, oscTitle } = stripAnsiAndExtractOscTitle(data.data)

          // OSC 标题 → 通知父组件
          if (oscTitle && onOscTitleRef.current) {
            onOscTitleRef.current(sessionId, oscTitle)
          }

          // Idle 检测
          if (onAgentStatusChange && clean.trim()) {

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
                onAgentStatusChange(sessionId, 'running')
              }
            }

            // 🔄 重置静默定时器：停止输出 IDLE_THRESHOLD 后 → idle
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
            idleTimerRef.current = setTimeout(() => {
              if (Date.now() - lastOutputRef.current >= IDLE_THRESHOLD) {
                prevStatusRef.current = 'idle'
                onAgentStatusChange!(sessionId, 'idle')
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
        xtermRef.current.write(`\r\n[Process exited with code ${data.exitCode}]\r\n`)
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

  // Register file link provider when terminal is ready
  useEffect(() => {
    if (!xtermRef.current || !isReady || !onOpenFile) return

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
      // Has selection → copy to clipboard
      try { await navigator.clipboard.writeText(sel) } catch {}
    } else {
      // No selection → paste clipboard
      try {
        const text = await navigator.clipboard.readText()
        if (text) xtermRef.current.paste(text)
      } catch {}
    }
  }, [sessionId])

  return (
    <div className="flex flex-col h-full">
      {/* Terminal tab header - 可选显示 */}
      {showHeader && (
        <div className="h-10 px-3 flex items-center border-b border-ide-border shrink-0 bg-ide-sidebar/50">
          <span className="text-sm text-ide-text-muted">{sessionName || sessionId.slice(0, 12)}</span>
          {sessionCwd && <span className="text-xs text-ide-text-muted ml-2 opacity-70 truncate">{sessionCwd}</span>}
        </div>
      )}

      {/* flex-col + flex-1 ensures terminalRef is sized by flex, not by xterm.js content.
          h-full resolves to auto when parent is a flex item without explicit height,
          making terminalRef content-sized → xterm.js stale canvas height prevents shrinking. */}
      <div
        className="flex-1 overflow-hidden pt-1 flex flex-col"
        onContextMenu={handleContextMenu}
      >
        <div ref={terminalRef} className="flex-1 min-h-0" />
      </div>

      {/* File Picker Modal — 多文件匹配选择器 */}
      {filePicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
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
                    className="w-full text-left px-3 py-2 rounded hover:bg-ide-hover transition-colors"
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