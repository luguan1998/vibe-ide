// Probe ExitPlanMode behavior in --permission-mode plan: does CLI block waiting for
// control_response, or auto-fill "approved" after ~0.5s like AskUserQuestion?
//
// Background: prior probe confirmed normal Write permission blocks 41s+ in default mode.
// This probe extends to ExitPlanMode specifically under plan mode.

import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const t0 = Date.now()
const log = (...args) => console.log(`[+${String(Date.now() - t0).padStart(6)}ms]`, ...args)

const cwd = mkdtempSync(join(tmpdir(), 'exitplan-probe-'))
log('cwd:', cwd)

const args = [
  '-p',
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--permission-prompt-tool', 'stdio',
  '--verbose',
  '--permission-mode', 'plan',
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

// In plan mode, claude only emits system/init after receiving stdin NDJSON.
sendUserMessage("Plan a 3-step approach to add a hello.txt file containing 'hi' to the current directory. Use ExitPlanMode to submit your plan when ready. Do not skip ExitPlanMode.")

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
    log(`  → CLI exited without auto-filling — ExitPlanMode blocked for ${Date.now() - permReceivedAt}ms`)
  }
  try { rmSync(cwd, { recursive: true, force: true }) } catch (e) { log('cleanup failed:', e.message) }
  process.exit(0)
})

function onMessage(msg) {
  if (msg.type === 'system') {
    log(`system subtype=${msg.subtype} session=${msg.session_id?.slice(0, 8)} model=${msg.model} permissionMode=${msg.permissionMode}`)
    if (msg.subtype === 'init' && !initSent) initSent = true
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
          log(`  ⚠️  AUTO-FILL DETECTED: CLI produced tool_result ${elapsed}ms after ExitPlanMode control_request`)
          log(`  ⚠️  → ExitPlanMode DOES auto-fill in plan mode (same as AskUserQuestion)`)
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
    log(`  ⏰ Watching for auto-fill (tool_result) vs indefinite block...`)
    return
  }

  log(`other type=${msg.type}`)
}

function sendUserMessage(text) {
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
  log(`→ sent: "${text.slice(0, 60)}"`)
}

setTimeout(() => {
  log('⏹ 60s probe window elapsed — killing subprocess')
  try { child.kill('SIGTERM') } catch {}
  setTimeout(() => process.exit(0), 500)
}, 60000)
