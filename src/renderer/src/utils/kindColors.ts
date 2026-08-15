// Kind → theme CSS variable mapping (values are "R G B" triplets via var(--ide-xxx))
const KIND_VARS: Record<string, string> = {
  function: 'var(--ide-accent)', method: 'var(--ide-accent)',
  class: 'var(--ide-accent)', interface: 'var(--ide-success)',
  variable: 'var(--ide-warning)', constant: 'var(--ide-warning)',
  type_alias: 'var(--ide-success)', component: 'var(--ide-accent)',
  enum: 'var(--ide-text-muted)', module: 'var(--ide-text-muted)',
  property: 'var(--ide-text-muted)',
}
const FALLBACK_VAR = 'var(--ide-text-muted)'

function getKindVar(kind: string): string { return KIND_VARS[kind] || FALLBACK_VAR }

// For inline styles: color = rgb(var) text, backgroundColor = rgb(var / 0.12) bg
export function getKindStyle(kind: string): { color: string; backgroundColor: string } {
  const v = getKindVar(kind)
  return {
    color: `rgb(${v})`,
    backgroundColor: `rgb(${v} / 0.12)`,
  }
}

// Legacy hex fallback for SVG/Canvas (CallGraphOverlay uses this)
const KIND_COLORS_HEX: Record<string, string> = {
  function: '#facc15', method: '#facc15',
  class: '#60a5fa', interface: '#4ade80',
  variable: '#c084fc', constant: '#fb923c',
  type: '#2dd4bf', component: '#f472b6',
}
export function getKindColorHex(kind: string): string { return KIND_COLORS_HEX[kind] || '#888' }