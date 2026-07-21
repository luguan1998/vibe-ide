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
  pinnedId: string | null
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
  pinnedId: null,
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
    set(s => ({ ...s, workspaces: [...s.workspaces, { id, label }], pinnedId: id }))
    aiStore.ensureCreated(id, {
      cwd,
      autoApprove: true,
      permissionMode: state.permissionMode,
      enableWorktree: true,
      model: state.model || undefined,
    })
  },
  removeWorkspace(id: string) {
    window.api.ai.destroy(id)
    aiStore.clearSession(id)
    set(s => ({
      ...s,
      workspaces: s.workspaces.filter(w => w.id !== id),
      hoveredId: s.hoveredId === id ? null : s.hoveredId,
      pinnedId: s.pinnedId === id ? null : s.pinnedId,
    }))
  },
  clearAll() {
    for (const ws of state.workspaces) {
      window.api.ai.destroy(ws.id)
      aiStore.clearSession(ws.id)
    }
    set(s => ({ ...s, workspaces: [], hoveredId: null, pinnedId: null }))
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
  // hover drives only the node highlight ring now (output is click-to-pin below).
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
  // Click-to-pin output: a pinned agent's output pane stays open (persistent,
  // scrollable, wider) until the same node is clicked again or the pane is closed.
  togglePin(id: string) {
    set(s => ({ ...s, pinnedId: s.pinnedId === id ? null : id }))
  },
  unpin() {
    set(s => ({ ...s, pinnedId: null }))
  },
}

export function useMujica(): MujicaState {
  return useSyncExternalStore(mujicaStore.subscribe, mujicaStore.getSnapshot)
}
