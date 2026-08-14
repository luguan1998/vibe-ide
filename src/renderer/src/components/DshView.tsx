import React, { useEffect, useState } from 'react'
import { getSharedDshContext, type DshContextHandle } from '../dsh/context'

interface DshViewProps {
  sessionId: string
  cwd: string
  isActive: boolean
}

export default function DshView({ sessionId, cwd, isActive }: DshViewProps) {
  const [handle, setHandle] = useState<DshContextHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

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
      try {
        // Session must belong to a workspace for the hero chip/composer to activate
        const workspace = await workspaces.create({ path: cwd })
        await sessions.create({ workspaceId: workspace.workspaceId, sessionId })
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
  }, [sessionId, cwd])

  // The shared context has one current session; opening on activation keeps
  // every mounted view pointed at the session the user is actually looking at.
  useEffect(() => {
    if (!handle || !ready || !isActive) return
    ;(handle.ctx.get('sessions') as any).open(sessionId)
  }, [handle, ready, isActive, sessionId])

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
