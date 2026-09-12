import { useCallback, useMemo, useRef, useState } from 'react'
import { FileTab, MAX_FILE_TABS, tabKey } from '../fileTabs'

export function useFileTabs(isEvictable?: (id: string) => boolean) {
  const [tabs, setTabs] = useState<FileTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabsRef = useRef<FileTab[]>([])
  const activeTabIdRef = useRef<string | null>(null)
  const usageRef = useRef(new Map<string, number>())
  const usageSeqRef = useRef(0)
  const isEvictableRef = useRef(isEvictable)
  isEvictableRef.current = isEvictable

  const apply = useCallback((next: FileTab[], nextActive?: string | null) => {
    tabsRef.current = next
    setTabs(next)
    if (nextActive !== undefined) {
      activeTabIdRef.current = nextActive
      setActiveTabId(nextActive)
    }
  }, [])

  const touch = useCallback((id: string) => {
    usageRef.current.set(id, ++usageSeqRef.current)
  }, [])

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) ?? null, [tabs, activeTabId])

  const openTab = useCallback((build: () => FileTab) => {
    const probe = build()
    const key = tabKey(probe)
    const exist = tabsRef.current.find(t => tabKey(t) === key)
    if (exist) {
      touch(exist.id)
      apply(tabsRef.current, exist.id)
      return { tab: exist, existed: true as const, evicted: null as FileTab | null }
    }
    let next = [...tabsRef.current, probe]
    let evicted: FileTab | null = null
    if (next.length > MAX_FILE_TABS) {
      const candidates = next
        .filter(t => t.id !== probe.id && (isEvictableRef.current?.(t.id) ?? true))
        .sort((a, b) => (usageRef.current.get(a.id) ?? 0) - (usageRef.current.get(b.id) ?? 0))
      evicted = candidates[0] ?? null
      if (evicted) next = next.filter(t => t.id !== evicted!.id)
    }
    touch(probe.id)
    apply(next, probe.id)
    return { tab: probe, existed: false as const, evicted }
  }, [apply, touch])

  const activateTab = useCallback((id: string) => {
    touch(id)
    activeTabIdRef.current = id
    setActiveTabId(id)
  }, [touch])

  const closeTab = useCallback((id: string) => {
    const list = tabsRef.current
    const idx = list.findIndex(t => t.id === id)
    if (idx === -1) return activeTabIdRef.current
    const next = list.filter(t => t.id !== id)
    usageRef.current.delete(id)
    let nextActive: string | null = activeTabIdRef.current
    if (activeTabIdRef.current === id || !next.some(t => t.id === activeTabIdRef.current)) {
      nextActive = next[idx]?.id ?? next[idx - 1]?.id ?? null
    }
    apply(next, nextActive)
    return nextActive
  }, [apply])

  const closeAll = useCallback(() => {
    usageRef.current.clear()
    apply([], null)
  }, [apply])

  const updateTab = useCallback((id: string, patch: Partial<FileTab>) => {
    const list = tabsRef.current
    const idx = list.findIndex(t => t.id === id)
    if (idx === -1) return
    const next = [...list]
    next[idx] = { ...list[idx], ...patch } as FileTab
    apply(next)
  }, [apply])

  return {
    tabs, activeTab, activeTabId, tabsRef,
    openTab, activateTab, closeTab, closeAll, updateTab,
  }
}
