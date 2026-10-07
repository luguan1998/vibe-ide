import { useCallback, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { ReplayFile, ReplayList, ReplaySkipped } from './gitReplay'
import { replayDurationMs, MIN_HUNK_DWELL_MS, MAX_HUNK_DWELL_MS, MAX_DURATION_MS } from './gitReplay'

export type ReplaySpeed = 0.25 | 0.5 | 1 | 2

const DEFAULT_SPEED: ReplaySpeed = 0.5

interface UseGitReplayOptions {
  activeRef: MutableRefObject<boolean>
  openReplayFile: (file: ReplayFile) => string | null
  closeReplayTab: (tabId: string) => void
  onFinish: () => void
}

export function useGitReplay({ activeRef, openReplayFile, closeReplayTab, onFinish }: UseGitReplayOptions) {
  const [active, setActive] = useState(false)
  const [paused, setPaused] = useState(false)
  const [index, setIndex] = useState(0)
  const [total, setTotal] = useState(0)
  const [speed, setSpeedState] = useState<ReplaySpeed>(DEFAULT_SPEED)
  const [dwellMs, setDwellMs] = useState(0)
  const [skipped, setSkipped] = useState<ReplaySkipped[]>([])
  const [skipListOpen, setSkipListOpen] = useState(false)

  const listRef = useRef<ReplayFile[]>([])
  const tabIdRef = useRef<string | null>(null)
  const indexRef = useRef(0)
  const speedRef = useRef<ReplaySpeed>(DEFAULT_SPEED)
  const pausedRef = useRef(false)
  const remainingRef = useRef(0)
  const dwellTotalRef = useRef(0)
  const baseDwellRef = useRef(0)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skippedRef = useRef<ReplaySkipped[]>([])
  const skipListOpenRef = useRef(false)
  const finishRef = useRef<() => void>(() => {})
  const showAtRef = useRef<(i: number) => void>(() => {})
  const advanceRef = useRef<(dir: number) => void>(() => {})
  const handlersRef = useRef({ openReplayFile, closeReplayTab, onFinish })
  handlersRef.current = { openReplayFile, closeReplayTab, onFinish }

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const setActiveSynced = useCallback((v: boolean) => {
    activeRef.current = v
    setActive(v)
  }, [activeRef])

  const armTimer = useCallback((ms: number) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    remainingRef.current = ms
    if (pausedRef.current) return
    startedAtRef.current = Date.now()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      remainingRef.current = 0
      advanceRef.current(1)
    }, ms)
  }, [])

  const latchElapsed = useCallback(() => {
    if (!pausedRef.current) {
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
    }
  }, [])

  const finish = useCallback(() => {
    clearTimer()
    setActiveSynced(false)
    const id = tabIdRef.current
    tabIdRef.current = null
    if (id) handlersRef.current.closeReplayTab(id)
    handlersRef.current.onFinish()
  }, [clearTimer, setActiveSynced])
  finishRef.current = finish

  const showAt = useCallback((i: number) => {
    const file = listRef.current[i]
    if (!file) {
      finishRef.current()
      return
    }
    indexRef.current = i
    setIndex(i)
    const prevId = tabIdRef.current
    const nextId = handlersRef.current.openReplayFile(file)
    if (!nextId) {
      skippedRef.current = [...skippedRef.current, { fullPath: file.fullPath, reason: 'unsaved' }]
      setSkipped(skippedRef.current)
      advanceRef.current(1)
      return
    }
    tabIdRef.current = nextId
    if (prevId && prevId !== nextId) handlersRef.current.closeReplayTab(prevId)
    const dwell = replayDurationMs(file)
    setDwellMs(dwell)
    baseDwellRef.current = dwell
    dwellTotalRef.current = dwell / speedRef.current
    armTimer(dwellTotalRef.current)
  }, [armTimer])
  showAtRef.current = showAt

  const advance = useCallback((dir: number) => {
    const next = indexRef.current + dir
    if (next < 0) return
    if (next >= listRef.current.length) {
      finishRef.current()
      return
    }
    showAtRef.current(next)
  }, [])
  advanceRef.current = advance

  const start = useCallback((list: ReplayList) => {
    if (activeRef.current || list.playable.length === 0) return
    clearTimer()
    listRef.current = list.playable
    skippedRef.current = [...list.preSkipped]
    setSkipped(skippedRef.current)
    setTotal(list.playable.length)
    indexRef.current = 0
    tabIdRef.current = null
    speedRef.current = DEFAULT_SPEED
    setSpeedState(DEFAULT_SPEED)
    pausedRef.current = false
    setPaused(false)
    skipListOpenRef.current = false
    setSkipListOpen(false)
    remainingRef.current = 0
    setActiveSynced(true)
    showAtRef.current(0)
  }, [activeRef, clearTimer, setActiveSynced])

  const stop = useCallback(() => {
    clearTimer()
    setActiveSynced(false)
    tabIdRef.current = null
    pausedRef.current = false
    setPaused(false)
    skipListOpenRef.current = false
    setSkipListOpen(false)
  }, [clearTimer, setActiveSynced])

  const toggle = useCallback(() => {
    if (!activeRef.current) return
    if (pausedRef.current) {
      pausedRef.current = false
      setPaused(false)
      armTimer(remainingRef.current)
    } else {
      latchElapsed()
      clearTimer()
      pausedRef.current = true
      setPaused(true)
    }
  }, [activeRef, armTimer, clearTimer, latchElapsed])

  const setSpeed = useCallback((next: ReplaySpeed) => {
    if (!activeRef.current) return
    const prev = speedRef.current
    if (prev === next) return
    latchElapsed()
    clearTimer()
    remainingRef.current = (remainingRef.current * prev) / next
    dwellTotalRef.current = (dwellTotalRef.current * prev) / next
    speedRef.current = next
    setSpeedState(next)
    if (!pausedRef.current) armTimer(remainingRef.current)
  }, [activeRef, armTimer, clearTimer, latchElapsed])

  const next = useCallback(() => {
    if (activeRef.current) advanceRef.current(1)
  }, [activeRef])

  const prev = useCallback(() => {
    if (activeRef.current) advanceRef.current(-1)
  }, [activeRef])

  const notifyUnreadable = useCallback((fullPath: string) => {
    if (!activeRef.current) return
    const current = listRef.current[indexRef.current]
    if (!current || current.fullPath !== fullPath) return
    skippedRef.current = [...skippedRef.current, { fullPath, reason: 'unreadable' }]
    setSkipped(skippedRef.current)
    advanceRef.current(1)
  }, [activeRef])

  // DiffViewer 报改动处数：用时长的上下界夹住按行数算出的值。
  // 处数多到分不够 → 延长（否则后面的改动看不到）；处数少 → 收短（三千行一处改动不该霸屏）
  const notifyHunkCount = useCallback((n: number) => {
    if (!activeRef.current) return
    // 大文件 Monaco 报 0 处（算不出差异）：按"一处改动"处理，走短时长
    const k = Math.max(1, n)
    // 全在基准单位上算，最后除 speed 折算成实际毫秒（与 DiffViewer 的 per 口径一致）
    const targetBase = Math.min(
      Math.max(baseDwellRef.current, k * MIN_HUNK_DWELL_MS),
      k * MAX_HUNK_DWELL_MS,
      MAX_DURATION_MS
    )
    const target = targetBase / speedRef.current
    if (Math.abs(target - dwellTotalRef.current) < 1) return
    const remaining = pausedRef.current
      ? remainingRef.current
      : Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
    const elapsed = dwellTotalRef.current - remaining
    dwellTotalRef.current = target
    setDwellMs(targetBase)
    clearTimer()
    remainingRef.current = Math.max(0, target - elapsed)
    if (!pausedRef.current) armTimer(remainingRef.current)
  }, [activeRef, armTimer, clearTimer])

  const toggleSkipList = useCallback(() => {
    skipListOpenRef.current = !skipListOpenRef.current
    setSkipListOpen(skipListOpenRef.current)
  }, [])

  const closeSkipList = useCallback(() => {
    skipListOpenRef.current = false
    setSkipListOpen(false)
  }, [])

  return {
    active, activeRef, paused, index, total, speed, dwellMs, skipped, skipListOpen, skipListOpenRef, tabIdRef,
    start, stop, toggle, prev, next, setSpeed, notifyUnreadable, notifyHunkCount, toggleSkipList, closeSkipList,
  }
}
