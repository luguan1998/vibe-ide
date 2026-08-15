import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react'
import { Pencil, X, MessageSquarePlus, ListOrdered } from 'lucide-react'
import { useI18n } from '../i18n'
import { ModalOverlay } from './ModalOverlay'

export interface CustomCommand {
  id: string
  name: string
  command: string
  type: 'simple' | 'init' | 'pipe'
}

interface CustomCommandPrefill {
  name?: string
  command?: string
  type?: 'simple' | 'init' | 'pipe'
}

export interface CustomCommandsHandle {
  openCreateModal: (prefill?: CustomCommandPrefill) => void
}

interface CustomCommandsProps {
  onExecuteCommand?: (command: string) => void
  onInitCommand?: (command: string) => void
  onPipeCommand?: (command: string) => void
}

export function loadCustomCommands(): CustomCommand[] {
  try {
    const raw = localStorage.getItem('vibe-ide-custom-commands')
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter((c: unknown) => c && typeof c === 'object' && typeof (c as any).id === 'string' && typeof (c as any).name === 'string' && typeof (c as any).command === 'string').map((c: any) => ({ ...c, type: c.type || 'simple' }))
    }
  } catch {}
  return []
}

function saveCustomCommands(cmds: CustomCommand[]): void {
  try { localStorage.setItem('vibe-ide-custom-commands', JSON.stringify(cmds)) } catch {}
}

const CMD_MODAL_DEF_W = 400
const CMD_MODAL_DEF_H = 320
const CMD_MODAL_MIN_W = 320
const CMD_MODAL_MIN_H = 300
const clampNum = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const CustomCommands = forwardRef<CustomCommandsHandle, CustomCommandsProps>(
  function CustomCommands({ onExecuteCommand, onInitCommand, onPipeCommand }, ref) {
    const { t } = useI18n()

    const [customCommands, setCustomCommands] = useState<CustomCommand[]>(() => loadCustomCommands())
    const [showCustomCmdModal, setShowCustomCmdModal] = useState(false)
    const [editingCustomCmd, setEditingCustomCmd] = useState<CustomCommand | null>(null)
    const [customCmdName, setCustomCmdName] = useState('')
    const [customCmdCommand, setCustomCmdCommand] = useState('')
    const [customCmdType, setCustomCmdType] = useState<'simple' | 'init' | 'pipe'>('simple')
    const [customCmdCtxMenu, setCustomCmdCtxMenu] = useState<{ x: number; y: number; cmd: CustomCommand } | null>(null)
    const [modalW, setModalW] = useState(CMD_MODAL_DEF_W)
    const [modalH, setModalH] = useState(CMD_MODAL_DEF_H)
    const [modalPos, setModalPos] = useState(() => ({
      top: Math.max(0, (window.innerHeight - CMD_MODAL_DEF_H) / 2),
      left: Math.max(0, (window.innerWidth - CMD_MODAL_DEF_W) / 2),
    }))
    const resizeCleanupRef = useRef<(() => void) | null>(null)

    const resetModalSize = () => {
      if (resizeCleanupRef.current) { resizeCleanupRef.current(); resizeCleanupRef.current = null }
      setModalW(CMD_MODAL_DEF_W)
      setModalH(CMD_MODAL_DEF_H)
      setModalPos({
        top: Math.max(0, (window.innerHeight - CMD_MODAL_DEF_H) / 2),
        left: Math.max(0, (window.innerWidth - CMD_MODAL_DEF_W) / 2),
      })
    }
    const startResize = (dir: 'e' | 's' | 'se') => (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (resizeCleanupRef.current) { resizeCleanupRef.current(); resizeCleanupRef.current = null }
      const startX = e.clientX
      const startY = e.clientY
      const startW = modalW
      const startH = modalH
      const maxW = window.innerWidth - 32
      const maxH = window.innerHeight - 32
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (dir === 'e' || dir === 'se') setModalW(clampNum(startW + dx, CMD_MODAL_MIN_W, maxW))
        if (dir === 's' || dir === 'se') setModalH(clampNum(startH + dy, CMD_MODAL_MIN_H, maxH))
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.userSelect = ''
        resizeCleanupRef.current = null
        const suppress = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault() }
        document.addEventListener('click', suppress, { capture: true, once: true })
      }
      resizeCleanupRef.current = onUp
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
    const openCreateModal = (prefill?: CustomCommandPrefill) => {
      resetModalSize()
      setEditingCustomCmd(null)
      setCustomCmdName(prefill?.name ?? '')
      setCustomCmdCommand(prefill?.command ?? '')
      setCustomCmdType(prefill?.type ?? 'simple')
      setShowCustomCmdModal(true)
    }

    useImperativeHandle(ref, () => ({ openCreateModal }))

    const openCreateModalRef = useRef(openCreateModal)
    openCreateModalRef.current = openCreateModal
    useEffect(() => {
      const handler = (e: Event) => {
        openCreateModalRef.current((e as CustomEvent).detail as CustomCommandPrefill | undefined)
      }
      window.addEventListener('vibe-ide-open-custom-command-modal', handler)
      return () => window.removeEventListener('vibe-ide-open-custom-command-modal', handler)
    }, [])

    const handleSaveCustomCommand = () => {
      const name = customCmdName.trim()
      const rawCommand = customCmdCommand.replace(/\r\n/g, '\n')
      if (!name || !rawCommand.trim()) return
      const command = rawCommand
      if (editingCustomCmd) {
        setCustomCommands(prev => {
          const next = prev.map(c => c.id === editingCustomCmd.id ? { ...c, name, command, type: customCmdType } : c)
          saveCustomCommands(next)
          return next
        })
      } else {
        setCustomCommands(prev => {
          const next = [...prev, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, command, type: customCmdType }]
          saveCustomCommands(next)
          return next
        })
      }
      setShowCustomCmdModal(false)
      setEditingCustomCmd(null)
      setCustomCmdName('')
      setCustomCmdCommand('')
      setCustomCmdType('simple')
    }

    // ESC handler for Custom Command modal (capture phase per CLAUDE.md rule #8)
    useEffect(() => {
      if (!showCustomCmdModal) return
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopImmediatePropagation()
          setShowCustomCmdModal(false)
          setEditingCustomCmd(null)
        }
        if (e.key === 'Enter' && e.ctrlKey) {
          e.stopImmediatePropagation()
          handleSaveCustomCommand()
        }
      }
      document.addEventListener('keydown', handler, true)
      return () => document.removeEventListener('keydown', handler, true)
    }, [showCustomCmdModal, customCmdName, customCmdCommand, customCmdType, editingCustomCmd])

    // Global click to dismiss capsule context menu
    useEffect(() => {
      const handleClick = () => { setCustomCmdCtxMenu(null) }
      window.addEventListener('click', handleClick)
      return () => window.removeEventListener('click', handleClick)
    }, [])

    const sortedCommands = useMemo(() => {
      const init = customCommands.filter(c => c.type === 'init')
      const pipe = customCommands.filter(c => c.type === 'pipe')
      const simple = customCommands.filter(c => c.type !== 'init' && c.type !== 'pipe')
      return [...init, ...pipe, ...simple]
    }, [customCommands])

    return (
      <>
        {/* Custom Command Capsules */}
        {sortedCommands.length > 0 && (
          <div className="px-2 py-1.5">
            <div className="flex flex-wrap gap-1">
              {sortedCommands.map((cmd) => (
                <div
                  key={cmd.id}
                  className="relative group inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ide-hover hover:bg-ide-accent/20 text-ide-text-muted hover:text-ide-text cursor-pointer transition-colors text-xs max-w-full select-none"
                  onClick={() => {
                    if (cmd.type === 'pipe' && onPipeCommand) {
                      onPipeCommand(cmd.command)
                    } else if (cmd.type === 'init' && onInitCommand) {
                      onInitCommand(cmd.command)
                    } else if (onExecuteCommand) {
                      onExecuteCommand(cmd.command)
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setCustomCmdCtxMenu({ x: e.clientX, y: e.clientY, cmd })
                  }}
                  title={`${cmd.name}: ${cmd.command}${cmd.type === 'init' ? ' (init)' : cmd.type === 'pipe' ? ' (pipe)' : ''}`}
                >
                  {cmd.type === 'init' ? (
                    <MessageSquarePlus size={12} className="shrink-0 text-ide-accent" />
                  ) : cmd.type === 'pipe' ? (
                    <ListOrdered size={12} className="shrink-0 text-ide-accent" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0 text-ide-accent">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  )}
                  <span className="truncate max-w-[160px]">{cmd.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setCustomCommands(prev => {
                        const next = prev.filter(c => c.id !== cmd.id)
                        saveCustomCommands(next)
                        return next
                      })
                    }}
                    className="opacity-0 group-hover:opacity-100 absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ide-accent text-white flex items-center justify-center hover:bg-ide-accent-hover transition-all z-10"
                    title={t('Delete')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2 h-2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom Command Capsule Context Menu */}
        {customCmdCtxMenu && (
          <div
            className="fixed bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50 min-w-[140px]"
            style={{ left: customCmdCtxMenu.x, bottom: window.innerHeight - customCmdCtxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-ide-text hover:bg-ide-hover flex items-center gap-2"
              onClick={() => {
                resetModalSize()
                setEditingCustomCmd(customCmdCtxMenu.cmd)
                setCustomCmdName(customCmdCtxMenu.cmd.name)
                setCustomCmdCommand(customCmdCtxMenu.cmd.command)
                setCustomCmdType(customCmdCtxMenu.cmd.type || 'simple')
                setShowCustomCmdModal(true)
                setCustomCmdCtxMenu(null)
              }}
            >
              <Pencil size={14} className="text-ide-text-muted" />
              {t('Edit')}
            </button>
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-ide-danger hover:bg-ide-hover flex items-center gap-2"
              onClick={() => {
                setCustomCommands(prev => {
                  const next = prev.filter(c => c.id !== customCmdCtxMenu.cmd.id)
                  saveCustomCommands(next)
                  return next
                })
                setCustomCmdCtxMenu(null)
              }}
            >
              <X size={14} className="text-ide-danger" />
              {t('Delete')}
            </button>
          </div>
        )}

        {/* Custom Command Modal */}
        {showCustomCmdModal && (
          <ModalOverlay onClose={() => { setShowCustomCmdModal(false); setEditingCustomCmd(null) }}>
            <div
              className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl flex flex-col absolute"
              style={{ top: modalPos.top, left: modalPos.left, width: modalW, height: modalH }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-ide-border shrink-0">
                <span className="text-sm font-semibold text-ide-text">{editingCustomCmd ? t('Edit Custom Command') : t('New Custom Command')}</span>
                <button
                  className="w-5 h-5 rounded text-ide-text-muted bg-ide-hover hover:bg-ide-accent hover:text-white flex items-center justify-center transition-colors text-sm leading-none"
                  onClick={() => { setShowCustomCmdModal(false); setEditingCustomCmd(null) }}
                >
                  ×
                </button>
              </div>
              <div className="p-4 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
                <div className="flex items-center gap-4 shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="cmdType"
                      checked={customCmdType === 'simple'}
                      onChange={() => setCustomCmdType('simple')}
                      className="accent-ide-accent"
                    />
                    <span className="text-xs text-ide-text">{t('Simple')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="cmdType"
                      checked={customCmdType === 'init'}
                      onChange={() => setCustomCmdType('init')}
                      className="accent-ide-accent"
                    />
                    <span className="text-xs text-ide-text">{t('Init Session')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="cmdType"
                      checked={customCmdType === 'pipe'}
                      onChange={() => setCustomCmdType('pipe')}
                      className="accent-ide-accent"
                    />
                    <span className="text-xs text-ide-text">{t('Pipe')}</span>
                  </label>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <label className="text-xs text-ide-text-muted">{t('Command Name')}</label>
                  <input
                    type="text"
                    className="w-full bg-ide-bg border border-ide-border rounded px-3 py-1.5 text-sm text-ide-text focus:border-ide-accent focus:outline-none"
                    placeholder={t('Enter command name')}
                    value={customCmdName}
                    onChange={(e) => setCustomCmdName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-h-0">
                  <label className="text-xs text-ide-text-muted shrink-0">{t('Command')}</label>
                  <textarea
                    className="w-full flex-1 min-h-[6rem] bg-ide-bg border border-ide-border rounded px-3 py-2 text-sm text-ide-text font-mono focus:border-ide-accent focus:outline-none resize-none"
                    placeholder={t('Enter command to execute')}
                    value={customCmdCommand}
                    onChange={(e) => setCustomCmdCommand(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2 mt-1 shrink-0">
                  <button
                    className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                    onClick={() => { setShowCustomCmdModal(false); setEditingCustomCmd(null) }}
                  >
                    {t('Cancel')}
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs bg-ide-accent hover:bg-ide-accent-hover text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!customCmdName.trim() || !customCmdCommand.trim()}
                    onClick={handleSaveCustomCommand}
                  >
                    {t('Save')}
                  </button>
                </div>
              </div>
              <div onMouseDown={startResize('e')} onClick={(e) => e.stopPropagation()} className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize hover:bg-ide-accent/40" />
              <div onMouseDown={startResize('s')} onClick={(e) => e.stopPropagation()} className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize hover:bg-ide-accent/40" />
              <div onMouseDown={startResize('se')} onClick={(e) => e.stopPropagation()} className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize hover:bg-ide-accent" />
            </div>
          </ModalOverlay>
        )}
      </>
    )
  }
)

export default CustomCommands
