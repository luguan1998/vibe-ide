const COMPUTER_USE_RE = /^mcp__vibe-cu__/
const BROWSER_USE_RE = /^mcp__vibe-browser__/

export function guiToolKind(name: string): 'computerUse' | 'browserUse' | null {
  if (COMPUTER_USE_RE.test(name)) return 'computerUse'
  if (BROWSER_USE_RE.test(name)) return 'browserUse'
  return null
}
