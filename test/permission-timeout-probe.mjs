// Probe whether Claude CLI auto-fills an unanswered permission_request after a timeout.
// Simplified: no --include-partial-messages, no --append-system-prompt (less quoting headaches
// on Windows shell:true).

import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const t0 = Date.now()
const log = (...args) => console.log(`[+${String(Date.now() - t0).padStart(6)}ms]`, ...args)

const cwd = mkdtempSync(join(tmpdir(), 'perm-probe-'))
log('cwd:', cwd)

// IMPORTANT: in stream-json input mode, claude emits system/init only AFTER stdin
// receives at least one valid NDJSON line. So we send the prompt immediately on spawn.
const args = [
  '-p',
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--permission-prompt-tool', 'stdio',
  '--verbose',
  '--permission-mode', 'default',
]
log('args:', args.join(' '))

const child = spawn('cmd.exe', ['/c', 'claude', ...args], {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
})

let lineBuf = ''
let permReceivedAt = null
let filledAfterMs = null
let initSent = false

// Send an initial probe prompt IMMEDIATELY on spawn — claude won't emit system/init
// until stdin gets at least one valid NDJSON line.
sendUserMessage("Create a file named probe-test.txt in the current directory containing the text 'hello world'. Use the Write tool. Do not ask for clarification.")

child.stdout.on('data', d => {
  lineBuf += d.toString()
  let idx
  while ((idx = lineBuf.indexOf('\n')) >= 0) {
    const line = lineBuf.slice(0, idx).trim()
    lineBuf = lineBuf.slice(idx + 1)
    if (!line) continue
    try {
      onMessage(JSON.parse(line))
    } catch {
      log('PARSE-ERR:', line.slice(0, 200))
    }
  }
})

child.stderr.on('data', d => log('STDERR:', d.toString().trim()))
child.on('error', e => log('CHILD ERROR:', e.message))
child.on('exit', (code, sig) => {
  log(`EXIT code=${code} sig=${sig}`)
  if (permReceivedAt && !filledAfterMs) {
    log(`  → CLI exited without auto-filling — permission request blocked for ${Date.now() - permReceivedAt}ms`)
  }
  try { rmSync(cwd, { recursive: true, force: true }) } catch (e) { log('cleanup failed:', e.message) }
  process.exit(0)
})

function onMessage(msg) {
  if (msg.type === 'system') {
    log(`system subtype=${msg.subtype} session=${msg.session_id?.slice(0, 8)} model=${msg.model}`)
    if (msg.subtype === 'init' && !initSent) {
      initSent = true
      sendUserMessage("Create a file named probe-test.txt in the current directory containing the text 'hello world'. Use the Write tool. Do not ask for clarification.")
    }
    return
  }

  if (msg.type === 'assistant') {
    for (const c of msg.message?.content || []) {
      if (c.type === 'text') log(`assistant.text: ${c.text.slice(0, 80)}`)
      else if (c.type === 'tool_use') log(`assistant.tool_use: ${c.name} input=${JSON.stringify(c.input).slice(0, 80)}`)
    }
    return
  }

  if (msg.type === 'user') {
    for (const c of msg.message?.content || []) {
      if (c.type === 'tool_result') {
        const elapsed = permReceivedAt ? Date.now() - permReceivedAt : null
        log(`tool_result: isError=${c.is_error} content=${JSON.stringify(c.content).slice(0, 80)} (since perm req: ${elapsed}ms)`)
        if (permReceivedAt && !filledAfterMs) {
          filledAfterMs = elapsed
          log(`  ⚠️  AUTO-FILL DETECTED: CLI produced tool_result ${elapsed}ms after permission request`)
        }
      }
    }
    return
  }

  if (msg.type === 'result') {
    log(`result subtype=${msg.subtype} duration=${msg.duration_ms}ms cost=$${msg.total_cost_usd}`)
    return
  }

  if (msg.type === 'control_request') {
    permReceivedAt = Date.now()
    const req = msg.request || {}
    log(`control_request id=${msg.request_id?.slice(0, 8)} subtype=${req.subtype} tool=${req.tool_name} toolUseId=${req.tool_use_id?.slice(0, 8)}`)
    log(`  ⏰ GOT permission request at +${permReceivedAt - t0}ms — INTENTIONALLY NOT RESPONDING`)
    return
  }

  log(`other type=${msg.type}`)
}

function sendUserMessage(text) {
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
  log(`→ sent: "${text.slice(0, 60)}"`)
}

setTimeout(() => {
  log('⏹ 45s probe window elapsed — killing subprocess')
  try { child.kill('SIGTERM') } catch {}
  setTimeout(() => process.exit(0), 500)
}, 45000)

log(`spawned claude, waiting for system/init...`)
