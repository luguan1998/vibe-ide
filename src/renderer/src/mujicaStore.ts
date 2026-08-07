import { useSyncExternalStore } from 'react'
import { aiStore } from './aiStore'
import { MUJICA_PERSONAS } from './mujicaPersonas'
import type { MujicaPersona } from './mujicaPersonas'
import type { AiPermissionMode, AiSessionState } from '@shared/types'

export interface MujicaWorkspace { id: string; label: string; worktree: boolean; persona: string }

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

// Random persona for a new agent; as long as some preset is unused by existing
// workspaces, pick only from the unused ones so the 5 members don't repeat
// before each has appeared once. After the first round, fall back to all presets.
function pickPersona(): MujicaPersona | undefined {
  const used = new Set(state.workspaces.map(w => w.persona))
  const unused = MUJICA_PERSONAS.filter(p => !used.has(p.prompt))
  const pool = unused.length > 0 ? unused : MUJICA_PERSONAS
  return pool[Math.floor(Math.random() * pool.length)]
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
    const picked = pickPersona()
    const label = picked ? picked.name : `Agent ${state.workspaces.length + 1}`
    const persona = picked ? picked.prompt : ''
    const ws: MujicaWorkspace = { id, label, worktree: true, persona }
    set(s => ({ ...s, workspaces: [...s.workspaces, ws] }))
    aiStore.ensureCreated(id, {
      cwd,
      autoApprove: true,
      permissionMode: state.permissionMode,
      enableWorktree: ws.worktree,
      persona,
      model: state.model || undefined,
    })
  },
  setLabel(id: string, label: string) {
    set(s => ({ ...s, workspaces: s.workspaces.map(w => w.id === id ? { ...w, label } : w) }))
  },
  setPersona(id: string, text: string) {
    set(s => ({ ...s, workspaces: s.workspaces.map(w => w.id === id ? { ...w, persona: text } : w) }))
  },
  // onBlur commit: persona only reaches the CLI at spawn time (--append-system-prompt),
  // so an idle agent is destroyed + respawned with the new persona. If the agent has
  // run (messages/busy) the respawn is skipped — the config UI disables editing then.
  commitPersona(id: string) {
    const cwd = effectiveCwd()
    if (!cwd) return
    const ws = state.workspaces.find(w => w.id === id)
    if (!ws) return
    const s = aiStore.getSessionState(id)
    if (!s.busy && !s.streaming && s.messages.length === 0) {
      window.api.ai.destroy(id)
      aiStore.clearSession(id)
      aiStore.ensureCreated(id, {
        cwd,
        autoApprove: true,
        permissionMode: state.permissionMode,
        enableWorktree: ws.worktree,
        persona: ws.persona,
        model: state.model || undefined,
      })
    }
  },
  // Toggle worktree isolation for an idle agent: destroy + respawn the session so
  // --worktree takes effect at spawn time. Only callable before the agent has run
  // (canvas disables the button once messages exist / it's busy).
  setWorktree(id: string, enabled: boolean) {
    const cwd = effectiveCwd()
    if (!cwd) return
    set(s => ({ ...s, workspaces: s.workspaces.map(w => w.id === id ? { ...w, worktree: enabled } : w) }))
    const s = aiStore.getSessionState(id)
    if (s.ready || s.messages.length > 0) {
      window.api.ai.destroy(id)
      aiStore.clearSession(id)
    }
    aiStore.ensureCreated(id, {
      cwd,
      autoApprove: true,
      permissionMode: state.permissionMode,
      enableWorktree: enabled,
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

// Agent 空闲口径与 MujicaConfig.isIdle 一致：非空闲 = 未 ready（creating）/ busy / streaming / 已有消息。
function isAgentBusy(s: AiSessionState): boolean {
  return !s.ready || s.busy || s.streaming || s.messages.length > 0
}

function subscribeMujicaCounts(cb: () => void) {
  const un1 = mujicaStore.subscribe(cb)
  const un2 = aiStore.subscribe(cb)
  return () => { un1(); un2() }
}

function getMujicaCounts(): string {
  let total = 0
  let active = 0
  for (const ws of state.workspaces) {
    total++
    if (isAgentBusy(aiStore.getSessionState(ws.id))) active++
  }
  return `${active}/${total}`
}

// "Mujica a/b"：b=创建 agent 数，a=非空闲 agent 数。返回字符串快照，
// 字符串不变时 useSyncExternalStore 不触发 re-render（ai 高频 emit 但计数不动的场景）。
export function useMujicaCounts(): string {
  return useSyncExternalStore(subscribeMujicaCounts, getMujicaCounts)
}
