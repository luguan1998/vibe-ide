// Program Status Protocol (OSC 7501)：程序把自身状态(idle/working/done/blocked/error)报给终端。
// 规范：https://www.superlogical.com/rex/docs/build/program-status
export type ProgramState = 'idle' | 'working' | 'done' | 'blocked' | 'error' | 'clear'
export type ProgramBlockedKind = 'permission' | 'question' | 'auth'

export interface ProgramStatus {
  state: ProgramState
  kind?: ProgramBlockedKind
  progress?: number
  app?: string
  title?: string
  msg?: string
}

export const PROGRAM_STATUS_OSC = 7501

export const PROGRAM_STATUS_QUERY_REPLY =
  '\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\'

const KEY_RE = /^[a-z]{1,16}$/
const VALUE_RE = /^[A-Za-z0-9_.,+/=-]*$/
const APP_RE = /^[A-Za-z0-9_.+-]{1,32}$/
const PROGRESS_RE = /^\d{1,3}$/
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/
const STATES = new Set<string>(['idle', 'working', 'done', 'blocked', 'error', 'clear'])
const KINDS = new Set<string>(['permission', 'question', 'auth'])
const TEXT_LIMITS = { title: { encoded: 256, decoded: 192 }, msg: { encoded: 2732, decoded: 2048 } }

function decodeText(encoded: string, limit: { encoded: number; decoded: number }): string | null {
  if (encoded.length > limit.encoded) return null
  try {
    const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4)
    const raw = atob(padded)
    if (raw.length > limit.decoded) return null
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return CONTROL_RE.test(text) ? null : text
  } catch {
    return null
  }
}

// 只支持 root record（无 id）；带合法 id 的子记录直接忽略，不影响 root
export function parseProgramStatus(body: string): ProgramStatus | null {
  if (!body || body.length > 4096) return null
  const pairs = new Map<string, string>()
  for (const part of body.split(':')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!KEY_RE.test(key) || !VALUE_RE.test(value)) continue
    pairs.set(key, value)
  }
  const state = pairs.get('state')
  if (!state || !STATES.has(state)) return null
  if (pairs.has('id')) return null
  if (state === 'clear') return { state }
  const status: ProgramStatus = { state: state as ProgramState }
  if (state === 'blocked') {
    const kind = pairs.get('kind')
    if (kind && KINDS.has(kind)) status.kind = kind as ProgramBlockedKind
  }
  if (state === 'working' || state === 'blocked') {
    const progress = pairs.get('progress')
    if (progress && PROGRESS_RE.test(progress) && Number(progress) <= 100) status.progress = Number(progress)
  }
  const app = pairs.get('app')
  if (app && APP_RE.test(app)) status.app = app
  for (const key of ['title', 'msg'] as const) {
    const encoded = pairs.get(key)
    if (!encoded) continue
    const text = decodeText(encoded, TEXT_LIMITS[key])
    if (text === null) return null
    if (text) status[key] = text
  }
  return status
}
