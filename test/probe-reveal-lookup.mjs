/**
 * 探针：图上「双击跳到该轮」的定位是否成立（只读，用真实 testgit 会话）
 *
 * 复现 ConversationGraph 双击活跃节点 → handleGraphRevealTurn 的查找：
 * 拿 sessionGraph 的 fork{content,occurrence} 去 loadSessionMessages 的消息里按
 * isRealUserInput 口径数 occurrence，逐一报告能否定位。
 *
 * 用法：node test/probe-reveal-lookup.mjs
 */

import { spawn } from 'child_process'
import { join, resolve } from 'path'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'

const projectRoot = resolve(import.meta.dirname, '..')
const cdpPort = 9237
const userDataDir = join(tmpdir(), 'vibe-ide-probe-reveal')
mkdirSync(userDataDir, { recursive: true })

const WT_CWD = 'E:/ai/testgit/.claude/branch-worktrees/ba6e865e'
const SESSIONS = ['67429907-d0f6-495e-b130-4a5d0fea80fa', 'bb991d7b-57aa-4cf0-9967-8a309a66b6a2']

async function connectCDP(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await resp.json()
  const pageTarget = targets.find(t => t.type === 'page' && !t.url.includes('devtools'))
  if (!pageTarget) throw new Error('No renderer target')
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('WS timeout')), 5000) })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id) }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id
    pending.set(msgId, res)
    ws.send(JSON.stringify({ id: msgId, method, params }))
    setTimeout(() => { pending.delete(msgId); rej(new Error(`CDP ${method} timeout`)) }, 60000)
  })
  return { send, close: () => ws.close() }
}

async function evalIn(cdp, expression) {
  const resp = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (resp.result?.exceptionDetails) throw new Error(resp.result.exceptionDetails.text + ' ' + (resp.result.exceptionDetails.exception?.description || ''))
  return resp.result?.result?.value
}

const electronExe = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const env = { ...process.env, ELECTRON_IS_DEV: '0' }
delete env.ELECTRON_RENDERER_URL
const proc = spawn(electronExe, [`--remote-debugging-port=${cdpPort}`, '--no-sandbox', `--user-data-dir=${userDataDir}`, projectRoot, 'E:/ai/testgit'], { stdio: 'pipe', env })

let cdp = null
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 1000))
  try { cdp = await connectCDP(cdpPort); break } catch {}
}
if (!cdp) { console.error('启动超时'); proc.kill(); process.exit(1) }
await cdp.send('Runtime.enable')
for (let i = 0; i < 30; i++) { if (await evalIn(cdp, '!!window.api?.ai').catch(() => false)) break; await new Promise(r => setTimeout(r, 500)) }

// 复刻 messages.tsx 的 isRealUserInput + handleGraphRevealTurn 的查找
const LOOKUP = `(messages, want, occurrence) => {
  const isReal = (msgs, i) => {
    const m = msgs[i]
    if (!m || m.role !== 'user' || m.type !== 'user' || !m.content) return false
    if (m.isRealUserTurn === true) return true
    return !(i > 0 && msgs[i - 1].type === 'assistant')
  }
  let realIdx = 0, seen = 0
  for (let i = 0; i < messages.length; i++) {
    if (!isReal(messages, i)) continue
    if ((messages[i].content || '').trim() === want) {
      if (seen === occurrence) return { target: realIdx, idx: i }
      seen++
    }
    realIdx++
  }
  return { target: -1, idx: -1 }
}`

for (const sid of SESSIONS) {
  console.log(`\n===== ${sid.slice(0, 8)} 图节点 vs 已加载消息 =====`)
  const g = await evalIn(cdp, `window.api.ai.sessionGraph('${sid}', '${WT_CWD}')`)
  if (!g) { console.log('  sessionGraph 返回 null'); continue }
  const loaded = await evalIn(cdp, `window.api.ai.loadSessionMessages('${sid}', '${WT_CWD}', undefined)`)
  const messages = loaded?.messages || []
  console.log(`  图节点 ${g.nodes.length} 个；loadSessionMessages ${messages.length} 条，actualCwd=${loaded?.actualCwd}`)
  const realUsers = []
  const isRealSrc = `(msgs, i) => { const m = msgs[i]; if (!m || m.role !== 'user' || m.type !== 'user' || !m.content) return false; if (m.isRealUserTurn === true) return true; return !(i > 0 && msgs[i-1].type === 'assistant') }`
  const users = await evalIn(cdp, `(() => { const msgs = ${JSON.stringify(messages)}; const isReal = ${isRealSrc}; const out = []; for (let i = 0; i < msgs.length; i++) { if (msgs[i].type !== 'user') continue; out.push({ i, isReal: isReal(msgs, i), real: msgs[i].isRealUserTurn, content: String(msgs[i].content || '').slice(0, 30), prevType: i > 0 ? msgs[i-1].type : null }) } return out })()`)
  for (const u of users || []) console.log(`   msg[${u.i}] ${u.isReal ? 'REAL ' : '     '} (mark=${u.real}, prev=${u.prevType}) "${u.content}"`)
  for (const n of g.nodes) {
    if (!n.fork) { console.log(`  node ${n.id.slice(0, 10)} [${n.worktreeStart ? 'WT-START' : 'turn'}] active=${n.active} tips=${n.tipBranchIds.map(x => x.slice(0, 8)).join(',') || '-'}`); continue }
    const r = await evalIn(cdp, `(() => { const lookup = ${LOOKUP}; return lookup(${JSON.stringify(messages)}, ${JSON.stringify(n.fork.content.trim())}, ${n.fork.occurrence}) })()`)
    const mark = r.target >= 0 ? 'OK ' : 'MISS'
    console.log(`  ${mark} node ${n.id.slice(0, 10)} active=${n.active} tips=${n.tipBranchIds.map(x => x.slice(0, 8)).join(',') || '-'} fork.content="${n.fork.content.slice(0, 24)}" occ=${n.fork.occurrence} -> ${r.target >= 0 ? 'msg[' + r.idx + ']' : '找不到'}`)
  }
}

cdp.close()
proc.kill()
console.log('\n完成')
process.exit(0)
