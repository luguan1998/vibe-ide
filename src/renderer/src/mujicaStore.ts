import { useSyncExternalStore } from 'react'
import { aiStore } from './aiStore'
import type { AiPermissionMode } from '@shared/types'

export interface MujicaWorkspace { id: string; label: string }

export interface MujicaState {
  active: boolean
  baseRepo: string | null
  defaultCwd: string | null
  model: string
  workspaces: MujicaWorkspace[]
  hoveredId: string | null
  prompt: string
  permissionMode: AiPermissionMode
}

const INITIAL: MujicaState = {
  active: false,
  baseRepo: null,
  defaultCwd: null,
  model: '',
  workspaces: [],
  hoveredId: null,
  prompt: '',
  permissionMode: 'bypassPermissions',
}

let state: MujicaState = { ...INITIAL }
const listeners = new Set<() => void>()
let hideTimer: ReturnType<typeof setTimeout> | null = null

function emit() { for (const l of listeners) l() }
function set(updater: (s: MujicaState) => MujicaState) { state = updater(state); emit() }

function makeId(): string {
  return `mujica-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

// Effective base repo = explicitly picked repo, else the active session's cwd
// (kept in sync by App.tsx via setDefaultCwd).
function effectiveCwd(): string | null {
  return state.baseRepo ?? state.defaultCwd
}

// Singleton store shared by the center canvas (GameMujica) and the right-panel
// config (MujicaConfig) — both live in different parts of the React tree, so a
// module-level store (same pattern as aiStore) avoids prop threading through
// App/RightPanel. State survives mujica hide (active=false); only clearAll / app
// quit resets it, so closing the game = just hiding (long-lived lifecycle).
export const mujicaStore = {
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } },
  getSnapshot: () => state,
  setActive(v: boolean) { set(s => ({ ...s, active: v })) },
  setBaseRepo(p: string | null) { set(s => ({ ...s, baseRepo: p })) },
  setDefaultCwd(cwd: string | null) { set(s => ({ ...s, defaultCwd: cwd })) },
  setModel(m: string) { set(s => ({ ...s, model: m })) },
  setPrompt(p: string) { set(s => ({ ...s, prompt: p })) },
  setPermissionMode(m: AiPermissionMode) { set(s => ({ ...s, permissionMode: m })) },
  async pickRepo() {
    const r = await window.api.workspace.pickDir()
    if (r.canceled) return
    set(s => ({ ...s, baseRepo: r.path }))
  },
  addWorkspace() {
    const cwd = effectiveCwd()
    if (!cwd) return
    const id = makeId()
    const label = `Agent ${state.workspaces.length + 1}`
    set(s => ({ ...s, workspaces: [...s.workspaces, { id, label }], hoveredId: id }))
    aiStore.ensureCreated(id, {
      cwd,
      autoApprove: true,
      permissionMode: state.permissionMode,
      enableWorktree: true,
      model: state.model || undefined,
    })
  },
  clearAll() {
    for (const ws of state.workspaces) {
      window.api.ai.destroy(ws.id)
      aiStore.clearSession(ws.id)
    }
    set(s => ({ ...s, workspaces: [], hoveredId: null }))
  },
  runAll() {
    const p = state.prompt.trim()
    if (!p) return
    for (const ws of state.workspaces) window.api.ai.send(ws.id, p)
  },
  runOne(id: string) {
    const p = state.prompt.trim()
    if (!p) return
    window.api.ai.send(id, p)
  },
  // Hover output: show on hover, hide shortly after the mouse leaves node/overlay.
  // The 200ms grace lets the mouse travel from a node to the output overlay so it
  // can be scrolled / its permission buttons clicked — but it is NOT persistent.
  hover(id: string) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    set(s => ({ ...s, hoveredId: id }))
  },
  cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
  },
  scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { hideTimer = null; set(s => ({ ...s, hoveredId: null })) }, 200)
  },
}

export function useMujica(): MujicaState {
  return useSyncExternalStore(mujicaStore.subscribe, mujicaStore.getSnapshot)
}
