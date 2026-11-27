import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PetManifest, PetListResult, PetWinAiSnapshot, PetWinRect } from '@shared/types'
import { PetSprite } from './PetSprite'
import { injectPetKeyframes } from './keyframes'
import { resolveStateName, type PetLogicalState, TRANSIENT_LOGICAL_STATES } from './stateMap'
export type { PetLogicalState }
import { loadKeypadItems } from '../keypadItems'
import { Edit, Send, MessageSquareQuote, Plug, X, BookOpenText, Pin, Sparkles, Loader2, RefreshCw, Zap } from 'lucide-react'
import { KeypadConfigModal } from '../KeypadConfigModal'
import { ADD_ANNOTATION_EVENT, BTW_REPLY_EVENT, PET_OUTSIDE_CLICK_EVENT } from '../vibeEvents'
import type { PetBubbleItem, PetBubbleSection } from './bubbleRegistry'
import { getPetScale, getPetVisible, onPetPrefsChanged, getPetFrameRate, getPetLogicalFramesOverride, getPetLogicalStateOverride, getPetListenAi, getPetAutoSuggest, setPetAutoSuggest } from './petSettings'
import { AiReplyBubble } from './AiReplyBubble'
import { addInterjectRecord, loadInterjectRecords, removeInterjectRecord, setInterjectReply, type InterjectRecord } from './interjectHistory'

const CONTEXT_SIDE_MARGIN = 90
const POPUP_W = 220
const AI_REPLY_W = 320

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

export interface PetWindowBridge {
  sendLine(text: string): void
  sendLineTo(sessionId: string | null, text: string): void
  getInput(): Promise<string>
}

export function DesktopPet({ logicalState, activeSessionId, activeSessionCwd, sessions, ai, aiConfigDir, bridge }: {
  logicalState: PetLogicalState
  activeSessionId: string | null
  activeSessionCwd: string | null
  sessions: { id: string; cwd: string; kind?: string }[]
  ai: PetWinAiSnapshot
  aiConfigDir?: string
  bridge: PetWindowBridge
}) {
  const [manifest, setManifest] = useState<PetManifest | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [scale, setScale] = useState(() => getPetScale())
  const [visible, setVisible] = useState(() => getPetVisible())
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupAbove, setPopupAbove] = useState(true)
  const [contextDir, setContextDir] = useState<'above' | 'below' | 'left' | 'right'>('above')
  const [contextVAlign, setContextVAlign] = useState<'center' | 'top' | 'bottom'>('center')
  const [bubbleAlign, setBubbleAlign] = useState<'default' | 'left' | 'right'>('default')
  const [contextOpen, setContextOpen] = useState(false)
  const [contextBtw, setContextBtw] = useState(false)
  const [contextPinned, setContextPinned] = useState(false)
  const [contextFocused, setContextFocused] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [draftCmd, setDraftCmd] = useState('')
  const [draftRefs, setDraftRefs] = useState<string[]>([])
  const activeKind = sessions.find(s => s.id === activeSessionId)?.kind
  const aiBusy = ai.busy
  const canSuggest = activeKind === 'gui' && !!activeSessionId && ai.ready && ai.hasMessages && ai.backend !== 'pi' && !ai.busy
  const suggestionHint = activeKind !== 'gui'
    ? '仅 AI 会话可用'
    : ai.backend === 'pi'
      ? 'pi 后端暂不支持'
      : !ai.ready
        ? 'AI 未就绪'
        : !ai.hasMessages
          ? '先发一条消息'
          : aiBusy
            ? 'AI 回复中'
            : ''
  const [autoSuggest, setAutoSuggestState] = useState(() => getPetAutoSuggest())
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
  const dragRef = useRef<{ pointerId: number; rect: DOMRect } | null>(null)
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

  // 订阅偏好变化（缩放/可见性/状态→row 配置）
  useEffect(() => onPetPrefsChanged(() => {
    setScale(getPetScale())
    setVisible(getPetVisible())
    setFrameRate(getPetFrameRate())
    setConfigTick(v => v + 1)
    setListenAi(getPetListenAi())
    setAutoSuggestState(getPetAutoSuggest())
  }), [])

  const sendLine = useCallback((text: string) => {
    bridge.sendLine(text)
  }, [bridge])

  // 中间栏 AI 输入框的草稿（跨窗口异步取，取回来时用户已输入则不覆盖）
  const fillDraftFromCenter = useCallback(() => {
    bridge.getInput().then((v) => {
      const text = (v || '').trim()
      if (!text) return
      setDraftCmd(prev => prev.trim() ? prev : text)
    }).catch(() => {})
  }, [bridge])

  const predictSuggestions = useCallback(async (autoOpen: boolean) => {
    const sid = activeSessionId
    if (!sid || activeKind !== 'gui') return
    if (!ai.ready || ai.busy || ai.backend === 'pi' || !ai.hasMessages) return
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
        setPopupAbove(!!rect && rect.top > window.innerHeight - rect.bottom)
        setPopupOpen(true)
      }
    } catch (e: any) {
      if (req === suggestReqRef.current) setSuggestError(e?.message || 'AI 建议生成失败')
    } finally {
      if (req === suggestReqRef.current) setSuggestLoading(false)
    }
  }, [activeSessionId, activeKind, ai.ready, ai.busy, ai.backend, ai.hasMessages])

  // 自动模式：当前会话 AI busy→idle 后预测下一条输入
  useEffect(() => {
    const prev = prevAiBusyRef.current
    prevAiBusyRef.current = { sid: activeSessionId, busy: aiBusy }
    if (!autoSuggest || !activeSessionId || !getPetVisible()) return
    if (prev.sid !== activeSessionId || !prev.busy || aiBusy) return
    void predictSuggestions(true)
  }, [aiBusy, activeSessionId, autoSuggest, predictSuggestions])

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
    const targets = activeSessionCwd ? sessions.filter(s => s.cwd === activeSessionCwd) : sessions
    for (const s of targets) {
      window.api.ai.initReplyCursor(s.id, s.cwd, aiConfigDir).catch(() => {})
    }
    return () => {
      for (const s of targets) window.api.ai.stopReplyCursor(s.id)
    }
  }, [listenAi, sessions, activeSessionCwd, aiConfigDir])

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
    setContextDir(roomRight >= roomLeft ? 'right' : 'left')
    const cy = rect.top + rect.height / 2
    setContextVAlign(cy > window.innerHeight - CONTEXT_SIDE_MARGIN ? 'bottom' : cy < CONTEXT_SIDE_MARGIN ? 'top' : 'center')
  }, [])

  // 气泡贴边判定：容器自身 clamp 到窗口内两侧时贴边，居中时回 default
  const alignFor = useCallback((cardW: number) => {
    const el = wrapperRef.current
    if (!el) return 'default' as const
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const left = cx - cardW / 2
    const right = cx + cardW / 2
    if (left < 8) return 'left' as const
    if (right > window.innerWidth - 8) return 'right' as const
    return 'default' as const
  }, [])

  const handlePetClick = useCallback((rect: DOMRect) => {
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
      setPopupAbove(rect.top > window.innerHeight - rect.bottom)
      setAiBubbleOpen(false)
      const next = !popupOpen
      setPopupOpen(next)
      setContextOpen(next && activeKind === 'gui')
      if (next && activeKind === 'gui') setContextBtw(true)
    }, 300)
  }, [triggerTransient, popupOpen, activeKind])

  // 拖拽由主进程按屏幕坐标驱动（支持跨显示器）；渲染层只区分点击/拖动
  const finishDrag = useCallback(() => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    void window.api.petWin.drag('end').then((res) => {
      setDragDir(null)
      if (res?.moved) return
      handlePetClick(d.rect)
    })
  }, [handlePetClick])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    dragRef.current = { pointerId: e.pointerId, rect }
    try { el.setPointerCapture(e.pointerId) } catch {}
    void window.api.petWin.drag('start', { x: rect.x, y: rect.y })
  }, [])

  // 窗口跨屏搬移/改变大小时可能丢 pointer capture，松手事件落到页面而非精灵上
  useEffect(() => {
    const handler = () => finishDrag()
    window.addEventListener('pointerup', handler)
    window.addEventListener('pointercancel', handler)
    return () => {
      window.removeEventListener('pointerup', handler)
      window.removeEventListener('pointercancel', handler)
    }
  }, [finishDrag])

  useEffect(() => {
    const h = window.api.petWin.onSpritePos((p) => setPos({ left: p.x, top: p.y }))
    return () => window.api.petWin.removeSpritePosListener(h)
  }, [])

  useEffect(() => {
    const h = window.api.petWin.onDragState((state) => {
      setDragDir(state.dir)
      if (state.moved) {
        setPopupOpen(false)
        setAiBubbleOpen(false)
      }
    })
    return () => window.api.petWin.removeDragStateListener(h)
  }, [])

  // 可点击矩形 + 精灵矩形上报给主进程（透明窗口靠它决定穿透与窗口尺寸）。next frame 上报，
  // 等 textarea 自增高、气泡内容渲染完，避免命中区比实际气泡小
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const root = wrapperRef.current
      if (!root) return
      const rects: PetWinRect[] = []
      root.querySelectorAll('.desktop-pet__hitarea, .desktop-pet__bubbles, .desktop-pet__context, .desktop-pet__ai-reply, .vibe-ui').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) rects.push({ x: r.x, y: r.y, w: r.width, h: r.height })
      })
      const sr = (root.querySelector('.desktop-pet__hitarea') as HTMLElement | null)?.getBoundingClientRect()
      window.api.petWin.reportLayout({
        hits: rects,
        sprite: sr && sr.width > 0 && sr.height > 0 ? { x: sr.x, y: sr.y, w: sr.width, h: sr.height } : null
      })
    })
    return () => cancelAnimationFrame(id)
  })

  useEffect(() => {
    const h = window.api.petWin.onResetPos(() => setPos(null))
    return () => window.api.petWin.removeResetPosListener(h)
  }, [])

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
      setContextDir(rect.top > window.innerHeight - rect.bottom ? 'above' : 'below')
    }
    setBubbleAlign('default')
    fillDraftFromCenter()
    setContextOpen(true)
  }, [aiBubbleOpen, latestReply, contextOpen, contextBtw, fillDraftFromCenter])

  // AI 回复气泡与输入框同时打开时，输入框改左右弹（右键时可能 AI 气泡还没弹出）
  useEffect(() => {
    if (!aiBubbleOpen || !contextOpen) return
    const el = wrapperRef.current
    if (!el) return
    placeContextSide(el.getBoundingClientRect())
  }, [aiBubbleOpen, contextOpen, placeContextSide])

  // 三个气泡共用一套贴边判定（速发键/输入框 220，AI 回复 320）。左右弹时已按半区判过，不必再算
  useEffect(() => {
    if (popupOpen) setBubbleAlign(alignFor(POPUP_W))
    else if (contextOpen) setBubbleAlign(contextDir === 'left' || contextDir === 'right' ? 'default' : alignFor(POPUP_W))
    else if (aiBubbleOpen && latestReply) setBubbleAlign(alignFor(AI_REPLY_W))
  }, [popupOpen, contextOpen, contextDir, aiBubbleOpen, latestReply, alignFor])

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
      bridge.sendLine(body)
      if (isBtw) recordBtw(text)
      triggerTransient('sendMessage')
    }
    setDraftCmd('')
    setDraftRefs([])
    setContextOpen(false)
    setPopupOpen(false)
  }, [draftCmd, draftRefs, contextBtw, recordBtw, triggerTransient, bridge])

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
    void window.api.ai.initReplyCursor(activeSessionId, activeSessionCwd, aiConfigDir).then((cr) => {
      if (cr?.text) {
        lastShownReplyIdRef.current = cr.messageId
        setLatestReply({ messageId: cr.messageId, text: cr.text })
        setAiBubbleOpen(true)
      }
      if (!listenAi) window.api.ai.stopReplyCursor(activeSessionId)
    }).catch(() => {})
  }, [activeSessionId, activeSessionCwd, listenAi, aiConfigDir])

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

  const closeBubbles = useCallback(() => {
    setPopupOpen(false)
    if (!contextPinned) setContextOpen(false)
    setAiBubbleOpen(false)
  }, [contextPinned])

  // 独立窗口内的点击全部落在 wrapper 内（其余区域点击穿透），窗口外点击靠主窗口转发 + 失焦收起
  useEffect(() => {
    if (!popupOpen && !contextOpen && !aiBubbleOpen) return
    window.addEventListener('blur', closeBubbles)
    window.addEventListener(PET_OUTSIDE_CLICK_EVENT, closeBubbles)
    return () => {
      window.removeEventListener('blur', closeBubbles)
      window.removeEventListener(PET_OUTSIDE_CLICK_EVENT, closeBubbles)
    }
  }, [popupOpen, contextOpen, aiBubbleOpen, closeBubbles])

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
      const d = (e as CustomEvent).detail as { rel: string; start?: number; end?: number }
      const ref = (d.start != null && d.end != null)
        ? (d.start === d.end ? `@${d.rel}:${d.start}` : `@${d.rel}:${d.start}-${d.end}`)
        : `@${d.rel}`
      setDraftRefs(prev => prev.includes(ref) ? prev : [...prev, ref])
      fillDraftFromCenter()
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
  }, [fillDraftFromCenter])

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
  const wrapperStyle: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : { left: 8, bottom: 8 }

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

  const autoSuggestToggle = (
    <button
      className={`shrink-0 grid place-items-center w-5 h-5 rounded-md transition-colors ${autoSuggest ? 'text-ide-accent bg-ide-accent/15' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
      title={autoSuggest ? '自动预测已开启，点击关闭' : '开启自动预测'}
      onClick={() => setPetAutoSuggest(!autoSuggest)}
    >
      <Zap size={12} fill={autoSuggest ? 'currentColor' : 'none'} />
    </button>
  )

  return (
    <div className="desktop-pet__wrapper" ref={wrapperRef} style={wrapperStyle}>
      {visible && (
        <div
          className="desktop-pet__hitarea"
          onPointerDown={onPointerDown}
          onPointerUp={finishDrag}
          onContextMenu={onContextMenu}
        >
          <PetSprite manifest={manifest} stateName={stateName} scale={scale} frameRate={frameRate} frames={frames} />
        </div>
      )}
      {popupOpen && (
        <div className={`desktop-pet__bubbles${popupAbove ? ' desktop-pet__bubbles--above' : ' desktop-pet__bubbles--below'}${bubbleAlign !== 'default' ? ` desktop-pet__bubbles--align-${bubbleAlign}` : ''}`}>
          {bubbleTab === 'suggest' ? (
            <div key="suggest" className="flex flex-col gap-1.5 rounded-xl border border-ide-accent/40 bg-ide-sidebar shadow-md px-1.5 py-2">
              {suggestions.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13} className="shrink-0 text-ide-accent" />
                  <span className="flex-1 min-w-0 text-[13px] font-medium text-ide-text truncate">AI 给出的预测</span>
                  {autoSuggestToggle}
                  <button
                    className="shrink-0 grid place-items-center w-5 h-5 rounded-md text-ide-text-muted hover:text-ide-accent hover:bg-ide-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    disabled={suggestLoading || !canSuggest}
                    title={!canSuggest ? suggestionHint : '重新预测'}
                    onClick={() => { void predictSuggestions(false) }}
                  >
                    {suggestLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left px-1 py-0.5 rounded hover:bg-ide-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                  {autoSuggestToggle}
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="flex flex-col gap-1">
                  {suggestions.map((s, i) => (
                    <button
                      key={`${i}-${s}`}
                      className="group flex items-start gap-1.5 w-full text-left px-1.5 py-1.5 rounded border border-ide-border hover:border-ide-accent/50 hover:bg-ide-hover transition-colors"
                      title={s}
                      onClick={() => {
                        bridge.sendLineTo(suggestSessionId ?? activeSessionId, s)
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
            <button
              className="desktop-pet__context-gear"
              onClick={() => setBubbleTab(bubbleTab === 'quick' ? 'suggest' : 'quick')}
              title={bubbleTab === 'quick' ? '切换到预测模式' : '切换到速发模式'}
            >
              {bubbleTab === 'quick' ? <Sparkles size={14} /> : <Send size={14} className="-scale-x-100" />}
            </button>
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
        <AiReplyBubble text={latestReply.text} align={bubbleAlign === 'default' ? 'center' : bubbleAlign} />
      )}
      {contextOpen && !contextBtw && (
        <div className={`desktop-pet__context desktop-pet__context--${contextDir}${bubbleAlign !== 'default' ? ` desktop-pet__context--align-${bubbleAlign}` : ''}${(contextDir === 'left' || contextDir === 'right') && contextVAlign !== 'center' ? ` desktop-pet__context--v-${contextVAlign}` : ''}`}>
          {contextPinned && contextFocused && (
            <div className="desktop-pet__context-hint">按 Enter 发送</div>
          )}
          {draftRefs.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-1">
              {draftRefs.map(ref => (
                <span
                  key={ref}
                  title={ref}
                  className="inline-flex items-center gap-1 h-[22px] pl-2 pr-0.5 rounded-full border border-ide-accent/40 bg-ide-sidebar shadow-sm text-[11px] text-ide-text max-w-full"
                >
                  <Plug size={11} strokeWidth={2} className="shrink-0 text-ide-accent/80" />
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
