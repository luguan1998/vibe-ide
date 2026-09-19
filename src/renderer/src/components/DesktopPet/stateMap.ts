import { getPetLogicalStateOverride } from './petSettings'

// App 级逻辑状态：idle 空闲 / busy 忙碌 / approval 审批 / unfocused 未聚焦。
// 优先级（高→低）：approval > busy > unfocused > idle。
// doubleTap / sendMessage 为单次触发事件，不参与持久状态优先级链。
export type PetLogicalState = 'idle' | 'busy' | 'approval' | 'unfocused' | 'doubleTap' | 'sendMessage'

// 逻辑状态 → manifest 默认 state 名（用户可在设置里覆盖）。
export const DEFAULT_PET_LOGICAL_STATE: Record<PetLogicalState, string> = {
  idle: 'idle',
  busy: 'running',
  approval: 'review',
  unfocused: 'waiting',
  doubleTap: 'waving',
  sendMessage: 'jumping',
}

export const PET_LOGICAL_STATES: PetLogicalState[] = ['idle', 'busy', 'approval', 'unfocused', 'doubleTap', 'sendMessage']

export const PET_LOGICAL_LABEL: Record<PetLogicalState, string> = {
  idle: 'Pet Idle',
  busy: 'Pet Busy',
  approval: 'Pet Approval',
  unfocused: 'Pet Sleep',
  doubleTap: 'Pet Double Tap',
  sendMessage: 'Pet Send Message',
}

// 单次触发状态
export const TRANSIENT_LOGICAL_STATES: PetLogicalState[] = ['doubleTap', 'sendMessage']

// 逻辑状态 → manifest state 名。用户覆盖优先，否则取默认。
export function resolveStateName(logical: PetLogicalState): string {
  const override = getPetLogicalStateOverride(logical)
  if (override === '') return resolveStateName('idle')
  return override ?? DEFAULT_PET_LOGICAL_STATE[logical]
}
