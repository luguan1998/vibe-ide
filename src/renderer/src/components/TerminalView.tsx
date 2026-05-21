import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Terminal, ILinkProvider, ILink, IBufferRange } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { eventMatchesBinding } from '../shortcuts'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { WebglAddon } from '@xterm/addon-webgl'
import { useTheme } from '../themes'
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

// Windows 绝对路径: E:\path\file.txt 或 E:/path/file.txt
// 相对路径: src/file.ts 或 ./src/file.ts 或 ../src/file.ts
// 支持带行号: file.ts:10
const WINDOWS_ABS_PATH = /[A-Za-z]:[\\\/][^\s:*?"<>|\r\n]+/
const RELATIVE_PATH = /(?:\.{1,2}[\\\/]|[a-zA-Z0-9_])[a-zA-Z0-9_\-.\\\/]*[a-zA-Z0-9_\-.]+/
const LINE_NUMBER = /:\d+/

// 组合正则：匹配路径（可选带行号）
const FILE_PATH_REGEX = new RegExp(
  `(?:${WINDOWS_ABS_PATH.source}|${RELATIVE_PATH.source})(${LINE_NUMBER.source})?`,
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
  onAgentStatusChange?: (sessionId: string, status: 'running' | 'idle' | null) => void
  newlineShortcut?: string // e.g. "Shift+Enter"
}

export interface TerminalViewHandle {
  focus: () => void
}

/**
 * 解析路径文本，提取文件路径和行号
 * @param pathText 原始路径文本（可能包含行号）
 * @param cwd 当前工作目录（用于相对路径）
 * @returns { fullPath, lineNumber } 或 null（如果无效）
 */
function parseFilePath(pathText: string, cwd: string): { fullPath: string; lineNumber?: number } | null {
  // 提取行号（如果有）
  let lineNumber: number | undefined
  let pathPart = pathText

  const lineMatch = pathText.match(/:(\d+)$/)
  if (lineMatch) {
    lineNumber = parseInt(lineMatch[1], 10)
    pathPart = pathText.slice(0, pathText.length - lineMatch[0].length)
  }

  // 检查扩展名是否支持
  const extMatch = pathPart.match(/\.(?:([a-zA-Z0-9]+)|([a-zA-Z0-9]+\.[a-zA-Z0-9]+))$/)
  if (!extMatch) return null

  const ext = extMatch[1] || extMatch[2]?.split('.').pop()?.toLowerCase()
  if (!ext || !EDITABLE_EXTENSIONS.has(ext.toLowerCase())) return null

  // 判断是绝对路径还是相对路径
  const isAbsolute = /^[A-Za-z]:[\\\/]/.test(pathPart)

  let fullPath: string
  if (isAbsolute) {
    fullPath = pathPart
  } else if (cwd) {
    // 相对路径，拼接 cwd
    // 处理 ./ 和 ../
    fullPath = cwd.replace(/\\/g, '/') + '/' + pathPart.replace(/\\/g, '/')
  } else {
    return null
  }

  // 统一路径分隔符（Windows 使用反斜杠）
  fullPath = fullPath.replace(/\//g, '\\')

  return { fullPath, lineNumber }
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
 * 自定义链接提供者，用于检测文件路径并提供点击跳转
 */
class FileLinkProvider implements ILinkProvider {
  private _terminal: Terminal
  private _cwd: string
  private _onOpenFile: (fullPath: string, lineNumber?: number) => void

  constructor(
    terminal: Terminal,
    cwd: string,
    onOpenFile: (fullPath: string, lineNumber?: number) => void
  ) {
    this._terminal = terminal
    this._cwd = cwd
    this._onOpenFile = onOpenFile
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

      // 计算在 terminal buffer 中的位置
      const startX = startIndex + 1  // xterm 使用 1-based
      const endX = startIndex + matchedText.length

      const range: IBufferRange = {
        start: { x: startX, y: y },
        end: { x: endX, y: y }
      }

      const link: ILink = {
        range,
        text: matchedText,
        activate: (_event: MouseEvent, _text: string) => {
          this._onOpenFile(parsed.fullPath, parsed.lineNumber)
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

// 🌀 Claude Code 检测：OSC 标题序列含 "claude" 或版本号
const CLAUDE_START_RE = /\x1b\]0;.*?(?:claude|v\d+\.\d+).*?\x07/i
// 🌀 通用 TUI 检测：进入 alternate screen
const ALT_SCREEN_ENTER = /\x1b\[\?1049h/
const ALT_SCREEN_EXIT = /\x1b\[\?1049l/
const IDLE_THRESHOLD = 2000    // 2秒无真实输出 → 判空闲
const RUNNING_DEBOUNCE = 800   // 持续输出 0.8秒 → 才切忙碌

/**
 * 🧘 过滤光标相关 escape 序列（这些是 keep-alive 信号，不代表真实输出）
 * 只保留有意义的文本/渲染内容用于判断空闲
 */
function stripCursorEscapes(data: string): string {
  return data
    .replace(/\x1b\[\?25[hl]/g, '')   // 光标显示 \x1b[?25h / 隐藏 \x1b[?25l
    .replace(/\x1b\[\d* ?q/g, '')     // DECSCUSR 光标样式 \x1b[0 q 等
}

const TerminalView = React.memo(forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView({ sessionId, sessionName, sessionCwd, onOpenFile, onCommand, showHeader = true, fontSize = 14, isAux = false, onAgentStatusChange, newlineShortcut = 'Shift+Enter'}: TerminalViewProps, ref) {
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
  const tuiPresentRef = useRef(false)
  const lastOutputRef = useRef(0)
  const lastPtyResizeRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef<'running' | 'idle' | null>(null)
  // 🧘 区分「初始检测设定的 idle」和「定时器触发的真 idle」
  // 只有真 idle 才受 PTY resize 冷却抑制
  const idleFromTimerRef = useRef(false)
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
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowTransparency: currentTheme.terminal.allowTransparency ?? true,
      allowProposedApi: true,
      windowsMode: true,
      drawBoldTextInBrightColors: false
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

    try {
      term.loadAddon(new WebglAddon())
    } catch {
      // WebGL 不可用时回退到 Canvas 渲染器
    }

    term.open(terminalRef.current)
    fitAddon.fit()

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

    // Handle resize
    const onResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit()
          lastPtyResizeRef.current = Date.now()
          window.api.terminal.resize(sessionId, xtermRef.current.cols, xtermRef.current.rows)
        } catch (e) {
          // Ignore fit errors during resize
        }
      }
    }

    window.addEventListener('resize', onResize)

    return () => {
      terminalRef.current?.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onResize)
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

        // TUI agent detection (main terminals only)
        if (!isAux && onAgentStatusChange) {
          // 🧘 只将有意义的输出（非光标序列）视为 agent 活动
          const meaningful = stripCursorEscapes(data.data)

          // 🌀 双通道触发：Claude 标题检测 + 通用 alt screen 检测
          if (!tuiPresentRef.current &&
              (CLAUDE_START_RE.test(data.data) || ALT_SCREEN_ENTER.test(data.data))) {
            tuiPresentRef.current = true
            idleFromTimerRef.current = false
            activationStartRef.current = 0
            onAgentStatusChange(sessionId, 'idle')
            prevStatusRef.current = 'idle'
            if (meaningful.trim().length > 0) {
              lastOutputRef.current = Date.now()
            }
          } else if (tuiPresentRef.current && ALT_SCREEN_EXIT.test(data.data)) {
            tuiPresentRef.current = false
            if (idleTimerRef.current) {
              clearTimeout(idleTimerRef.current)
              idleTimerRef.current = null
            }
            lastOutputRef.current = 0
            prevStatusRef.current = null
            idleFromTimerRef.current = false
            activationStartRef.current = 0
            onAgentStatusChange(sessionId, null)
          } else if (tuiPresentRef.current && meaningful.trim().length > 0) {
            lastOutputRef.current = Date.now()
            const sinceResize = Date.now() - lastPtyResizeRef.current
            const wasIdle = prevStatusRef.current === 'idle'

            if (wasIdle) {
              // 🧘 PTY resize 后 600ms 冷却期内抑制真 idle→running（session 切换导致 agent 重绘）
              const suppressed = idleFromTimerRef.current && sinceResize < 600
              if (!suppressed) {
                // 🌀 累计活动时间达 RUNNING_DEBOUNCE + 最近有输出 → 切 running
                if (activationStartRef.current === 0) {
                  activationStartRef.current = Date.now()
                }
                if (Date.now() - activationStartRef.current >= RUNNING_DEBOUNCE) {
                  prevStatusRef.current = 'running'
                  idleFromTimerRef.current = false
                  activationStartRef.current = 0
                  onAgentStatusChange(sessionId, 'running')
                }
              }
            }

            // 🔄 重置 idle 防抖定时器：输出停止 IDLE_THRESHOLD 后切 idle
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
            idleTimerRef.current = setTimeout(() => {
              if (Date.now() - lastOutputRef.current >= IDLE_THRESHOLD) {
                prevStatusRef.current = 'idle'
                idleFromTimerRef.current = true
                onAgentStatusChange!(sessionId, 'idle')
              }
              // 🧘 激活计时跨 idle 间隙累积，但超长静默后清理防过期
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
      lastPtyResizeRef.current = Date.now()
      window.api.terminal.resize(sessionId, xtermRef.current.cols, xtermRef.current.rows)
    }

    // 🛡️ 防御：若 effect 重建时 agent 仍在运行但 timer 已丢，补建 idle 检测
    if (tuiPresentRef.current && !idleTimerRef.current) {
      idleTimerRef.current = setTimeout(() => {
        if (Date.now() - lastOutputRef.current >= IDLE_THRESHOLD) {
          prevStatusRef.current = 'idle'
          idleFromTimerRef.current = true
          onAgentStatusChange!(sessionId, 'idle')
        }
        idleTimerRef.current = null
      }, IDLE_THRESHOLD)
    }

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
      onOpenFile
    )
    linkProviderRef.current = xtermRef.current.registerLinkProvider(provider)

    return () => {
      if (linkProviderRef.current) {
        linkProviderRef.current.dispose()
        linkProviderRef.current = null
      }
    }
  }, [sessionCwd, isReady, onOpenFile])

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
            lastPtyResizeRef.current = Date.now()
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

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden p-1"
        onContextMenu={handleContextMenu}
      />
    </div>
  )
}))

export default TerminalView