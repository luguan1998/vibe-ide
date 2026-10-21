import { ipcMain } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC_CHANNELS, type PiModelConfigPayload } from '../../shared/types'
import { resolvePiAgentDir } from './process'
import { invalidatePiModels } from './catalog'

// 读 JSON；文件不存在返回 null；存在但解析失败抛出（调用方据此拒绝覆盖，保护用户手写配置）
async function readJson(path: string): Promise<any> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return null
  }
  return JSON.parse(raw)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf-8')
}

// 令牌数输入：纯数字或带 k/m 后缀（128k / 1m）。空串或非法 → undefined（不写该字段，保留原值）
function parseTokens(raw?: string): number | undefined {
  const m = raw?.trim().match(/^(\d+(?:\.\d+)?)\s*(k|m)?$/i)
  if (!m) return undefined
  const unit = m[2]?.toLowerCase()
  const n = Math.round(parseFloat(m[1]) * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1))
  return n >= 1000 ? n : undefined
}

// 档位全开：xhigh/max 这两档 pi 只在 thinkingLevelMap 里显式给了才认，其余档缺省即支持；
// 值就是档位自身，各 api 实现会把 medium/high 等折算成上游参数（reasoning_effort、thinking 块等）。
// 只覆盖这两档，给手写留出空间——想砍掉某档就自己补个 null。
const PI_THINKING_LEVEL_MAP = { xhigh: 'xhigh', max: 'max' }

/**
 * 一键应用一组模型配置：
 * - models.json 的 providers.<providerId> = { baseUrl, api, apiKey, models }（同 id 的模型保留原有额外字段）
 * - settings.json 的 defaultProvider / defaultModel / defaultThinkingLevel 仅在填了值时才写
 */
export async function applyPiModelConfig(payload: PiModelConfigPayload): Promise<{ success: boolean; error?: string }> {
  const providerId = payload.providerId?.trim()
  if (!providerId) return { success: false, error: 'provider id required (提供商 ID 不能为空)' }
  const dir = resolvePiAgentDir()
  try {
    await mkdir(dir, { recursive: true })

    const modelsPath = join(dir, 'models.json')
    const root = (await readJson(modelsPath)) ?? {}
    const providers: Record<string, any> = root.providers && typeof root.providers === 'object' ? root.providers : {}
    const previous: Record<string, any> = providers[providerId] && typeof providers[providerId] === 'object' ? providers[providerId] : {}

    // 合并而非整条替换：空字段跳过，用户手写的 headers/compat/oauth 等原样保留
    const provider: Record<string, any> = { ...previous }
    for (const key of ['baseUrl', 'api', 'apiKey'] as const) {
      const value = payload[key]?.trim()
      if (value) provider[key] = value
    }
    const entries = (payload.models ?? []).filter((m) => m?.id?.trim())
    if (entries.length) {
      const existing: Record<string, any> = {}
      for (const item of Array.isArray(previous.models) ? previous.models : []) {
        if (item && typeof item === 'object' && typeof item.id === 'string') existing[item.id] = item
      }
      provider.models = entries.map((m) => {
        const id = m.id.trim()
        const contextWindow = parseTokens(m.contextWindow)
        const maxTokens = parseTokens(m.maxTokens)
        return {
          ...(existing[id] ?? {}),
          id,
          // 中转站的模型元数据不可靠，默认按推理模型标注：pi 未标 reasoning 只给 off 一档
          reasoning: true,
          thinkingLevelMap: PI_THINKING_LEVEL_MAP,
          ...(contextWindow ? { contextWindow } : {}),
          ...(maxTokens ? { maxTokens } : {}),
        }
      })
    }
    providers[providerId] = provider
    root.providers = providers
    await writeJson(modelsPath, root)

    const defaultModel = payload.defaultModel?.trim()
    const thinkingLevel = payload.thinkingLevel?.trim()
    if (defaultModel || thinkingLevel) {
      const settingsPath = join(dir, 'settings.json')
      const settings = (await readJson(settingsPath)) ?? {}
      if (defaultModel) {
        settings.defaultProvider = providerId
        settings.defaultModel = defaultModel
      }
      if (thinkingLevel) settings.defaultThinkingLevel = thinkingLevel
      await writeJson(settingsPath, settings)
    }

    invalidatePiModels()
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) }
  }
}

export function registerPiConfigHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PI_APPLY_MODEL_CONFIG, (_event, payload: PiModelConfigPayload) => applyPiModelConfig(payload))
}
