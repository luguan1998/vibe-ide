import { getPetLogicalStateOverride } from './petSettings'

// App 级逻辑状态：idle 空闲 / busy 忙碌 / warn 警告 / unfocused 未聚焦。
// 优先级（高→低）：warn > busy > unfocused > idle。
// doubleTap / sendMessage 为单次触发事件，不参与持久状态优先级链。
export type PetLogicalState = 'idle' | 'busy' | 'warn' | 'unfocused' | 'doubleTap' | 'sendMessage'

// 逻辑状态 → manifest 默认 state 名（用户可在设置里覆盖）。
export const DEFAULT_PET_LOGICAL_STATE: Record<PetLogicalState, string> = {
  idle: 'idle',
  busy: 'running',
  warn: 'failed',
  unfocused: 'waiting',
  doubleTap: 'waving',
  sendMessage: 'jumping',
}

export const PET_LOGICAL_STATES: PetLogicalState[] = ['idle', 'busy', 'warn', 'unfocused', 'doubleTap', 'sendMessage']

export const PET_LOGICAL_LABEL: Record<PetLogicalState, string> = {
  idle: 'Pet State: Idle',
  busy: 'Pet State: Busy',
  warn: 'Pet State: Warn',
  unfocused: 'Pet State: Unfocused',
  doubleTap: 'Pet State: Double Tap',
  sendMessage: 'Pet State: Send Message',
}

export const PET_LOGICAL_DESC: Record<PetLogicalState, string> = {
  idle: 'Shown when nothing is busy.',
  busy: 'Shown when the active session terminal or AI tab is busy.',
  warn: 'Shown when any session has a pending warning. Overrides busy.',
  unfocused: 'Shown when the app window is not focused.',
  doubleTap: 'Triggered once on double-clicking the pet. Default: wave.',
  sendMessage: 'Triggered once when the pet sends a message. Default: jumping.',
}

// 持久状态（参与优先级链）
export const PERSISTENT_LOGICAL_STATES: PetLogicalState[] = ['idle', 'busy', 'warn', 'unfocused']

// 单次触发状态
export const TRANSIENT_LOGICAL_STATES: PetLogicalState[] = ['doubleTap', 'sendMessage']

// 逻辑状态 → manifest state 名。用户覆盖优先，否则取默认。
export function resolveStateName(logical: PetLogicalState): string {
  const override = getPetLogicalStateOverride(logical)
  if (override === '') return resolveStateName('idle')
  return override ?? DEFAULT_PET_LOGICAL_STATE[logical]
}
