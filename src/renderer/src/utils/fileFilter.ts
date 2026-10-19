const FILTER_RULES_KEY = 'vibe-ide-file-filter-rules'

export const DEFAULT_FILTER_RULES = ['.git', '.vscode', 'node_modules', 'dist', 'build', '.next', 'out', '__pycache__', 'target', '.cache']

export function loadFilterRules(): string[] {
  try {
    const raw = localStorage.getItem(FILTER_RULES_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.every((v: any) => typeof v === 'string')) return arr
    }
  } catch {}
  return [...DEFAULT_FILTER_RULES]
}

export function saveFilterRules(rules: string[]) {
  try { localStorage.setItem(FILTER_RULES_KEY, JSON.stringify(rules)) } catch {}
}
