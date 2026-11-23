import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PetManifest, PetListResult } from '@shared/types'
import { PetSprite } from './PetSprite'
import { injectPetKeyframes } from './keyframes'
import { resolveStateName, type PetLogicalState, TRANSIENT_LOGICAL_STATES } from './stateMap'
export type { PetLogicalState }
import { loadKeypadItems } from '../keypadItems'
import { Edit, Send, MessageSquareQuote, X, BookOpenText, Pin, Sparkles, Loader2, RefreshCw } from 'lucide-react'
import { KeypadConfigModal } from '../KeypadConfigModal'
import { ADD_ANNOTATION_EVENT, BTW_REPLY_EVENT } from '../vibeEvents'
import type { PetBubbleItem, PetBubbleSection } from './bubbleRegistry'
import { getPetScale, getPetVisible, getPetPos, setPetPos, resetPetPos, onPetPrefsChanged, getPetFrameRate, getPetLogicalFramesOverride, getPetLogicalStateOverride, getPetListenAi, getPetSuggestMode } from './petSettings'
import { readAiCliConfig, aiStore } from '../../aiStore'
import { AiReplyBubble } from './AiReplyBubble'
import { addInterjectRecord, loadInterjectRecords, removeInterjectRecord, setInterjectReply, type InterjectRecord } from './interjectHistory'

const CONTEXT_SIDE_SPACE = 228
const CONTEXT_SIDE_MARGIN = 90

const SUGGEST_PROMPT = '只根据以上对话内容，预测用户接下来最可能输入的 3 条简短指令。要求：使用对话的主要语言；每条不超过 30 个汉字（或 60 个字符），动词开头，可直接作为下一条消息发送；只输出 3 行纯文本，每行一条，不要编号、不要引号、不要任何解释。'

function parseSuggestions(raw: string): string[] {
  const text = raw.replace(/\r/g, '').trim()
  if (!text) return []
  return text.split('\n')
    .flatMap(line => line.split(/(?=\s*\d{1,2}\s*[.、)）](?!\d))/))
    .map(s => s.trim()
      .replace(/^\d+\s*[.、)）]\s*/, '')
      .replace(/^[-*•·]\s+/, '')
      .replace(/^["'`“”‘’「」]+|["'`“”‘’「」]+$/g, '')
      .replace(/\*\*|__|`/g, '')
      .trim())
    .filter(s => s.length > 0 && s.length <= 160 && !/^(建议|suggestions?)[:：]?$/i.test(s))
    .slice(0, 3)
}

export function DesktopPet({ logicalState, activeSessionId, activeSessionCwd, sessions }: {
  logicalState: PetLogicalState
  activeSessionId: string | null
  activeSessionCwd: string | null
  sessions: { id: string; cwd: string; kind?: string }[]
}) {
  const [manifest, setManifest] = useState<PetManifest | null>(null)
  const [pos, setPos] = useState(() => getPetPos())
  const [scale, setScale] = useState(() => getPetScale())
  const [visible, setVisible] = useState(() => getPetVisible())
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupAbove, setPopupAbove] = useState(true)
  const [contextDir, setContextDir] = useState<'above' | 'below' | 'left' | 'right'>('above')
  const [contextVAlign, setContextVAlign] = useState<'center' | 'top' | 'bottom'>('center')
  const [aiBubbleAlign, setAiBubbleAlign] = useState<'center' | 'left' | 'right'>('center')
  const [bubblesAlign, setBubblesAlign] = useState<'default' | 'left' | 'right'>('default')
  const [contextAlign, setContextAlign] = useState<'default' | 'left' | 'right'>('default')
  const [contextOpen, setContextOpen] = useState(false)
  const [contextBtw, setContextBtw] = useState(false)
  const [contextPinned, setContextPinned] = useState(false)
  const [contextFocused, setContextFocused] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [draftCmd, setDraftCmd] = useState('')
  const [draftRefs, setDraftRefs] = useState<string[]>([])
  const activeKind = sessions.find(s => s.id === activeSessionId)?.kind
  const aiKey = useSyncExternalStore(aiStore.subscribe, () => {
    const s = aiStore.getSnapshot(activeSessionId)
    return `${s.ready ? 1 : 0}|${s.backend}|${s.busy ? 1 : 0}|${s.messages.length > 0 ? 1 : 0}`
  })
  const [aiReady, aiBackend, aiBusyFlag, aiHasMessages] = aiKey.split('|')
  const aiBusy = aiBusyFlag === '1'
  const canSuggest = activeKind === 'gui' && !!activeSessionId && aiReady === '1' && aiHasMessages === '1' && aiBackend !== 'pi' && !aiBusy
  const suggestionHint = activeKind !== 'gui'
    ? '仅 AI 会话可用'
    : aiBackend === 'pi'
      ? 'pi 后端暂不支持'
      : aiReady !== '1'
        ? 'AI 未就绪'
        : aiHasMessages !== '1'
          ? '先发一条消息'
          : aiBusy
            ? 'AI 回复中'
            : ''
  const [suggestMode, setSuggestMode] = useState(() => getPetSuggestMode())
  const [bubbleTab, setBubbleTab] = useState<'quick' | 'suggest'>('quick')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestSessionId, setSuggestSessionId] = useState<string | null>(null)
  const [keypadItems, setKeypadItems] = useState<ReturnType<typeof loadKeypadItems>>([])
  const [, setConfigTick] = useState(0)
  const [frameRate, setFrameRate] = useState(() => getPetFrameRate())
  const [transientState, setTransientState] = useState<PetLogicalState | null>(null)
  const [listenAi, setListenAi] = useState(() => getPetListenAi())
  const [aiBubbleOpen, setAiBubbleOpen] = useState(false)
  const [latestReply, setLatestReply] = useState<{ messageId: string; text: string } | null>(null)
  const [interjectRecords, setInterjectRecords] = useState<InterjectRecord[]>(() => activeSessionId ? loadInterjectRecords(activeSessionId) : [])
  const [dragDir, setDragDir] = useState<'left' | 'right' | null>(null)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const contextInputRef = useRef<HTMLTextAreaElement>(null)
  const inlineInputRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number; lastX: number; moved: boolean } | null>(null)
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const transientTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const lastShownReplyIdRef = useRef<string | null>(null)
  const pendingBtwRecordRef = useRef<{ sessionId: string; id: string } | null>(null)
  const activeSessionRef = useRef(activeSessionId)
  activeSessionRef.current = activeSessionId
  const contextOpenRef = useRef(contextOpen)
  contextOpenRef.current = contextOpen
  const prevAiBusyRef = useRef<{ sid: string | null; busy: boolean }>({ sid: null, busy: false })
  const suggestReqRef = useRef(0)

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

  useEffect(() => {
    setInterjectRecords(activeSessionId ? loadInterjectRecords(activeSessionId) : [])
  }, [activeSessionId])

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
    const mode = getPetSuggestMode()
    setSuggestMode(mode)
    if (mode === 'off') setBubbleTab('quick')
  }), [])

  const sendLine = useCallback((text: string) => {
    ;(window as any).__vibeSendLine?.(text)
  }, [])
  const readCenterDraft = useCallback(() => {
    const v = (window as any).__vibeGetInput?.()
    return typeof v === 'string' ? v.trim() : ''
  }, [])

  const predictSuggestions = useCallback(async (autoOpen: boolean) => {
    const sid = activeSessionId
    if (!sid || activeKind !== 'gui') return
    const snap = aiStore.getSessionState(sid)
    if (!snap.ready || snap.busy || snap.backend === 'pi' || snap.messages.length === 0) return
    const req = ++suggestReqRef.current
    setSuggestLoading(true)
    setSuggestError(null)
    setBubbleTab('suggest')
    try {
      const r = await window.api.ai.sideQuestion(sid, SUGGEST_PROMPT)
      if (req !== suggestReqRef.current || activeSessionRef.current !== sid) return
      if (!r?.success) {
        setSuggestions([])
        setSuggestError(r?.error || 'AI 建议生成失败')
        return
      }
      const list = parseSuggestions(r.response || '')
      if (!list.length) {
        setSuggestions([])
        setSuggestError('AI 未返回有效建议')
        return
      }
      setSuggestions(list)
      setSuggestSessionId(sid)
      if (autoOpen && !contextOpenRef.current) {
        const rect = wrapperRef.current?.getBoundingClientRect()
        setKeypadItems(loadKeypadItems())
        setAiBubbleOpen(false)
        setPopupAbove(!!rect && rect.top > 240)
        setPopupOpen(true)
      }
    } catch (e: any) {
      if (req === suggestReqRef.current) setSuggestError(e?.message || 'AI 建议生成失败')
    } finally {
      if (req === suggestReqRef.current) setSuggestLoading(false)
    }
  }, [activeSessionId, activeKind])

  // 自动模式：当前会话 AI busy→idle 后预测下一条输入
  useEffect(() => {
    const prev = prevAiBusyRef.current
    prevAiBusyRef.current = { sid: activeSessionId, busy: aiBusy }
    if (suggestMode !== 'auto' || !activeSessionId || !getPetVisible()) return
    if (prev.sid !== activeSessionId || !prev.busy || aiBusy) return
    void predictSuggestions(true)
  }, [aiBusy, activeSessionId, suggestMode, predictSuggestions])

  // 切换会话时清空上一会话的建议
  useEffect(() => {
    suggestReqRef.current++
    setSuggestions([])
    setSuggestError(null)
    setSuggestSessionId(null)
    setSuggestLoading(false)
  }, [activeSessionId])

  const triggerTransient = useCallback((state: PetLogicalState) => {
    if (!TRANSIENT_LOGICAL_STATES.includes(state)) return
    if (getPetLogicalStateOverride(state) === '') return
    setTransientState(state)
    clearTimeout(transientTimerRef.current)
    const st = manifest?.states[resolveStateName(state)]
    const dur = st ? (st.frameDurationMs ?? manifest?.frameDurationMs ?? 183) * (st.frames ?? 1) / frameRate : 2000
    transientTimerRef.current = setTimeout(() => setTransientState(null), Math.max(dur, 400))
  }, [manifest, frameRate])

  // AI 回复监听：只对当前目录（activeSessionCwd）的会话初始化回复游标，
  // 目录切换时重建，避免为无关目录的会话维护游标
  useEffect(() => {
    if (!listenAi) return
    const cfg = readAiCliConfig()
    const targets = activeSessionCwd ? sessions.filter(s => s.cwd === activeSessionCwd) : sessions
    for (const s of targets) {
      window.api.ai.initReplyCursor(s.id, s.cwd, cfg.configDir).catch(() => {})
    }
    return () => {
      for (const s of targets) window.api.ai.stopReplyCursor(s.id)
    }
  }, [listenAi, sessions, activeSessionCwd])

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

  const placeContextSide = useCallback((rect: DOMRect) => {
    const roomRight = window.innerWidth - rect.right
    const roomLeft = rect.left
    setContextDir(roomRight >= CONTEXT_SIDE_SPACE || roomRight >= roomLeft ? 'right' : 'left')
    setContextAlign('default')
    const cy = rect.top + rect.height / 2
    setContextVAlign(cy > window.innerHeight - CONTEXT_SIDE_MARGIN ? 'bottom' : cy < CONTEXT_SIDE_MARGIN ? 'top' : 'center')
  }, [])

  // 拖拽：左键按下 → 移动改 left/top → 松开持久；未移动则视为点击开气泡
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top, lastX: e.clientX, moved: false }
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
    if (e.clientX !== d.lastX) setDragDir(e.clientX > d.lastX ? 'right' : 'left')
    d.lastX = e.clientX
    const left = Math.max(0, Math.min(window.innerWidth - 8, d.origLeft + dx))
    const top = Math.max(0, Math.min(window.innerHeight - 8, d.origTop + dy))
    setPos({ left, top })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    setDragDir(null)
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
        setAiBubbleOpen(false)
        if (getPetSuggestMode() === 'off') setBubbleTab('quick')
        const next = !popupOpen
        setPopupOpen(next)
        setContextOpen(next && activeKind === 'gui')
        if (next && activeKind === 'gui') setContextBtw(true)
      }, 300)
    } else if (d && d.moved) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setPetPos({ left: rect.left, top: rect.top })
    }
  }, [triggerTransient, popupOpen, activeKind])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (contextOpen && !contextBtw) {
      // 输入框已打开：再次右键只聚焦，不打断编辑
      contextInputRef.current?.focus({ preventScroll: true })
      return
    }
    setPopupOpen(false)
    setContextBtw(false)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // AI 回复气泡固定在宠物上方时，右键输入改左右弹避免重叠；否则按上下自适应
    if (aiBubbleOpen && latestReply) {
      setContextDir(rect.left + rect.width / 2 < window.innerWidth / 2 ? 'right' : 'left')
    } else {
      setContextDir(rect.top > 240 ? 'above' : 'below')
    }
    setDraftCmd(prev => prev.trim() ? prev : readCenterDraft())
    setContextOpen(true)
  }, [aiBubbleOpen, latestReply, contextOpen, contextBtw, readCenterDraft])

  // AI 回复气泡与输入框同时打开时，输入框改左右弹（右键时可能 AI 气泡还没弹出）
  useEffect(() => {
    if (!aiBubbleOpen || !contextOpen) return
    const el = wrapperRef.current
    if (!el) return
    placeContextSide(el.getBoundingClientRect())
  }, [aiBubbleOpen, contextOpen, placeContextSide])

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

  const recordBtw = useCallback((text: string) => {
    if (activeKind !== 'gui' || !activeSessionId) return
    const added = addInterjectRecord(activeSessionId, text.replace(/^\s*\/btw\b\s*/i, ''))
    setInterjectRecords(added.records)
    if (added.id) pendingBtwRecordRef.current = { sessionId: activeSessionId, id: added.id }
  }, [activeKind, activeSessionId])

  const handleSend = useCallback(() => {
    const text = draftCmd.trim()
    const refsPart = draftRefs.join('; ')
    const merged = refsPart ? (text ? refsPart + '\n' + text : refsPart) : text
    if (merged) {
      const rawBtw = /^\s*\/btw\b/i.test(text)
      const isBtw = contextBtw || rawBtw
      const body = isBtw && !rawBtw ? `/btw ${merged}` : merged
      ;(window as any).__vibeSendLine?.(body)
      if (isBtw) recordBtw(text)
      triggerTransient('sendMessage')
    }
    setDraftCmd('')
    setDraftRefs([])
    setContextOpen(false)
    setPopupOpen(false)
  }, [draftCmd, draftRefs, contextBtw, recordBtw, triggerTransient])

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { pending?: boolean; text?: string | null; error?: string }
      const stamp = `btw-${Date.now()}`
      if (d.pending) {
        setLatestReply({ messageId: `${stamp}-pending`, text: '旁路提问思考中…' })
      } else {
        const reply = d.error ? `⚠️ ${d.error}` : (d.text || '').trim() || '（无回答）'
        setLatestReply({ messageId: stamp, text: reply })
        const pending = pendingBtwRecordRef.current
        if (pending) {
          pendingBtwRecordRef.current = null
          const next = setInterjectReply(pending.sessionId, pending.id, reply)
          if (pending.sessionId === activeSessionId) setInterjectRecords(next)
        }
      }
      setAiBubbleOpen(true)
    }
    window.addEventListener(BTW_REPLY_EVENT, handler)
    return () => window.removeEventListener(BTW_REPLY_EVENT, handler)
  }, [activeSessionId])

  // 手动查看最新一条 AI 回复（不依赖监听开关；监听未开时取完快照即清理游标）
  const handleReadReply = useCallback(() => {
    if (!activeSessionId || !activeSessionCwd) return
    setContextOpen(false)
    void (async () => {
      const cfg = readAiCliConfig()
      window.api.ai.initReplyCursor(activeSessionId, activeSessionCwd, cfg.configDir).then((cr) => {
        if (cr?.text) {
          lastShownReplyIdRef.current = cr.messageId
          setLatestReply({ messageId: cr.messageId, text: cr.text })
          setAiBubbleOpen(true)
        }
        if (!listenAi) window.api.ai.stopReplyCursor(activeSessionId)
      }).catch(() => {})
    })()
  }, [activeSessionId, activeSessionCwd, listenAi])

  const onContextKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    handleSend()
  }, [handleSend])

  useEffect(() => {
    if (!contextOpen) return
    const id = requestAnimationFrame(() => {
      const el = contextBtw ? inlineInputRef.current : contextInputRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.selectionStart = el.selectionEnd = el.value.length
    })
    return () => cancelAnimationFrame(id)
  }, [contextOpen, contextBtw])

  // 点面板外关闭 popup/context/AI 回复气泡
  useEffect(() => {
    if (!popupOpen && !contextOpen && !aiBubbleOpen) return
    const onDown = (ev: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target as Node)) {
        setPopupOpen(false)
        if (!contextPinned) setContextOpen(false)
        setAiBubbleOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popupOpen, contextOpen, aiBubbleOpen, contextPinned])

  useLayoutEffect(() => {
    if (!contextOpen && !configOpen && !aiBubbleOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (configOpen) setConfigOpen(false)
      else if (contextOpen) {
        setContextOpen(false)
        if (contextBtw) setPopupOpen(false)
      } else setAiBubbleOpen(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [contextOpen, contextBtw, configOpen, aiBubbleOpen])

  useEffect(() => {
    const handler = (e: Event) => {
      // AI 对话 + 右栏宽栏：App 侧直接落 AiTab 输入框，宠物不再接管
      if ((window as any).__vibeAnnotationToAi?.()) return
      const d = (e as CustomEvent).detail as { rel: string; start?: number; end?: number }
      const ref = (d.start != null && d.end != null)
        ? (d.start === d.end ? `@${d.rel}:${d.start}` : `@${d.rel}:${d.start}-${d.end}`)
        : `@${d.rel}`
      setDraftRefs(prev => prev.includes(ref) ? prev : [...prev, ref])
      setDraftCmd(prev => prev.trim() ? prev : readCenterDraft())
      setPopupOpen(false)
      setContextBtw(false)
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
  }, [readCenterDraft])

  useEffect(() => {
    const el = contextBtw ? inlineInputRef.current : contextInputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = contextBtw ? 120 : window.innerHeight * 0.4
    const h = el.scrollHeight
    el.style.height = Math.min(h, maxH) + 'px'
    el.style.overflowY = h > maxH ? '' : 'hidden'
  }, [draftCmd, contextOpen, contextBtw])

  if (!manifest) return null

  const effectiveLogicalState = transientState ?? logicalState
  const stateName = dragDir
    ? (dragDir === 'right' ? 'running-right' : 'running-left')
    : resolveStateName(effectiveLogicalState)
  const stateFrames = manifest.states[stateName]?.frames ?? 1
  const frames = dragDir ? stateFrames : getPetLogicalFramesOverride(effectiveLogicalState) ?? stateFrames
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
            {k.mode === 'btw' ? <MessageSquareQuote size={10} /> : <Send size={10} className="-scale-x-100" />}
          </span>
        </span>
      ),
      onAction: () => {
        const btw = k.mode === 'btw' && activeKind === 'gui'
        sendLine(btw ? `/btw ${k.text}` : k.text)
        if (btw) recordBtw(k.text)
      },
    }))
  }
  const sections: PetBubbleSection[] = [keypadSection]

  const onItemClick = (it: PetBubbleItem) => {
    if (it.disabled) return
    it.onAction()
    setPopupOpen(false)
    setContextOpen(false)
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
          {bubbleTab === 'suggest' ? (
            <div key="suggest" className="flex flex-col gap-1.5 rounded-xl border border-ide-accent/40 bg-ide-sidebar shadow-md px-1.5 py-2">
              {suggestions.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13} className="shrink-0 text-ide-accent" />
                  <span className="flex-1 min-w-0 text-[13px] font-medium text-ide-text truncate">AI 给出的预测</span>
                  <button
                    className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded border border-ide-border text-[11px] text-ide-text-muted hover:text-ide-accent hover:border-ide-accent/50 hover:bg-ide-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    disabled={suggestLoading || !canSuggest}
                    title={!canSuggest ? suggestionHint : '重新预测'}
                    onClick={() => { void predictSuggestions(false) }}
                  >
                    {suggestLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                    重新预测
                  </button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-1.5 w-full text-left px-1 py-0.5 -mx-1 rounded hover:bg-ide-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  disabled={suggestLoading || !canSuggest}
                  title={!canSuggest ? suggestionHint : suggestError || '生成下一条输入建议'}
                  onClick={() => { void predictSuggestions(false) }}
                >
                  {suggestLoading
                    ? <Loader2 size={13} className="shrink-0 text-ide-accent animate-spin" />
                    : <Sparkles size={13} className="shrink-0 text-ide-accent" />}
                  <span className="text-[13px] font-medium text-ide-text">
                    {suggestLoading ? '正在生成建议…' : suggestError ? '生成失败，点击重试' : '生成输入建议'}
                  </span>
                </button>
              )}
              {suggestions.length > 0 && (
                <div className="flex flex-col gap-1">
                  {suggestions.map((s, i) => (
                    <button
                      key={`${i}-${s}`}
                      className="group flex items-start gap-1.5 w-full text-left px-1.5 py-1.5 rounded border border-ide-border hover:border-ide-accent/50 hover:bg-ide-hover transition-colors"
                      title={s}
                      onClick={() => {
                        ;(window as any).__vibeSendLineTo?.(suggestSessionId ?? activeSessionId, s)
                        setSuggestions([])
                        setSuggestSessionId(null)
                        setSuggestError(null)
                        setPopupOpen(false)
                        setContextOpen(false)
                      }}
                    >
                      <span className="shrink-0 w-4 h-4 mt-px rounded-full border border-ide-border flex items-center justify-center text-[11px] font-medium leading-none text-ide-text-muted group-hover:border-ide-accent group-hover:text-ide-accent transition-colors">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className="flex-1 min-w-0 text-[13px] leading-snug text-ide-text break-words">{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            sections.map(sec => (
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
              </div>
            ))
          )}
          {interjectRecords.length > 0 && (
            <div key="history" className="desktop-pet__bubble-section desktop-pet__bubble-section--history">
              {interjectRecords.map(r => (
                <div key={r.id} className="desktop-pet__history-item">
                  <div
                    className={`desktop-pet__bubble desktop-pet__bubble--history${r.reply ? ' desktop-pet__bubble--history-clickable' : ''}`}
                    title={r.text}
                    onClick={r.reply ? () => {
                      if ((window.getSelection()?.toString() || '').trim()) return
                      setLatestReply({ messageId: `history-${r.id}`, text: r.reply! })
                      setAiBubbleOpen(true)
                      setPopupOpen(false)
                    } : undefined}
                  >
                    <span className="desktop-pet__bubble-text">{r.text}</span>
                    <button
                      className="desktop-pet__bubble-remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (activeSessionId) setInterjectRecords(removeInterjectRecord(activeSessionId, r.id))
                      }}
                      title="删除记录"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div key="footer" className={`desktop-pet__interject-row${contextOpen && contextBtw ? ' desktop-pet__interject-row--with-input' : ''}`}>
            {contextOpen && contextBtw && (
              <textarea
                ref={inlineInputRef}
                className="desktop-pet__interject-input"
                rows={1}
                value={draftCmd}
                onChange={(e) => setDraftCmd(e.target.value)}
                onKeyDown={onContextKeyDown}
                placeholder="旁路提问，Enter 发送"
              />
            )}
            {suggestMode !== 'off' && (
              <button
                className="desktop-pet__context-gear"
                onClick={() => setBubbleTab(bubbleTab === 'quick' ? 'suggest' : 'quick')}
                title={bubbleTab === 'quick' ? '切换到预测模式' : '切换到速发模式'}
              >
                {bubbleTab === 'quick' ? <Sparkles size={14} /> : <Send size={14} className="-scale-x-100" />}
              </button>
            )}
            <button
              className="desktop-pet__context-gear"
              onClick={() => { setConfigOpen(true); setPopupOpen(false); setContextOpen(false) }}
              title="配置速发键"
            >
              <Edit size={14} />
            </button>
          </div>
        </div>
      )}
      {visible && activeSessionId && aiBubbleOpen && latestReply && (
        <AiReplyBubble text={latestReply.text} align={aiBubbleAlign} />
      )}
      {contextOpen && !contextBtw && (
        <div className={`desktop-pet__context desktop-pet__context--${contextDir}${contextAlign !== 'default' ? ` desktop-pet__context--align-${contextAlign}` : ''}${(contextDir === 'left' || contextDir === 'right') && contextVAlign !== 'center' ? ` desktop-pet__context--v-${contextVAlign}` : ''}`}>
          {contextPinned && contextFocused && (
            <div className="desktop-pet__context-hint">按 Enter 发送</div>
          )}
          {draftRefs.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-1">
              {draftRefs.map(ref => (
                <span
                  key={ref}
                  title={ref}
                  className="inline-flex items-center gap-1 h-5 pl-1.5 pr-0.5 rounded-full border border-ide-border bg-ide-hover/50 text-[10px] text-ide-text max-w-[170px]"
                >
                  <span className="truncate">{ref.replace(/^@/, '')}</span>
                  <button
                    className="shrink-0 w-4 h-4 grid place-items-center rounded-full text-ide-text-muted hover:text-ide-text hover:bg-ide-hover"
                    onClick={() => setDraftRefs(prev => prev.filter(r => r !== ref))}
                    title="移除"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={contextInputRef}
            className="desktop-pet__context-input"
            rows={2}
            value={draftCmd}
            onChange={(e) => setDraftCmd(e.target.value)}
            onKeyDown={onContextKeyDown}
            placeholder="插话 Enter 发送"
            onFocus={() => setContextFocused(true)}
            onBlur={() => setContextFocused(false)}
          />
          <div className="flex items-center gap-1 self-end">
            <button
              className={`desktop-pet__context-gear${contextPinned ? ' desktop-pet__context-gear--active' : ''}`}
              onClick={() => setContextPinned(v => !v)}
              title={contextPinned ? '取消固定' : '固定输入框'}
            >
              <Pin size={14} fill={contextPinned ? 'currentColor' : 'none'} />
            </button>
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
