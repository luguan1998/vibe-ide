import React from 'react'
import { mujicaStore, useMujica } from '../mujicaStore'
import type { MujicaWorkspace } from '../mujicaStore'
import { useAiSession } from '../aiStore'
import { MUJICA_CLOSE } from './GameMujica'
import mujicaIcon from '@renderer/assets/mujica.png?inline'
import type { AiPermissionMode, AiSessionState } from '@shared/types'

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

// Same status derivation as the canvas node (MujicaCanvas STATUS_STYLE).
function statusOf(st?: AiSessionState): { dot: string; label: string } {
  if (!st || !st.ready) return { dot: 'bg-ide-text-muted/60 animate-pulse', label: 'creating' }
  if (st.messages.some(m => m.type === 'result' && (m as any).error)) return { dot: 'bg-ide-danger', label: 'error' }
  if (st.busy || st.streaming) return { dot: 'bg-ide-success animate-pulse', label: 'running' }
  if (st.messages.some(m => m.type === 'result')) return { dot: 'bg-ide-accent', label: 'done' }
  return { dot: 'bg-ide-text-muted', label: 'idle' }
}

function isIdle(st?: AiSessionState): boolean {
  if (!st) return true
  return st.ready && !st.busy && !st.streaming && st.messages.length === 0
}

function AgentCard({ ws }: { ws: MujicaWorkspace }) {
  const s = useAiSession(ws.id)
  const st = statusOf(s)
  const idle = isIdle(s)
  const disabled = !idle
  return (
    <div className="rounded border border-ide-border bg-ide-panel/50 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
        <span className="text-[10px] uppercase tracking-wider text-ide-text-muted">{st.label}</span>
        <span className="flex-1" />
        {!idle && <span className="text-[10px] text-ide-text-muted/60">locked</span>}
      </div>
      <input
        value={ws.label}
        onChange={e => mujicaStore.setLabel(ws.id, e.target.value)}
        disabled={disabled}
        title={disabled ? 'locked while running' : ''}
        className="w-full px-2 py-1 rounded text-xs bg-ide-panel border border-ide-border text-ide-text outline-none focus:border-ide-accent disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <textarea
        value={ws.persona}
        onChange={e => mujicaStore.setPersona(ws.id, e.target.value)}
        onBlur={() => mujicaStore.commitPersona(ws.id)}
        disabled={disabled}
        placeholder="persona · injected as system prompt…"
        className="w-full h-20 resize-none px-2 py-1.5 rounded text-xs bg-ide-panel border border-ide-border text-ide-text placeholder-ide-text-muted/60 outline-none focus:border-ide-accent disabled:opacity-40 disabled:cursor-not-allowed"
      />
    </div>
  )
}

// Right-panel config (rendered by GameLauncher's "Nga" tab when mujica is active).
// All state lives in mujicaStore so the center canvas stays in sync.
export default function MujicaConfig() {
  const m = useMujica()
  const close = () => window.dispatchEvent(new CustomEvent(MUJICA_CLOSE))
  const effectiveRepo = m.baseRepo ?? m.defaultCwd
  const onPromptKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      mujicaStore.runAll()
    }
  }
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 bg-ide-hover/50 border-b border-ide-border shrink-0 flex items-center justify-between select-none">
        <img src={mujicaIcon} alt="Mujica" className="w-4 h-4 object-contain" />
        <span className="text-xs font-bold text-ide-text-muted uppercase tracking-wider">MUJICA</span>
        <button onClick={close} className="text-[11px] text-ide-text-muted hover:text-ide-text transition-colors">close</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* shared prompt — broadcast to all agents; highest priority config */}
        <div>
          <div className="text-[11px] text-ide-text-muted mb-1">shared prompt · Ctrl+Enter = run all</div>
          <textarea
            value={m.prompt}
            onChange={e => mujicaStore.setPrompt(e.target.value)}
            onKeyDown={onPromptKey}
            placeholder="run on all agents…"
            className="w-full h-28 resize-none px-2 py-1.5 rounded text-xs bg-ide-panel border border-ide-border text-ide-text placeholder-ide-text-muted/60 outline-none focus:border-ide-accent"
          />
          <button
            onClick={() => mujicaStore.runAll()}
            disabled={m.workspaces.length === 0 || !m.prompt.trim()}
            className="mt-1.5 w-full px-2 py-1.5 rounded text-xs bg-ide-accent text-white hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            run all
          </button>
        </div>

        {/* base repo — defaults to the active session cwd; 📁 browses for another */}
        <div>
          <div className="text-[11px] text-ide-text-muted mb-1">base repo</div>
          <div className="flex items-center gap-1">
            <div className="flex-1 min-w-0 px-2 py-1.5 rounded text-xs bg-ide-panel border border-ide-border text-ide-text truncate" title={effectiveRepo ?? ''}>
              {effectiveRepo ? basename(effectiveRepo) : 'no repo'}
            </div>
            <button
              onClick={() => mujicaStore.pickRepo()}
              className="shrink-0 px-2 py-1.5 rounded text-xs bg-ide-panel border border-ide-border hover:bg-ide-hover transition-colors text-ide-text"
              title="browse folder"
            >
              📁
            </button>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-[10px] text-ide-text-muted/70 truncate flex-1 mr-2">
              {m.baseRepo ? 'picked' : (m.defaultCwd ? 'session cwd' : '')}
            </span>
            {m.baseRepo && (
              <button
                onClick={() => mujicaStore.setBaseRepo(null)}
                className="text-[10px] text-ide-text-muted hover:text-ide-text transition-colors shrink-0"
              >
                reset
              </button>
            )}
          </div>
        </div>

        <button
          onClick={() => mujicaStore.addWorkspace()}
          disabled={!effectiveRepo}
          className="w-full px-2 py-1.5 rounded text-xs bg-ide-accent/15 text-ide-accent hover:bg-ide-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + add agent
        </button>

        {/* model — applies to newly spawned agents */}
        <div>
          <div className="text-[11px] text-ide-text-muted mb-1">model <span className="text-ide-text-muted/60">(new agents)</span></div>
          <input
            list="mujica-models"
            value={m.model}
            onChange={e => mujicaStore.setModel(e.target.value)}
            placeholder="default"
            className="w-full px-2 py-1 rounded text-xs bg-ide-panel border border-ide-border text-ide-text placeholder-ide-text-muted/60 outline-none focus:border-ide-accent"
          />
          <datalist id="mujica-models">
            <option value="sonnet" />
            <option value="opus" />
            <option value="haiku" />
          </datalist>
        </div>

        <div>
          <div className="text-[11px] text-ide-text-muted mb-1">permission mode</div>
          <select
            value={m.permissionMode}
            onChange={e => mujicaStore.setPermissionMode(e.target.value as AiPermissionMode)}
            className="w-full px-2 py-1 rounded text-xs bg-ide-panel border border-ide-border text-ide-text"
          >
            <option value="bypassPermissions">auto (bypass)</option>
            <option value="acceptEdits">accept edits</option>
            <option value="plan">plan</option>
          </select>
        </div>

        {/* per-agent persona & name — editable only while idle */}
        <div>
          <div className="text-[11px] text-ide-text-muted mb-1">agents <span className="text-ide-text-muted/60">· persona & name (idle only)</span></div>
          {m.workspaces.length === 0 ? (
            <div className="text-[11px] text-ide-text-muted/70">no agents yet</div>
          ) : (
            <div className="space-y-2">
              {m.workspaces.map(ws => (
                <AgentCard key={ws.id} ws={ws} />
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => mujicaStore.clearAll()}
          disabled={m.workspaces.length === 0}
          className="w-full px-2 py-1.5 rounded text-xs text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover border border-ide-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          clear all
        </button>

        <div className="text-[11px] text-ide-text-muted/70 pt-1 leading-relaxed">
          {m.workspaces.length} agent(s) on the canvas.<br />
          click a node to pin its output · click ▶ on a node to run just that agent.
        </div>
      </div>
    </div>
  )
}
