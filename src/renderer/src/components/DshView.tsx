import React, { useEffect, useRef, useState } from 'react'
import { getSharedDshContext, type DshContextHandle } from '../dsh/context'

interface DshViewProps {
  sessionId: string
  cwd: string
  isActive: boolean
  dshSessionId?: string
  onAgentStatusChange?: (sessionId: string, status: 'running' | 'idle') => void
  onTitleChange?: (sessionId: string, title: string) => void
  onCommand?: (command: string) => void
}

export default function DshView({ sessionId, cwd, isActive, dshSessionId, onAgentStatusChange, onTitleChange, onCommand }: DshViewProps) {
  const [handle, setHandle] = useState<DshContextHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const lastTitleRef = useRef<string | undefined>(undefined)
  const lastUserTextRef = useRef<string | null>(null)
  const lastFetchAtRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      let port = await window.api.dsh.getPort()
      if (port === null) {
        const started = await window.api.dsh.start(cwd)
        if (!started.ok || started.port === undefined) {
          throw new Error(started.error ?? 'dsh server start failed')
        }
        port = started.port
      }
      if (cancelled) return
      const h = await getSharedDshContext(`http://127.0.0.1:${port}`)
      if (cancelled) return
      setHandle(h)
      const sessions = h.ctx.get('sessions') as any
      const workspaces = h.ctx.get('workspaces') as any
      const targetId = dshSessionId || sessionId
      try {
        // Session must belong to a workspace for the hero chip/composer to activate
        const workspace = await workspaces.create({ path: cwd })
        await sessions.create({ workspaceId: workspace.workspaceId, sessionId: targetId })
      } catch (e: any) {
        if (e?.name !== 'SessionCreateError') throw e
      }
      if (!cancelled) setReady(true)
    }
    boot().catch((e: any) => {
      if (!cancelled) setError(e?.message ?? String(e))
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, cwd, dshSessionId])

  // The shared context has one current session; opening on activation keeps
  // every mounted view pointed at the session the user is actually looking at.
  useEffect(() => {
    if (!handle || !ready || !isActive) return
    ;(handle.ctx.get('sessions') as any).open(dshSessionId || sessionId)
  }, [handle, ready, isActive, sessionId, dshSessionId])

  // 把 dsh 会话 running/idle 状态与标题变化上报给 App（sessions.list 快照订阅）
  useEffect(() => {
    if (!handle || !ready || (!onAgentStatusChange && !onTitleChange && !onCommand)) return
    const sessions = handle.ctx.get('sessions') as any
    const targetId = dshSessionId || sessionId
    // dsh 无本地输入记录：快照变化时拉取会话最新 user 消息，新文本上报 App 命令历史（Ctrl+R 复用）
    const reportLatestUserMessage = async () => {
      if (!onCommand) return
      if (Date.now() - lastFetchAtRef.current < 1000) return
      lastFetchAtRef.current = Date.now()
      try {
        const api = (handle.ctx.get('connection') as any).api
        const res = await api.sessions.history({ sessionId: targetId, maxMessages: 5 })
        if (!res.result?.ok) return
        const events = ((res.result.value?.events ?? []) as any[]).map((e: any) => e.event)
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i]
          // 只取用户真实输入：dsh 会把系统上下文投影/工具结果也落成 user/message（source.kind 区分）
          if (ev?.type !== 'user/message' || ev.data?.source?.kind !== 'user') continue
          const text = (ev.data?.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('')
          if (text && text !== lastUserTextRef.current) {
            lastUserTextRef.current = text
            onCommand(text)
          }
          break
        }
      } catch {}
    }
    const report = () => {
      const snap = sessions.list.getSnapshot()
      const cur = snap.byId?.[targetId]
      if (onAgentStatusChange) {
        const running = !!cur?.running
        onAgentStatusChange(sessionId, running ? 'running' : 'idle')
      }
      if (onTitleChange) {
        // 持久化 title 优先，无则用派生的 displayTitle（目录名/id）
        const title = cur?.title ?? cur?.displayTitle
        if (typeof title === 'string' && title !== lastTitleRef.current) {
          lastTitleRef.current = title
          onTitleChange(sessionId, title)
        }
      }
      void reportLatestUserMessage()
    }
    report()
    const off = sessions.list.subscribe(report)
    return () => {
      off()
      onAgentStatusChange?.(sessionId, 'idle')
    }
  }, [handle, ready, sessionId, dshSessionId, onAgentStatusChange, onTitleChange, onCommand])

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ide-text-muted text-sm">
        <div className="text-ide-danger">dsh: {error}</div>
        <button
          className="px-3 py-1 rounded bg-ide-hover hover:bg-ide-accent hover:text-white transition-colors text-xs"
          onClick={() => { setError(null); setHandle(null); setReady(false) }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="dsh-view flex-1 flex flex-col overflow-hidden">
      {!ready && (
        <div className="flex-1 flex items-center justify-center text-ide-text-muted text-sm">dsh connecting...</div>
      )}
      <div className="flex-1 min-h-0 flex flex-col" style={{ display: ready ? 'flex' : 'none' }}>
        {handle && <DshSlot handle={handle} />}
      </div>
    </div>
  )
}

function DshSlot({ handle }: { handle: DshContextHandle }) {
  const [node, setNode] = useState<React.ReactNode>(null)
  useEffect(() => {
    setNode(handle.ctx.slots.renderSlot('root', {}))
  }, [handle])
  return <>{node}</>
}
