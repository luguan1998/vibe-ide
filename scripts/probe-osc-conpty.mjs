// Probe what ConPTY actually forwards to the client for OSC title sequences.
// Usage: node scripts/probe-osc-conpty.mjs [withProfile]
import pty from 'node-pty'

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const useProfile = process.argv[2] === 'withProfile'
const args = useProfile ? ['-NoLogo'] : ['-NoLogo', '-NoProfile']

const OSC_RE = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g
const vis = (s) => s.replace(/\x1b/g, '<ESC>').replace(/\x07/g, '<BEL>').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
const codepoints = (s) => [...s].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join(' ')

function scan(buf) {
  const out = []
  OSC_RE.lastIndex = 0
  let m
  while ((m = OSC_RE.exec(buf)) !== null) out.push(m[0])
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const p = pty.spawn(PS, args, {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: 'E:\\ai\\claudeui',
  env: { ...process.env, WT_SESSION: 'vibe-ide', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
})

let buf = ''
p.onData((d) => { buf += d })

await sleep(2500)
const startupLen = buf.length
const startupOsc = scan(buf)

console.log(`mode = ${useProfile ? 'with profile' : 'no profile'}`)
console.log(`=== startup phase (${startupLen} bytes) ===`)
console.log(startupOsc.length ? startupOsc.map(vis).join('\n') : '(no OSC sequences)')

const EU = '$o=[Console]::OpenStandardOutput();$b=[Text.Encoding]::UTF8.GetBytes'
const cases = [
  ['setup utf8', `[Console]::OutputEncoding=[Text.Encoding]::UTF8`],
  ['OSC 2 plain',      `${EU}([char]27+']2;PlainTitle'+[char]7);$o.Write($b,0,$b.Length);$o.Flush()`],
  ['OSC 1 PUA icon',   `${EU}([char]27+']1;'+[char]0xE0FF+[char]7);$o.Write($b,0,$b.Length);$o.Flush()`],
  ['OSC 0 brand+VS16', `${EU}([char]27+']0;'+[char]0x2733+[char]0xFE0F+' Hello'+[char]7);$o.Write($b,0,$b.Length);$o.Flush()`],
  ['OSC 0 chinese',    `${EU}([char]27+']0;中文标题'+[char]7);$o.Write($b,0,$b.Length);$o.Flush()`],
  ['SetConsoleTitle',  `[Console]::Title='API Title'`],
  ['OSC 0 with CSI',   `${EU}([char]27+']0;'+[char]27+'[31mRed'+[char]7);$o.Write($b,0,$b.Length);$o.Flush()`],
  ['OSC 0 empty',      `${EU}([char]27+']0;'+[char]7);$o.Write($b,0,$b.Length);$o.Flush()`],
  ['OSC 7 cwd',        `${EU}([char]27+']7;file://host/E:/tmp'+[char]7);$o.Write($b,0,$b.Length);$o.Flush()`]
]

for (const [label, cmd] of cases) {
  const before = buf.length
  p.write(cmd + '\r')
  await sleep(500)
  const chunk = buf.slice(before)
  const osc = scan(chunk)
  console.log(`\n--- ${label} ---`)
  if (!osc.length) { console.log('(nothing forwarded)') ; continue }
  for (const s of osc) {
    const payload = s.slice(2).replace(/\x07$/, '').replace(/\x1b\\$/, '')
    console.log(`  raw: ${vis(s)}`)
    console.log(`  payload cps: ${codepoints(payload)}`)
  }
}

p.kill()
await sleep(300)
process.exit(0)
