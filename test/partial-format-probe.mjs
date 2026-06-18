// Probe partial-message format from claude CLI with --include-partial-messages.
// We want to know: how does CLI mark partial vs final assistant messages? Is there
// msg.message.id that's stable across partial and final? Any is_partial flag?

import { spawn } from 'child_process'

const t0 = Date.now()
const log = (...args) => console.log(`[+${String(Date.now() - t0).padStart(6)}ms]`, ...args)

const cwd = 'D:/test/vibe-ide'

const args = [
  '-p',
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--permission-prompt-tool', 'stdio',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode', 'plan',
]

const child = spawn('cmd.exe', ['/c', 'claude', ...args], {
  cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
})

sendUserMessage("Reply with the single word OK. Do not call any tools.")

child.stdout.on('data', d => process.stdout.write('[raw] ' + d.toString()))
child.stderr.on('data', d => log('STDERR:', d.toString().trim()))
child.on('exit', c => process.exit(c ?? 0))

function sendUserMessage(text) {
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
}

setTimeout(() => { try { child.kill('SIGTERM') } catch {}; process.exit(0) }, 20000)
