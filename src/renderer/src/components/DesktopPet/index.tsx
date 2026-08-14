import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PetManifest, PetListResult } from '@shared/types'
import { PetSprite } from './PetSprite'
import { injectPetKeyframes } from './keyframes'
import { resolveStateName, type PetLogicalState, TRANSIENT_LOGICAL_STATES } from './stateMap'
export type { PetLogicalState }
import { loadKeypadItems, loadBtwPrefix } from '../keypadItems'
import { Edit, Send, ClipboardPaste, BookOpenText } from 'lucide-react'
import { KeypadConfigModal } from '../KeypadConfigModal'
import { ADD_ANNOTATION_EVENT } from '../vibeEvents'
import { getExtraBubbleSections, onPetBubblesChanged, type PetBubbleItem, type PetBubbleSection } from './bubbleRegistry'
import { getPetScale, getPetVisible, getPetPos, setPetPos, resetPetPos, onPetPrefsChanged, getPetFrameRate, getPetLogicalFramesOverride, getPetLogicalStateOverride, getPetListenAi } from './petSettings'
import { readAiCliConfig } from '../../aiStore'
import { AiReplyBubble } from './AiReplyBubble'

export function DesktopPet({ logicalState, activeSessionId, activeSessionCwd, sessions }: {
  logicalState: PetLogicalState
  activeSessionId: string | null
  activeSessionCwd: string | null
  sessions: { id: string; cwd: string }[]
}) {
  const [manifest, setManifest] = useState<PetManifest | null>(null)
  const [pos, setPos] = useState(() => getPetPos())
  const [scale, setScale] = useState(() => getPetScale())
  const [visible, setVisible] = useState(() => getPetVisible())
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupAbove, setPopupAbove] = useState(true)
  const [contextDir, setContextDir] = useState<'above' | 'below' | 'left' | 'right'>('above')
  const [aiBubbleAlign, setAiBubbleAlign] = useState<'center' | 'left' | 'right'>('center')
  const [bubblesAlign, setBubblesAlign] = useState<'default' | 'left' | 'right'>('default')
  const [contextAlign, setContextAlign] = useState<'default' | 'left' | 'right'>('default')
  const [contextOpen, setContextOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [draftCmd, setDraftCmd] = useState('')
  const [keypadItems, setKeypadItems] = useState<ReturnType<typeof loadKeypadItems>>([])
  const [, setExtraTick] = useState(0)
  const [, setConfigTick] = useState(0)
  const [frameRate, setFrameRate] = useState(() => getPetFrameRate())
  const [transientState, setTransientState] = useState<PetLogicalState | null>(null)
  const [listenAi, setListenAi] = useState(() => getPetListenAi())
  const [aiBubbleOpen, setAiBubbleOpen] = useState(false)
  const [latestReply, setLatestReply] = useState<{ messageId: string; text: string } | null>(null)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const contextInputRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number; moved: boolean } | null>(null)
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const transientTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const lastShownReplyIdRef = useRef<string | null>(null)

  // 加载 active manifest + 订阅 PET_CHANGED（设置里切换/删除后热重载）
  useEffect(() => {
    let cancelled = false
    const reload = async () => {
      const r: PetListResult = await window.api.pet.list()
      if (cancelled) return
      setManifest(r.pets.find(p => p.id === r.activeId) ?? r.pets[0] ?? null)
    }
    reload()
    const handler = () => { reload() }
    window.api.pet.onChanged(handler)
    return () => { cancelled = true; window.api.pet.removeChangedListener(handler) }
  }, [])

  // manifest 变化时注入对应 keyframes
  useEffect(() => {
    if (manifest) injectPetKeyframes(manifest)
  }, [manifest])

  useEffect(() => {
    return () => {
      clearTimeout(singleClickTimerRef.current)
      clearTimeout(transientTimerRef.current)
    }
  }, [])

  const prevVisibleRef = useRef(visible)
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      resetPetPos()
      setPos(null)
    }
    prevVisibleRef.current = visible
  }, [visible])

  // 订阅本地偏好变化（缩放/可见性/重置位置/状态→row 配置）
  useEffect(() => onPetPrefsChanged(() => {
    setScale(getPetScale())
    setVisible(getPetVisible())
    setPos(getPetPos())
    setFrameRate(getPetFrameRate())
    setConfigTick(v => v + 1)
    setListenAi(getPetListenAi())
  }), [])

  // 订阅气泡拓展注册表变化
  useEffect(() => onPetBubblesChanged(() => setExtraTick(v => v + 1)), [])

  const sendLine = useCallback((text: string) => {
    ;(window as any).__vibeSendLine?.(text)
  }, [])
  const appendInput = useCallback((text: string) => {
    ;(window as any).__vibeAppendInput?.(text)
  }, [])

  const triggerTransient = useCallback((state: PetLogicalState) => {
    if (!TRANSIENT_LOGICAL_STATES.includes(state)) return
    if (getPetLogicalStateOverride(state) === '') return
    setTransientState(state)
    clearTimeout(transientTimerRef.current)
    const st = manifest?.states[resolveStateName(state)]
    const dur = st ? (st.frameDurationMs ?? manifest?.frameDurationMs ?? 183) * (st.frames ?? 1) / frameRate : 2000
    transientTimerRef.current = setTimeout(() => setTransientState(null), Math.max(dur, 400))
  }, [manifest, frameRate])

  // AI 回复监听：为所有 session 初始化回复游标（记录读到哪行，无定时器），
  // 渲染进程检测到会话 busy→idle 转换时调 ai.readReply 增量读 jsonl 弹气泡
  useEffect(() => {
    if (!listenAi) return
    const cfg = readAiCliConfig()
    for (const s of sessions) {
      window.api.ai.initReplyCursor(s.id, s.cwd, cfg.configDir).catch(() => {})
    }
    return () => {
      for (const s of sessions) window.api.ai.stopReplyCursor(s.id)
    }
  }, [listenAi, sessions])

  useEffect(() => {
    if (!listenAi) return
    const handler = window.api.ai.onReply((r) => {
      if (!r?.text || r.messageId === lastShownReplyIdRef.current) return
      lastShownReplyIdRef.current = r.messageId
      setLatestReply({ messageId: r.messageId, text: r.text })
      setPopupOpen(false)
      setAiBubbleOpen(true)
    })
    return () => window.api.ai.removeReplyListener(handler)
  }, [listenAi])

  // 拖拽：左键按下 → 移动改 left/top → 松开持久；未移动则视为点击开气泡
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top, moved: false }
    try { el.setPointerCapture(e.pointerId) } catch {}
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      d.moved = true
      setPopupOpen(false)
      setAiBubbleOpen(false)
    }
    if (!d.moved) return
    const left = Math.max(0, Math.min(window.innerWidth - 8, d.origLeft + dx))
    const top = Math.max(0, Math.min(window.innerHeight - 8, d.origTop + dy))
    setPos({ left, top })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
    if (d && !d.moved) {
      const el = e.currentTarget as HTMLElement
      const rect = el.getBoundingClientRect()
      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current)
        singleClickTimerRef.current = undefined
        setPopupOpen(false)
        setContextOpen(false)
        setAiBubbleOpen(false)
        triggerTransient('doubleTap')
        return
      }
      singleClickTimerRef.current = setTimeout(() => {
        singleClickTimerRef.current = undefined
        setKeypadItems(loadKeypadItems())
        setPopupAbove(rect.top > 240)
        setContextOpen(false)
        setAiBubbleOpen(false)
        setPopupOpen(v => !v)
      }, 300)
    } else if (d && d.moved) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setPetPos({ left: rect.left, top: rect.top })
    }
  }, [triggerTransient])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (contextOpen) {
      // 输入框已打开：再次右键只聚焦，不打断编辑
      contextInputRef.current?.focus({ preventScroll: true })
      return
    }
    setPopupOpen(false)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // AI 回复气泡固定在宠物上方时，右键输入改左右弹避免重叠；否则按上下自适应
    if (aiBubbleOpen && latestReply) {
      setContextDir(rect.left + rect.width / 2 < window.innerWidth / 2 ? 'right' : 'left')
    } else {
      setContextDir(rect.top > 240 ? 'above' : 'below')
    }
    setDraftCmd(prev => {
      if (prev.trim()) return prev
      const pfx = loadBtwPrefix()
      return pfx && !pfx.endsWith(' ') ? pfx + ' ' : pfx
    })
    setContextOpen(true)
  }, [aiBubbleOpen, latestReply, contextOpen])

  // AI 回复气泡与右键输入同时打开时，输入框改左右弹（右键时可能 AI 气泡还没弹出）
  useEffect(() => {
    if (!aiBubbleOpen || !contextOpen) return
    const el = wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setContextDir(rect.left + rect.width / 2 < window.innerWidth / 2 ? 'right' : 'left')
  }, [aiBubbleOpen, contextOpen])

  // 回复气泡靠屏幕边缘时贴边弹出，避免出屏（按 max-width 320 预估）
  useEffect(() => {
    if (!aiBubbleOpen || !latestReply) return
    const el = wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    if (centerX - 160 < 8) setAiBubbleAlign('left')
    else if (centerX + 160 > window.innerWidth - 8) setAiBubbleAlign('right')
    else setAiBubbleAlign('center')
  }, [aiBubbleOpen, latestReply])

  // 速发键气泡（宽 220）靠边时贴边，避免出屏
  useEffect(() => {
    if (!popupOpen) return
    const el = wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    if (centerX - 110 < 8) setBubblesAlign('left')
    else if (centerX + 110 > window.innerWidth - 8) setBubblesAlign('right')
    else setBubblesAlign('default')
  }, [popupOpen])

  // 右键输入框上下弹时靠边贴边；左右弹时按半区判断已安全，无需再算（须重置 align，防残留变体覆盖定位）
  useEffect(() => {
    if (!contextOpen) return
    if (contextDir === 'left' || contextDir === 'right') {
      setContextAlign('default')
      return
    }
    const el = wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    if (centerX - 110 < 8) setContextAlign('left')
    else if (centerX + 110 > window.innerWidth - 8) setContextAlign('right')
    else setContextAlign('default')
  }, [contextOpen, contextDir])

  const handleSend = useCallback(() => {
    const text = draftCmd.trim()
    if (text) {
      ;(window as any).__vibeSendLine?.(text)
      triggerTransient('sendMessage')
    }
    setDraftCmd('')
    setContextOpen(false)
  }, [draftCmd, triggerTransient])

  // 手动查看最新一条 AI 回复（不依赖监听开关；监听未开时取完快照即清理游标）
  const handleReadReply = useCallback(() => {
    if (!activeSessionId || !activeSessionCwd) return
    setContextOpen(false)
    const cfg = readAiCliConfig()
    window.api.ai.initReplyCursor(activeSessionId, activeSessionCwd, cfg.configDir).then((r) => {
      if (r?.text) {
        lastShownReplyIdRef.current = r.messageId
        setLatestReply({ messageId: r.messageId, text: r.text })
        setAiBubbleOpen(true)
      }
      if (!listenAi) window.api.ai.stopReplyCursor(activeSessionId)
    }).catch(() => {})
  }, [activeSessionId, activeSessionCwd, listenAi])

  const onContextKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    handleSend()
  }, [handleSend])

  useEffect(() => {
    if (!contextOpen) return
    const id = requestAnimationFrame(() => {
      const el = contextInputRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.selectionStart = el.selectionEnd = el.value.length
    })
    return () => cancelAnimationFrame(id)
  }, [contextOpen])

  useLayoutEffect(() => {
    if (!contextOpen && !configOpen && !aiBubbleOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (configOpen) setConfigOpen(false)
      else if (contextOpen) setContextOpen(false)
      else setAiBubbleOpen(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [contextOpen, configOpen, aiBubbleOpen])

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { rel: string; start?: number; end?: number }
      const ref = (d.start != null && d.end != null)
        ? (d.start === d.end ? `@${d.rel}:${d.start}` : `@${d.rel}:${d.start}-${d.end}`)
        : `@${d.rel}`
      setDraftCmd(prev => {
        if (!prev.trim()) return ref + ' → '
        const lastSep = prev.lastIndexOf('; ')
        const lastAnno = lastSep > -1 ? prev.slice(lastSep + 2) : prev
        if (/^@.+? →\s*$/.test(lastAnno)) {
          return (lastSep > -1 ? prev.slice(0, lastSep + 2) : '') + ref + ' → '
        }
        return prev.replace(/\s+$/, '') + '; ' + ref + ' → '
      })
      setPopupOpen(false)
      setContextOpen(true)
      requestAnimationFrame(() => {
        const el = contextInputRef.current
        if (!el) return
        el.focus({ preventScroll: true })
        el.selectionStart = el.selectionEnd = el.value.length
      })
    }
    window.addEventListener(ADD_ANNOTATION_EVENT, handler)
    return () => window.removeEventListener(ADD_ANNOTATION_EVENT, handler)
  }, [])

  useEffect(() => {
    const el = contextInputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = window.innerHeight * 0.4
    const h = el.scrollHeight
    el.style.height = Math.min(h, maxH) + 'px'
    el.style.overflowY = h > maxH ? '' : 'hidden'
  }, [draftCmd, contextOpen])

  // 气泡面板打开时：点面板外关闭；context 面板点外只隐藏不清空内容
  useEffect(() => {
    if (!popupOpen && !contextOpen && !aiBubbleOpen) return
    const onDown = (ev: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target as Node)) {
        setPopupOpen(false)
        setContextOpen(false)
        setAiBubbleOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popupOpen, contextOpen, aiBubbleOpen])

  if (!manifest) return null

  const effectiveLogicalState = transientState ?? logicalState
  const stateName = resolveStateName(effectiveLogicalState)
  const stateFrames = manifest.states[stateName]?.frames ?? 1
  const frames = getPetLogicalFramesOverride(effectiveLogicalState) ?? stateFrames
  const defaultStyle: React.CSSProperties = (visible || (!popupOpen && !contextOpen))
    ? { left: 8, bottom: 8 }
    : { left: 70, bottom: 8 }
  const wrapperStyle: React.CSSProperties = pos ? { left: pos.left, top: pos.top } : defaultStyle

  // 组装气泡 section：速发键 → 拓展注册表（宠物选择/删除/打开文件夹已移至设置→外观）
  const keypadSection: PetBubbleSection = {
    id: 'keypad',
    items: keypadItems.map((k, i) => ({
      id: k.code,
      label: k.text,
      badge: (
        <span className="desktop-pet__bubble-key">
          <span className="desktop-pet__bubble-key-num">{i + 1}</span>
          <span className="desktop-pet__bubble-key-action">
            {k.directSend ? <Send size={10} className="-scale-x-100" /> : <ClipboardPaste size={10} />}
          </span>
        </span>
      ),
      onAction: () => k.directSend ? sendLine(k.text) : appendInput(k.text),
    }))
  }
  const sections: PetBubbleSection[] = [keypadSection, ...getExtraBubbleSections()]

  const onItemClick = (it: PetBubbleItem) => {
    if (it.disabled) return
    it.onAction()
    setPopupOpen(false)
  }

  return (
    <div className="desktop-pet__wrapper" ref={wrapperRef} style={wrapperStyle}>
      {visible && (
        <div
          className="desktop-pet__hitarea"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={onContextMenu}
        >
          <PetSprite manifest={manifest} stateName={stateName} scale={scale} frameRate={frameRate} frames={frames} />
        </div>
      )}
      {popupOpen && (
        <div className={`desktop-pet__bubbles${popupAbove ? ' desktop-pet__bubbles--above' : ' desktop-pet__bubbles--below'}${bubblesAlign !== 'default' ? ` desktop-pet__bubbles--align-${bubblesAlign}` : ''}`}>
          {sections.map((sec, si) => (
            <div className="desktop-pet__bubble-section" key={sec.id}>
              {sec.items.map(it => (
                <button
                  key={it.id}
                  className={`desktop-pet__bubble${it.danger ? ' desktop-pet__bubble--danger' : ''}`}
                  disabled={it.disabled}
                  title={it.label}
                  onClick={() => onItemClick(it)}
                >
                  {it.badge}
                  <span className="desktop-pet__bubble-text">{it.label}</span>
                </button>
              ))}
              {si === 0 && (
                <button
                  className="desktop-pet__context-gear justify-self-end"
                  style={{ gridColumn: 2 }}
                  onClick={() => { setConfigOpen(true); setPopupOpen(false) }}
                  title="配置速发键"
                >
                  <Edit size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {visible && activeSessionId && aiBubbleOpen && latestReply && (
        <AiReplyBubble text={latestReply.text} align={aiBubbleAlign} />
      )}
      {contextOpen && (
        <div className={`desktop-pet__context desktop-pet__context--${contextDir}${contextAlign !== 'default' ? ` desktop-pet__context--align-${contextAlign}` : ''}`}>
          <textarea
            ref={contextInputRef}
            className="desktop-pet__context-input"
            rows={2}
            value={draftCmd}
            onChange={(e) => setDraftCmd(e.target.value)}
            onKeyDown={onContextKeyDown}
            placeholder="输入命令，Enter 发送"
          />
          <div className="flex items-center gap-1 self-end">
            <button className="desktop-pet__context-gear" onClick={handleReadReply} title="显示最新回复">
              <BookOpenText size={14} />
            </button>
          </div>
        </div>
      )}
      <KeypadConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  )
}
