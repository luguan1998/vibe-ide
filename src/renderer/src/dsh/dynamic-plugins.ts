// 动态加载 dsh host 上的玩家插件（`dsh plugin add` 装的，在 host boot graph 里）。
// vibe build 期只装 vendor 官方插件（generated-client-plugins.ts）；玩家插件走 host
// graph，这里 fetch host index.html 的 __DSH_BOOT__（host 的唯一 graph 出口），
// filter 掉 @deepseek-ai/* shipped（官方走 vendor，vibe 替代项也不碰），
// 只动态加载纯玩家插件（非 @deepseek-ai/ 前缀的普通包名，如 dsh-theme-stardew）。
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as Cordis from '@deepseek-ai/cordis'
import * as UiSlots from '@deepseek-ai/dsh-client-ui-slots'
import * as WebReact from '@deepseek-ai/dsh-client-web-react'
import * as UiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as UiAttachment from '@deepseek-ai/dsh-client-ui-attachment'
import * as SchemaForm from '@deepseek-ai/dsh-client-schema-form'
import type { Context } from '@deepseek-ai/cordis'
import type { BootModuleRow, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'

// dsh client bundle（ModuleLoader closure）编译时的 platform externals，
// materialize 时 require 这些词命中这张表（原版 seed.ts 的 staticModules）。
const STATIC_MODULES: Record<string, unknown> = {
  'react': React,
  'react/jsx-runtime': ReactJsxRuntime,
  'react-dom': ReactDom,
  'react-dom/client': ReactDomClient,
  '@deepseek-ai/cordis': Cordis,
  '@deepseek-ai/dsh-client-ui-slots': UiSlots,
  '@deepseek-ai/dsh-client-web-react': WebReact,
  '@deepseek-ai/dsh-client-ui-primitives': UiPrimitives,
  '@deepseek-ai/dsh-client-ui-attachment': UiAttachment,
  '@deepseek-ai/dsh-client-schema-form': SchemaForm,
}

/** Fetch host index.html 解析注入的 window.__DSH_BOOT__（graph 唯一出口，无独立 JSON endpoint）。 */
export async function fetchBootGraph(baseUrl: string): Promise<WebBootGraph | null> {
  try {
    const html = await fetch(`${baseUrl}/`).then((r) => r.text())
    const match = html.match(/window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)
    if (match?.[1] === undefined) {
      console.warn('[dsh-dynamic] __DSH_BOOT__ missing in host index')
      return null
    }
    return JSON.parse(match[1]) as WebBootGraph
  } catch (error) {
    console.warn('[dsh-dynamic] fetch boot graph failed:', error)
    return null
  }
}

/** filter：@deepseek-ai/* shipped 全排除（官方走 vendor/generated，vibe 替代项不碰），
 * 只留纯玩家插件（dsh plugin add 装的普通包名）。 */
export function playerRowsOf(graph: WebBootGraph | null): BootModuleRow[] {
  if (graph?.entries === undefined) return []
  const rows: BootModuleRow[] = []
  for (const entry of graph.entries) {
    if (entry.id.startsWith('@deepseek-ai/')) continue
    rows.push({ id: entry.id, url: entry.url, rev: entry.rev })
  }
  return rows
}

/** 动态激活：ClientModuleSystem（index rows + window.__ModuleLoader__ sink）→
 * 逐个 modules.import（fetch host bundle + materialize）拿 exports（{ apply, inject }）→
 * ctx.plugin 激活。不走 vendored Loader——它是 node 侧（import node:module），
 * 浏览器拉不到；modules.import 的 exports 直接喂 ctx.plugin 即可。失败单插件隔离。 */
export async function activatePlayerRows(ctx: Context, rows: BootModuleRow[]): Promise<void> {
  if (rows.length === 0) return
  try {
    const { ClientModuleSystem } = await import('@deepseek-ai/dsh-client-modules/client')
    const modules = new ClientModuleSystem({ modules: rows, staticModules: STATIC_MODULES })
    const activated: string[] = []
    for (const row of rows) {
      try {
        const mod = await modules.import(row.id) as { apply?: (c: unknown) => void; inject?: string[] }
        if (typeof mod?.apply !== 'function') {
          console.warn(`[dsh-dynamic] ${row.id}: exports has no apply, skip`)
          continue
        }
        await ctx.plugin({ apply: mod.apply as never, inject: mod.inject })
        activated.push(row.id)
      } catch (error) {
        console.warn(`[dsh-dynamic] activate ${row.id} failed:`, error)
      }
    }
    if (activated.length > 0) {
      console.log(`[dsh-dynamic] activated ${activated.length} player plugins: ${activated.join(', ')}`)
    }
  } catch (error) {
    console.warn('[dsh-dynamic] player plugin bootstrap failed:', error)
  }
}