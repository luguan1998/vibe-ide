import React from 'react'
import { mujicaStore, useMujica } from '../mujicaStore'
import { MUJICA_CLOSE } from './GameMujica'
import mujicaIcon from '@renderer/assets/mujica.png?inline'
import type { AiPermissionMode } from '@shared/types'

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
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

        <div>
          <div className="text-[11px] text-ide-text-muted mb-1">prompt · Ctrl+Enter = run all</div>
          <textarea
            value={m.prompt}
            onChange={e => mujicaStore.setPrompt(e.target.value)}
            onKeyDown={onPromptKey}
            placeholder="run on all agents…"
            className="w-full h-28 resize-none px-2 py-1.5 rounded text-xs bg-ide-panel border border-ide-border text-ide-text placeholder-ide-text-muted/60 outline-none focus:border-ide-accent"
          />
        </div>

        <button
          onClick={() => mujicaStore.runAll()}
          disabled={m.workspaces.length === 0 || !m.prompt.trim()}
          className="w-full px-2 py-1.5 rounded text-xs bg-ide-accent text-white hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          run all
        </button>
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
