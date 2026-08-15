import { Context } from '@deepseek-ai/cordis'
// Declaration-merge pull: the dsh Context surface (slots/sessions/workspaces/
// remote/settingsScope/locale/theme/layout/typert) extends via declare module.
import type {} from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry/src/client/index.ts'
import type {} from '@deepseek-ai/dsh-api-gateway/src/client/index.ts'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyTypert, inject as injectTypert } from '@deepseek-ai/dsh-typert-registry/src/client/index.ts'
import { apply as applyConnection, inject as injectConnection } from '@deepseek-ai/dsh-client-connection/src/client/index.ts'
import { apply as applyGateway, inject as injectGateway } from '@deepseek-ai/dsh-api-gateway/src/client/index.ts'
import { apply as applyRemotes, inject as injectRemotes } from '@deepseek-ai/dsh-api-remotes/src/client/index.ts'
import { apply as applyRuntime, inject as injectRuntime } from '@deepseek-ai/dsh-client-runtime/src/client/index.ts'
import { apply as applySettings, inject as injectSettings } from '@deepseek-ai/dsh-client-ui-settings/src/client/index.ts'
import { apply as applyLocale, inject as injectLocale } from '@deepseek-ai/dsh-client-locale/src/client/index.ts'
import { apply as applyTheme, inject as injectTheme } from '@deepseek-ai/dsh-client-ui-theme/src/client/index.ts'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/src/client/apply.ts'
import { apply as applyTool, inject as injectTool } from '@deepseek-ai/dsh-client-ui-tool/src/client/apply.ts'
import { apply as applySettingsGeneral, inject as injectSettingsGeneral } from '@deepseek-ai/dsh-client-ui-settings-general/src/client/index.ts'
import { apply as applySettingsModels, inject as injectSettingsModels } from '@deepseek-ai/dsh-client-ui-settings-models/src/client/index.ts'
import { apply as applySettingsPlugins, inject as injectSettingsPlugins } from '@deepseek-ai/dsh-client-ui-settings-plugins/src/client/index.ts'
import { apply as applyPluginInventory, inject as injectPluginInventory } from '@deepseek-ai/dsh-client-ui-settings-plugin-inventory/src/client/index.ts'
import { apply as applyAgentPreset, inject as injectAgentPreset } from '@deepseek-ai/dsh-client-ui-agent-preset/src/client/index.ts'
import { apply as applyTrajectory, inject as injectTrajectory } from '@deepseek-ai/dsh-client-ui-trajectory/src/client/index.ts'
import { apply as applyModelSelection, inject as injectModelSelection } from '@deepseek-ai/dsh-client-ui-model-selection/src/client/index.ts'
import { apply as applyCommands, inject as injectCommands } from '@deepseek-ai/dsh-client-ui-commands/src/client/index.ts'
import { apply as applyInputTrigger, inject as injectInputTrigger } from '@deepseek-ai/dsh-client-ui-input-trigger/src/client/index.ts'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react/src/index.ts'
import { DshRoot } from './DshRoot'
import { applyDshTheme } from './theme-bridge'

import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/scrollbar.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/shiki.css'

export interface DshContextHandle {
  ctx: Context
  dispose: () => Promise<void>
}

async function buildDshContext(baseUrl: string): Promise<DshContextHandle> {
  ;(globalThis as { __DSH_BASE__?: string }).__DSH_BASE__ = baseUrl

  const ctx = new Context()
  // Layout stub registered before plugins: ui-conversation injects 'layout'
  // (only needs openDetails/closeDetails); ui-layout's AppFrame is not wanted
  // because Vibe owns the window frame.
  ctx.provide('layout', {
    toggleSidebar() {},
    openDetails() {},
    closeDetails() {},
  })
  // The root registration must commit BEFORE ui-conversation's apply: its
  // register('conversation'/'details') throws when the slots are undeclared,
  // and the failure lands after buildDshContext resolves (await() returns
  // immediately for PENDING fibers). A slots-only plugin activates ahead of
  // ui-conversation, which also waits on nine more services.
  const fibers = [
    ctx.plugin({
      name: 'dsh-root-register',
      inject: ['slots'],
      apply: (c) => {
        c.slots.register({
          name: 'root',
          children: {
            conversation: { kind: 'single', scope: 'session-maybe' },
            details: { kind: 'single', scope: 'session' },
            'sidebar.settings': { kind: 'single', scope: 'root' },
          },
        }, DshRoot as never)
      },
    }),
    ctx.plugin({ apply: applyTypert, inject: injectTypert }),
    ctx.plugin({ apply: applyConnection, inject: injectConnection }),
    ctx.plugin({ apply: applyGateway, inject: injectGateway }),
    ctx.plugin({ apply: applyRemotes, inject: injectRemotes }),
    ctx.plugin({ apply: applyRuntime, inject: injectRuntime }),
    ctx.plugin({ apply: applySettings, inject: injectSettings }),
    ctx.plugin({ apply: applyLocale, inject: injectLocale }),
    ctx.plugin({ apply: applyTheme, inject: injectTheme }),
    ctx.plugin({ apply: applyConversation, inject: injectConversation }),
    ctx.plugin({ apply: applyTool, inject: injectTool }),
    ctx.plugin({ apply: applySettingsGeneral, inject: injectSettingsGeneral }),
    ctx.plugin({ apply: applySettingsModels, inject: injectSettingsModels }),
    ctx.plugin({ apply: applySettingsPlugins, inject: injectSettingsPlugins }),
    ctx.plugin({ apply: applyPluginInventory, inject: injectPluginInventory }),
    // Preset convergence: the deployment default governs blank sessions, but
    // the host only applies it at session creation — an in-place default
    // change leaves the already-current blank session (and the hero chip
    // reading it) stale until restart. Sync explicitly.
    ctx.plugin({
      name: 'vibe-preset-sync',
      inject: ['sessions', 'connection', 'remote'],
      apply: (c) => {
        const sessions = c.get('sessions') as any
        const api = (c.get('connection') as any).api
        let inflight: Promise<void> | null = null
        const sync = (): Promise<void> => {
          inflight ??= (async () => {
            try {
              const snap = sessions.list.getSnapshot()
              const id = snap.current
              const summary = id === undefined ? undefined : snap.byId[id]
              if (summary === undefined || summary.blank !== true) return
              const res = await api.agentPresets.list({})
              if (!res.result.ok) return
              const presets = res.result.value.presets
              const def = presets.find((p: any) => p.isDefault)?.id ?? presets[0]?.id
              if (def === undefined || summary.agentPreset === def) return
              const sel = await api.agentPresets.select({ sessionId: id, agentPreset: def })
              if (sel.result.ok) sessions.noteAgentPreset(id, sel.result.value.agentPreset)
            } catch {
              // best-effort: the session composition follows on the next boot anyway
            } finally {
              inflight = null
            }
          })()
          return inflight
        }
        const offList = sessions.list.subscribe(() => { void sync() })
        const offSettings = (c.get('remote') as any).$on('settings/document-updated', (ns: string) => {
          if (ns === 'agent-presets') void sync()
        })
        c.effect(() => () => { offList(); offSettings() })
      },
    }),
    ctx.plugin({ apply: applyAgentPreset, inject: injectAgentPreset }),
    ctx.plugin({ apply: applyTrajectory, inject: injectTrajectory }),
    ctx.plugin({ apply: applyInputTrigger, inject: injectInputTrigger }),
    ctx.plugin({ apply: applyCommands, inject: injectCommands }),
    ctx.plugin({ apply: applyModelSelection, inject: injectModelSelection }),
  ]
  await Promise.all(fibers.map((f) => f.await()))
  ;(globalThis as { __dshCtx?: unknown }).__dshCtx = ctx
  const probe = ['slots', 'sessions', 'workspaces', 'connection', 'typert', 'remote', 'remote.commands', 'settingsScope', 'locale', 'theme', 'layout', 'conversationEvents', 'conversationViews']
  let missing = probe.filter((k) => ctx.get(k as never) === undefined)
  for (let i = 0; i < 10 && missing.length > 0; i++) {
    await new Promise((r) => setTimeout(r, 250))
    missing = probe.filter((k) => ctx.get(k as never) === undefined)
  }
  if (missing.length > 0) {
    const states = fibers.map((f) => String((f as any).state ?? '?')).join(',')
    throw new Error(`dsh ctx missing: ${missing.join(', ')} (fiber states: ${states})`)
  }
  // Second await: fibers that were PENDING during the first pass have since
  // activated (or failed) — this surfaces apply failures loudly instead of
  // leaving a silently empty conversation seat.
  await Promise.all(fibers.map((f) => f.await()))
  let convEntries = ctx.slots.entries('conversation').length
  for (let i = 0; i < 10 && convEntries === 0; i++) {
    await new Promise((r) => setTimeout(r, 250))
    convEntries = ctx.slots.entries('conversation').length
  }
  if (convEntries === 0) {
    throw new Error('dsh assembly: conversation slot has no entries (ui-conversation apply failed?)')
  }
  // Fork 分叉到 Vibe session：ui-conversation 的 forkAt 调 sessions.fork 只在
  // dsh 自己的列表里开子会话（Vibe 的 SessionPanel 看不到，状态错位）。包装
  // fork：子会话生成后广播 vibe:dsh-fork，App.tsx 据此建同 id Vibe session
  // （DshView 的 sessions.create 收养已分叉历史）。监听器缺席时退化为原版行为。
  const sessionsSvc = ctx.get('sessions') as unknown as {
    fork: (opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }) => Promise<string>
    list: { getSnapshot: () => { byId: Record<string, { cwd?: string; title?: string }> } }
  }
  const origFork = sessionsSvc.fork.bind(sessionsSvc)
  sessionsSvc.fork = async (opts) => {
    const childId = await origFork(opts)
    try {
      const snap = sessionsSvc.list.getSnapshot()
      const source = snap.byId[opts.sessionId]
      const child = snap.byId[childId]
      window.dispatchEvent(new CustomEvent('vibe:dsh-fork', {
        detail: {
          sourceId: opts.sessionId,
          childId,
          cwd: source?.cwd ?? child?.cwd,
          title: child?.title,
        },
      }))
    } catch {
      // fork 已成功，Vibe 侧广播失败不阻断
    }
    return childId
  }
  ctx.slots.install(createSlotRenderer())

  return {
    ctx,
    dispose: async () => {
      await Promise.all(fibers.map((f) => f.dispose()))
    },
  }
}

// One shared assembly per app (the original webui model): every DshView binds
// into this context and switches the current session with sessions.open(),
// instead of each view assembling its own plugin stack + connection + list
// mirrors. Rejected builds reset so a later mount can retry.
let sharedPromise: Promise<DshContextHandle> | null = null

export function getSharedDshContext(baseUrl: string): Promise<DshContextHandle> {
  if (sharedPromise === null) {
    sharedPromise = buildDshContext(baseUrl)
      .then((h) => {
        applyDshTheme(h.ctx)
        return h
      })
      .catch((e) => {
        sharedPromise = null
        throw e
      })
  }
  return sharedPromise
}
