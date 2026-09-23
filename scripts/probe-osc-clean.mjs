// Extract the real prefix-strip regex from App.tsx and run it over real OSC payloads.
// Usage: node scripts/probe-osc-clean.mjs
import fs from 'fs'

const p = 'E:/ai/claudeui/src/renderer/src/App.tsx'
const src = fs.readFileSync(p, 'utf8')
const key = 'title.replace('
const at = src.indexOf(key)
if (at < 0) { console.log('handleOscTitleChange not found'); process.exit(1) }
const rest = src.slice(at + key.length)
const reText = rest.slice(0, rest.indexOf('/', 1) + 1)
const re = eval(reText)

const clean = (t) => t.replace(re, '').trim()
const cps = (s) => [...s].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join(' ')

console.log('regex:', reText, '\n')
const cases = [
  ['brand glyph', '✳ Claude Code'],
  ['brand + VS16', '✳️ Hello'],
  ['PUA icon', ''],
  ['braille', '⠋ Working'],
  ['plain', 'PlainTitle'],
  ['chinese', '中文标题'],
  ['empty', ''],
  ['path', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
  ['zwsp title', '​Zero']
]
for (const [label, payload] of cases) {
  const out = clean(payload)
  console.log(`${label.padEnd(14)} in =[${cps(payload)}]`)
  console.log(`${''.padEnd(14)} out=${JSON.stringify(out)} cps=[${cps(out)}]${out ? '' : '  -> return, 原名保持'}`)
}
