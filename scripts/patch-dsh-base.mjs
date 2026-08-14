// Idempotent patch of dsh client-connection sources inside node_modules:
// resolveBase() must prefer window.__DSH_BASE__ (Vibe renderer runs on
// file:// in prod and http://localhost in dev, neither is the dsh server).
// dsh sources import these files via relative paths, which Vite alias cannot
// intercept, so the patch is applied to the installed files directly.
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-client-connection', 'src', 'client')

const RPC_INJECT = `function resolveBase(): string {
  const injected = (globalThis as { __DSH_BASE__?: string }).__DSH_BASE__
  if (typeof injected === 'string' && injected !== '') return injected
  const location = (globalThis as { location?: { origin?: string } }).location
  return location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE
}`

const WS_INJECT = `export class WebApiClient extends AbstractApiClient {
  protected override resolveBase(): string {
    const injected = (globalThis as { __DSH_BASE__?: string }).__DSH_BASE__
    if (typeof injected === 'string' && injected !== '') return injected
    return super.resolveBase()
  }
`

function apply(path, marker, search, replacement) {
  const file = join(ROOT, path)
  const src = readFileSync(file, 'utf-8')
  if (src.includes(marker)) return
  if (!src.includes(search)) throw new Error(`patch-dsh-base: marker not found in ${path}`)
  writeFileSync(file, src.replace(search, replacement))
  console.log(`[patch-dsh-base] patched ${path}`)
}

const RPC_OLD = `function resolveBase(): string {
  const location = (globalThis as { location?: { origin?: string } }).location
  return location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE
}`

apply(
  'rpc.ts',
  '__DSH_BASE__',
  RPC_OLD,
  RPC_INJECT,
)

apply(
  'web-api-client.ts',
  '__DSH_BASE__',
  'export class WebApiClient extends AbstractApiClient {',
  WS_INJECT,
)
