export type PiExtensionUiRequest =
  | { id: string; method: 'select'; title: string; options: string[] }
  | { id: string; method: 'confirm'; title: string; message: string }
  | { id: string; method: 'input' | 'editor'; title: string }
  | { id: string; method: 'notify' | 'setStatus' | 'setWidget' | 'setTitle' | 'set_editor_text'; title?: string }

type PiRpcResponse = {
  id?: string
  command: string
  success: boolean
  error?: string
  data?: unknown
}

type PiToolCall = { id: string; name: string; input: Record<string, any> }
type PiToolResult = { toolCallId: string; name: string; content: string; isError: boolean }

export function asRecord(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
  return null
}

export function stringField(rec: Record<string, any> | null | undefined, key: string): string | undefined {
  if (!rec) return undefined
  const value = rec[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberField(rec: Record<string, any> | null | undefined, key: string): number | undefined {
  const value = rec?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function parseJsonLine(line: string): Record<string, any> | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    return asRecord(JSON.parse(trimmed))
  } catch {
    return null
  }
}

function tryParseJsonRecord(partial: string): Record<string, any> | null {
  try {
    return asRecord(JSON.parse(partial))
  } catch {
    return null
  }
}

export function parseRpcResponse(rec: Record<string, any>): PiRpcResponse | null {
  if (stringField(rec, 'type') !== 'response') return null
  const command = stringField(rec, 'command') ?? 'unknown'
  const id = stringField(rec, 'id')
  const error = stringField(rec, 'error')
  return {
    ...(id ? { id } : {}),
    command,
    success: rec.success === true,
    ...(error ? { error } : {}),
    data: rec.data,
  }
}

/**
 * Spawn args for a live session. Intentionally omits `--no-extensions` so the
 * user's global Pi packages (todos, subagents, custom tools) still load.
 */
export function buildPiSpawnArgs(input: {
  model?: string
  resume?: string
  noSession?: boolean
  noExtensions?: boolean
  isolated?: boolean
}): string[] {
  const args = ['--mode', 'rpc']
  if (input.isolated || input.noSession) args.push('--no-session')
  if (input.isolated || input.noExtensions) args.push('--no-extensions')
  if (input.isolated) args.push('--no-tools', '--no-skills', '--no-context-files')
  if (input.resume?.trim()) args.push('--session', input.resume.trim())
  const model = input.model?.trim()
  if (model) args.push('--model', model)
  return args
}

export function parseExtensionUiRequest(rec: Record<string, any>): PiExtensionUiRequest | null {
  if (stringField(rec, 'type') !== 'extension_ui_request') return null
  const id = stringField(rec, 'id')
  const method = stringField(rec, 'method')
  if (!id || !method) return null
  if (method === 'select') {
    const options = Array.isArray(rec.options) ? rec.options.filter((item: unknown): item is string => typeof item === 'string') : []
    return { id, method, title: stringField(rec, 'title') ?? 'Choose an option', options }
  }
  if (method === 'confirm') {
    return { id, method, title: stringField(rec, 'title') ?? 'Confirm', message: stringField(rec, 'message') ?? '' }
  }
  if (method === 'input' || method === 'editor') {
    return { id, method, title: stringField(rec, 'title') ?? method }
  }
  if (method === 'notify' || method === 'setStatus' || method === 'setWidget' || method === 'setTitle' || method === 'set_editor_text') {
    return {
      id,
      method,
      title: stringField(rec, 'message') ?? stringField(rec, 'statusText') ?? stringField(rec, 'title') ?? stringField(rec, 'text'),
    }
  }
  return null
}

export function needsExtensionUiReply(request: PiExtensionUiRequest): boolean {
  return request.method === 'confirm' || request.method === 'select' || request.method === 'input' || request.method === 'editor'
}

export function extensionUiResponse(request: PiExtensionUiRequest, decision: 'allow' | 'deny', value?: string): Record<string, any> {
  if (decision === 'deny') return { type: 'extension_ui_response', id: request.id, cancelled: true }
  if (request.method === 'confirm') return { type: 'extension_ui_response', id: request.id, confirmed: true }
  if (request.method === 'select') return { type: 'extension_ui_response', id: request.id, value: value ?? request.options[0] ?? '' }
  if (request.method === 'input' || request.method === 'editor') {
    if (value === undefined) return { type: 'extension_ui_response', id: request.id, cancelled: true }
    return { type: 'extension_ui_response', id: request.id, value }
  }
  return { type: 'extension_ui_response', id: request.id, cancelled: true }
}

export function extensionUiTitle(request: PiExtensionUiRequest): string {
  const text = request.method === 'confirm'
    ? [request.title, request.message].filter(Boolean).join(' — ')
    : request.title ?? 'Pi extension'
  return stripAnsi(text)
}

// Pi's theme helpers emit ANSI even in RPC mode (e.g. Ponytail setStatus).
// Strip CSI and OSC sequences only at the display boundary: select replies
// must retain the original option string.
function stripAnsi(text: string): string {
  return text
    .replace(/(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)/g, '')
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, '')
}

export function sessionFromState(data: unknown): { sessionId?: string; contextWindow?: number; model?: string; thinkingLevel?: string } {
  const rec = asRecord(data)
  const model = asRecord(rec?.model)
  const window = numberField(model, 'contextWindow')
  const provider = stringField(model, 'provider')
  const modelId = stringField(model, 'id')
  return {
    sessionId: stringField(rec, 'sessionId'),
    ...(window && window > 0 ? { contextWindow: window } : {}),
    ...(provider && modelId ? { model: `${provider}/${modelId}` } : {}),
    ...(stringField(rec, 'thinkingLevel') ? { thinkingLevel: stringField(rec, 'thinkingLevel') } : {}),
  }
}

export function thinkingLevelsFromData(data: unknown): string[] {
  const rec = asRecord(data)
  const list = Array.isArray(rec?.levels) ? rec.levels : Array.isArray(data) ? data : []
  return list.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

export function contextFromUsage(rec: Record<string, any>, window?: number): { used?: number; window?: number } | null {
  const usage =
    asRecord(rec.usage) ??
    assistantMessageUsage(rec) ??
    asRecord(asRecord(asRecord(rec.assistantMessageEvent)?.partial)?.usage)
  if (!usage) return null
  const used =
    numberField(usage, 'totalTokens') ||
    (numberField(usage, 'input') ?? 0) + (numberField(usage, 'output') ?? 0) + (numberField(usage, 'cacheRead') ?? 0) + (numberField(usage, 'cacheWrite') ?? 0)
  if (!used) return window && window > 0 ? { window } : null
  return window && window > 0 ? { used, window } : { used }
}

export function contextFromSessionStats(data: unknown): { used?: number; window?: number } | null {
  const rec = asRecord(data)
  const usage = asRecord(rec?.contextUsage)
  if (!usage) return null
  const used = numberField(usage, 'tokens')
  const window = numberField(usage, 'contextWindow')
  if (!used && !window) return null
  return {
    ...(used ? { used } : {}),
    ...(window && window > 0 ? { window } : {}),
  }
}

export function assistantDeltaFromEvent(rec: Record<string, any>): { kind: 'text' | 'thinking'; text: string } | null {
  if (stringField(rec, 'type') !== 'message_update') return null
  const event = asRecord(rec.assistantMessageEvent)
  const delta = typeof event?.delta === 'string' ? event.delta : ''
  if (!delta) return null
  const type = stringField(event, 'type')
  if (type === 'text_delta') return { kind: 'text', text: delta }
  if (type === 'thinking_delta') return { kind: 'thinking', text: delta }
  return null
}

export function toolExecutionStartFromEvent(rec: Record<string, any>): PiToolCall | null {
  if (stringField(rec, 'type') !== 'tool_execution_start') return null
  const id = stringField(rec, 'toolCallId')
  if (!id) return null
  return { id, name: stringField(rec, 'toolName') ?? 'tool', input: toolArgsFromEvent(rec) }
}

export function toolExecutionUpdateFromEvent(rec: Record<string, any>): { id: string; input: Record<string, any> } | null {
  if (stringField(rec, 'type') !== 'tool_execution_update') return null
  const id = stringField(rec, 'toolCallId')
  if (!id) return null
  return { id, input: toolArgsFromEvent(rec) }
}

export function toolExecutionEndFromEvent(rec: Record<string, any>): PiToolResult | null {
  if (stringField(rec, 'type') !== 'tool_execution_end') return null
  const id = stringField(rec, 'toolCallId')
  if (!id) return null
  const result = asRecord(rec.result)
  return {
    toolCallId: id,
    name: stringField(rec, 'toolName') ?? 'tool',
    content: truncateToolResult(textFromContent(result?.content)),
    isError: rec.isError === true,
  }
}

export function turnErrorFromEvent(rec: Record<string, any>): string | null {
  if (stringField(rec, 'type') !== 'message_end') return null
  const message = asRecord(rec.message)
  if (stringField(message, 'role') !== 'assistant') return null
  if (stringField(message, 'stopReason') !== 'error') return null
  return stringField(message, 'errorMessage') ?? ''
}

export function isAgentSettled(rec: Record<string, any>): boolean {
  return stringField(rec, 'type') === 'agent_settled'
}

export function agentEndWillRetry(rec: Record<string, any>): boolean | null {
  if (stringField(rec, 'type') !== 'agent_end') return null
  return rec.willRetry === true
}

export function isAbortedAssistant(rec: Record<string, any>): boolean {
  if (stringField(rec, 'type') !== 'message_end') return false
  const message = asRecord(rec.message)
  return stringField(message, 'role') === 'assistant' && stringField(message, 'stopReason') === 'aborted'
}

export function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    const rec = asRecord(item)
    const text = stringField(rec, 'text')
    if (text) parts.push(text)
  }
  return parts.join('')
}

export function thinkingFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    const rec = asRecord(item)
    if (stringField(rec, 'type') !== 'thinking') continue
    const thinking = stringField(rec, 'thinking') ?? stringField(rec, 'text')
    if (thinking) parts.push(thinking)
  }
  return parts.join('\n\n')
}

export function toolCallsFromContent(content: unknown): PiToolCall[] {
  if (!Array.isArray(content)) return []
  const calls: PiToolCall[] = []
  for (const item of content) {
    const rec = asRecord(item)
    if (stringField(rec, 'type') !== 'toolCall') continue
    const id = stringField(rec, 'id')
    const name = stringField(rec, 'name')
    if (!id || !name) continue
    calls.push({ id, name, input: toolArgsFromEvent(rec) })
  }
  return calls
}

function toolArgsFromEvent(rec: Record<string, any> | null | undefined): Record<string, any> {
  return parseArgBag(rec?.arguments) ?? parseArgBag(rec?.args) ?? parseArgBag(rec?.input) ?? {}
}

function parseArgBag(value: unknown): Record<string, any> | null {
  if (typeof value === 'string' && value.trim()) return tryParseJsonRecord(value)
  return asRecord(value)
}

function truncateToolResult(text: string): string {
  const MAX = 16 * 1024
  if (text.length <= MAX) return text
  return text.slice(0, MAX) + '\n…(truncated)'
}

function assistantMessageUsage(rec: Record<string, any>): Record<string, any> | null {
  const message = asRecord(rec.message)
  if (stringField(message, 'role') !== 'assistant') return null
  return asRecord(message?.usage)
}

export type PiModelInfo = {
  id: string
  name: string
  provider: string
  modelId: string
  contextWindow?: number
  reasoning: boolean
}

export function modelsFromRpcData(data: unknown): PiModelInfo[] {
  const rec = asRecord(data)
  const list = Array.isArray(rec?.models) ? rec.models : Array.isArray(data) ? data : []
  const models: PiModelInfo[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const model = asRecord(item)
    if (!model) continue
    const modelId = stringField(model, 'id')
    const provider = stringField(model, 'provider')
    if (!modelId || !provider) continue
    const nativeId = `${provider}/${modelId}`
    if (seen.has(nativeId)) continue
    seen.add(nativeId)
    const contextWindow = numberField(model, 'contextWindow')
    models.push({
      id: nativeId,
      name: stringField(model, 'name') || modelId,
      provider,
      modelId,
      reasoning: model.reasoning === true,
      ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
    })
  }
  return models.sort((left, right) => left.name.localeCompare(right.name))
}

export function commandsFromRpcData(data: unknown): Array<{ name: string; description: string }> {
  const rec = asRecord(data)
  const list = Array.isArray(rec?.commands) ? rec.commands : []
  const commands: Array<{ name: string; description: string }> = []
  for (const item of list) {
    const command = asRecord(item)
    const name = stringField(command, 'name')
    if (!name) continue
    commands.push({ name, description: stringField(command, 'description') ?? name })
  }
  return commands
}
