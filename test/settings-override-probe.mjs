// Probe whether --settings '{"hooks":{}}' overrides the project-level .claude/settings.json
// PermissionRequest hook (which currently auto-approves everything in D:/test/vibe-ide).

import { spawn } from 'child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const t0 = Date.now()
const log = (...args) => console.log(`[+${String(Date.now() - t0).padStart(6)}ms]`, ...args)

// Use D:/test/vibe-ide as cwd so project-level .claude/settings.json hook is in effect.
// (This is what triggers the AI-tab auto-approve bug.)
const cwd = 'D:/test/vibe-ide'
log('cwd:', cwd)
log('settings.json exists?', existsSync(join(cwd, '.claude', 'settings.json')))
if (existsSync(join(cwd, '.claude', 'settings.json'))) {
  log('  content:', readFileSync(join(cwd, '.claude', 'settings.json'), 'utf-8').replace(/\s+/g, ' ').slice(0, 200))
}

const args = [
  '-p',
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--permission-prompt-tool', 'stdio',
  '--verbose',
  '--permission-mode', 'plan',
  // Inject disableAllHooks to neutralize project-level PermissionRequest hook.
  '--settings', '{"disableAllHooks":true}',
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

sendUserMessage("Use ExitPlanMode to submit a 1-line plan to create hello.txt with content 'hi'. Do not skip ExitPlanMode.")

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
    log(`  ✅ CLI blocked (no auto-fill) for ${Date.now() - permReceivedAt}ms — --settings override worked`)
  } else if (filledAfterMs) {
    log(`  ❌ CLI auto-filled after ${filledAfterMs}ms — --settings is merge, not replace`)
  }
  process.exit(0)
})

function onMessage(msg) {
  if (msg.type === 'system') {
    log(`system subtype=${msg.subtype} session=${msg.session_id?.slice(0, 8)} model=${msg.model} permissionMode=${msg.permissionMode}`)
    return
  }
  if (msg.type === 'assistant') {
    for (const c of msg.message?.content || []) {
      if (c.type === 'tool_use') log(`assistant.tool_use: ${c.name} input=${JSON.stringify(c.input).slice(0, 60)}`)
      else if (c.type === 'text') log(`assistant.text: ${c.text.slice(0, 60)}`)
    }
    return
  }
  if (msg.type === 'user') {
    for (const c of msg.message?.content || []) {
      if (c.type === 'tool_result') {
        const elapsed = permReceivedAt ? Date.now() - permReceivedAt : null
        log(`tool_result: isError=${c.is_error} content=${JSON.stringify(c.content).slice(0, 60)} (since perm req: ${elapsed}ms)`)
        if (permReceivedAt && !filledAfterMs) {
          filledAfterMs = elapsed
        }
      }
    }
    return
  }
  if (msg.type === 'result') {
    log(`result subtype=${msg.subtype} duration=${msg.duration_ms}ms`)
    return
  }
  if (msg.type === 'control_request') {
    permReceivedAt = Date.now()
    const req = msg.request || {}
    log(`control_request id=${msg.request_id?.slice(0, 8)} tool=${req.tool_name}`)
    log(`  ⏰ GOT permission request at +${permReceivedAt - t0}ms — NOT responding`)
    return
  }
  log(`other type=${msg.type}`)
}

function sendUserMessage(text) {
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
  log(`→ sent: "${text.slice(0, 60)}"`)
}

setTimeout(() => {
  log('⏹ 30s probe window elapsed — killing subprocess')
  try { child.kill('SIGTERM') } catch {}
  setTimeout(() => process.exit(0), 500)
}, 30000)
