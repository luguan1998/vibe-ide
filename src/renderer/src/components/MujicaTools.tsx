import React, { useEffect, useRef } from 'react'
import { aiStore, useAiSession } from '../aiStore'
import { mujicaStore } from '../mujicaStore'
import { ChatMarkdown, StreamingMarkdown } from './AiTab'
import type { AiPermissionRequest } from '@shared/types'

function PermissionCard({ id, perm }: { id: string; perm: AiPermissionRequest }) {
  const respond = (approved: boolean) => {
    aiStore.handlePermissionResponse(id, perm.requestId, approved, perm.tool, perm.toolInput)
  }
  const summary = perm.command || (perm.toolInput ? JSON.stringify(perm.toolInput).slice(0, 80) : '')
  return (
    <div className="border border-ide-warning/50 rounded p-2 text-xs space-y-1 bg-ide-hover/40">
      <div className="flex items-center gap-1 text-ide-warning font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-ide-warning" />
        {perm.tool}
      </div>
      {summary && <div className="text-ide-text-muted truncate font-mono">{summary}</div>}
      <div className="flex gap-2 pt-1">
        <button onClick={() => respond(true)} className="flex-1 px-2 py-1 rounded bg-ide-success/20 text-ide-success hover:bg-ide-success/30 transition-colors">Allow</button>
        <button onClick={() => respond(false)} className="flex-1 px-2 py-1 rounded bg-ide-danger/20 text-ide-danger hover:bg-ide-danger/30 transition-colors">Deny</button>
      </div>
    </div>
  )
}

function basename(p: string | undefined): string {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

// Persistent output pane: rendered while an agent node is pinned (click to pin,
// click again or ✕ to close). Wider than the old hover overlay so output is readable.
export default function MujicaOutput({ pinnedId }: { pinnedId: string }) {
  const s = useAiSession(pinnedId)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [s.messages, s.streamBuffer])

  return (
    <div className="absolute right-0 top-0 bottom-0 w-3/5 min-w-[720px] bg-ide-sidebar border-l border-ide-border shadow-2xl flex flex-col z-10">
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ide-text-muted bg-ide-hover/40 shrink-0">
        <span className="truncate flex-1">{basename(s.worktreePath) || 'agent output'}</span>
        <button
          onClick={() => mujicaStore.unpin()}
          title="close"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {s.pendingPermission && <PermissionCard id={pinnedId} perm={s.pendingPermission} />}
        {s.messages.map((m, i) => {
          if (m.type === 'user' && typeof m.content === 'string') {
            return <div key={i} className="text-right text-sm text-ide-text break-words">{m.content}</div>
          }
          if (m.type === 'assistant' && m.content) {
            return <ChatMarkdown key={i} text={m.content} workspacePath={s.worktreePath ?? null} />
          }
          if (m.type === 'result' && (m as any).error) {
            return <div key={i} className="text-xs text-ide-danger break-words">{(m as any).error}</div>
          }
          if (m.type === 'result') {
            const r = m as any
            return <div key={i} className="text-[11px] text-ide-text-muted">done · {r.numTurns ?? ''} turns {r.costUsd != null ? `· $${r.costUsd.toFixed(4)}` : ''}</div>
          }
          return null
        })}
        {s.streaming && s.streamBuffer && <StreamingMarkdown text={s.streamBuffer} workspacePath={s.worktreePath ?? null} />}
      </div>
    </div>
  )
}
