export type PetActiveState = 'idle' | 'running'

// App 级状态 → manifest 内 state 名。manifest 默认含 idle(row0) 与 running(row7)。
export function resolveStateName(active: PetActiveState): string {
  return active === 'running' ? 'running' : 'idle'
}
