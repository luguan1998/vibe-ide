// Aggregate CPU samples from a DevTools Performance trace export (TraceEvents json).
// Usage: node scripts/analyze-trace.mjs <trace.json> [topN]
import { readFileSync } from 'fs'

const file = process.argv[2]
const topN = Number(process.argv[3] || 30)
if (!file) { console.error('Usage: node scripts/analyze-trace.mjs <trace.json> [topN]'); process.exit(1) }

console.error('loading...')
const trace = JSON.parse(readFileSync(file, 'utf8'))
const events = trace.traceEvents || []
console.error(`events: ${events.length}`)

const nodes = new Map()   // nodeId -> { pid, tid, fn, url, line, col }
const samplesByThread = new Map() // pid|tid -> { samples: [], deltas: [] }

for (const ev of events) {
  if (ev.ph !== 'P' || !ev.args?.data?.cpuProfile) continue
  const prof = ev.args.data.cpuProfile
  const key = `${ev.pid}|${ev.tid}`
  for (const n of prof.nodes || []) {
    const cf = n.callFrame || {}
    nodes.set(n.id, { pid: ev.pid, tid: ev.tid, fn: cf.functionName || '(anon)', url: cf.url || '', line: cf.lineNumber })
  }
  if (prof.samples) {
    if (!samplesByThread.has(key)) samplesByThread.set(key, { samples: [], deltas: [] })
    const t = samplesByThread.get(key)
    t.samples.push(...prof.samples)
    const d = ev.args.data.timeDeltas || prof.timeDeltas
    if (d) t.deltas.push(...d)
  }
}

console.error(`threads with samples: ${samplesByThread.size}`)

const short = u => (u || '').replace(/^file:\/\/\//, '').replace(/^.*app\.asar\//, 'asar/').replace(/^.*[\\/]/, '…/').slice(0, 70)

const pidTotals = new Map()
const perThread = []
for (const [key, t] of samplesByThread) {
  const [pid, tid] = key.split('|').map(Number)
  const self = new Map()
  let total = 0
  for (let i = 0; i < t.samples.length; i++) {
    const dt = t.deltas[i] || 0
    total += dt
    const n = nodes.get(t.samples[i])
    if (!n) continue
    const k = `${n.fn} @ ${short(n.url)}:${n.line + 1}`
    self.set(k, (self.get(k) || 0) + dt)
  }
  pidTotals.set(pid, (pidTotals.get(pid) || 0) + total)
  perThread.push({ key, pid, tid, total, self })
}

console.log('\n=== sampled CPU time per process (ms) ===')
;[...pidTotals.entries()].sort((a, b) => b[1] - a[1]).forEach(([pid, us]) => {
  console.log(`  pid=${pid}  ${(us / 1000).toFixed(0)}ms`)
})

perThread.sort((a, b) => b.total - a.total)
for (const th of perThread.slice(0, 4)) {
  console.log(`\n=== pid=${th.pid} tid=${th.tid}  total=${(th.total / 1000).toFixed(0)}ms  top ${topN} self ===`)
  ;[...th.self.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).forEach(([k, us]) => {
    console.log(`  ${(us / 1000).toFixed(1).padStart(8)}ms  ${(us / th.total * 100).toFixed(1).padStart(5)}%  ${k}`)
  })
}

// ── phase 2: complete events ('X') by name on the busiest renderer pid ──
const focusPid = [...pidTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
const byName = new Map()
let tMin = Infinity, tMax = 0
for (const ev of events) {
  if (ev.pid !== focusPid) continue
  if (ev.ts) { if (ev.ts < tMin) tMin = ev.ts; if (ev.ts > tMax) tMax = ev.ts }
  if (ev.ph !== 'X' || !ev.dur) continue
  const cur = byName.get(ev.name) || { total: 0, count: 0 }
  cur.total += ev.dur
  cur.count++
  byName.set(ev.name, cur)
}
const wallUs = (tMax - tMin) || 1
console.log(`\n=== pid=${focusPid} complete events by name (wall ${(wallUs / 1000).toFixed(0)}ms) ===`)
;[...byName.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 30).forEach(([k, v]) => {
  console.log(`  ${(v.total / 1000).toFixed(0).padStart(8)}ms  ${String(v.count).padStart(7)}x  ${(v.total / wallUs * 100).toFixed(0).padStart(4)}% wall  ${k}`)
})
