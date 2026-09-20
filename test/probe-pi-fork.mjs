// 探针：验证 pi --mode rpc 的 fork / clone / switch_session 行为
// 用法: node test/probe-pi-fork.mjs [sessionFile]
// 关注：新会话文件是否独立、能否被另一进程 --session 恢复、原文件是否被动过
import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const ROOT = join(homedir(), '.pi', 'agent', 'sessions')

async function pickSession() {
  if (process.argv[2]) return process.argv[2]
  const dirs = await readdir(ROOT).catch(() => [])
  let best = null
  for (const d of dirs) {
    const dir = join(ROOT, d)
    const files = await readdir(dir).catch(() => [])
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(dir, f)
      const content = await readFile(p, 'utf-8').catch(() => '')
      const userCount = content.split('\n').filter((l) => l.includes('"role":"user"')).length
      if (userCount >= 2 && (!best || userCount > best.userCount)) best = { path: p, userCount }
    }
  }
  return best?.path
}

function attach(child, seen) {
  let nextId = 1
  const pending = new Map()
  let buf = ''
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      seen.push(rec)
      if (rec.type === 'response' && rec.id && pending.has(rec.id)) {
        const { resolve } = pending.get(rec.id)
        pending.delete(rec.id)
        resolve(rec)
      }
    }
  })
  return (command, timeoutMs = 30000) => {
    const id = `probe_${nextId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${command.type} timeout`)) }, timeoutMs)
      pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r) } })
      child.stdin.write(JSON.stringify({ ...command, id }) + '\n')
    })
  }
}

function start(args, cwd) {
  const child = spawn('pi', args, { cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.on('data', (d) => {
    const s = d.toString().trim()
    if (s) console.log('[pi stderr]', s.slice(0, 300))
  })
  const seen = []
  return { child, call: attach(child, seen), seen }
}

const file = await pickSession()
if (!file) { console.error('no pi session file found'); process.exit(1) }
const lines = (await readFile(file, 'utf-8')).split('\n').filter(Boolean)
const header = JSON.parse(lines[0])
const cwd = header.cwd
const dir = dirname(file)
const origStat = await stat(file)
console.log('source:', file)
console.log('cwd:', cwd, '| id:', header.id, '| lines:', lines.length, '| size:', origStat.size)
const before = new Set(await readdir(dir))

const A = start(['--mode', 'rpc', '--session', header.id], cwd)
const stateFields = {}
try {
  const st = await A.call({ type: 'get_state' }, 45000)
  const d = st.data?.data ?? st.data
  for (const [k, v] of Object.entries(d ?? {})) stateFields[k] = typeof v === 'object' ? '[obj]' : v
  console.log('\n[get_state fields]', JSON.stringify(stateFields))
  console.log('[get_state sessionFile]', d?.sessionFile ?? d?.sessionPath ?? '(none)')

  const fk = await A.call({ type: 'get_fork_messages' })
  const msgs = fk.data?.messages ?? []
  console.log('\n[fork messages]', msgs.map((m) => `${m.entryId}:${m.text}`).join(' | '))

  // A. 非末轮：fork 到「下一个 user」= 保留目标轮完整
  if (msgs.length >= 2) {
    const r = await A.call({ type: 'fork', entryId: msgs[1].entryId }, 60000)
    console.log('\n[A] fork@next-user ->', JSON.stringify(r.data))
    const st2 = await A.call({ type: 'get_state' })
    console.log('[A] new sessionFile:', (st2.data?.data ?? st2.data)?.sessionFile)
  }

  // B. clone：从当前 leaf 复制
  const c = await A.call({ type: 'clone' }, 60000)
  console.log('\n[B] clone ->', JSON.stringify(c.data))
  const st3 = await A.call({ type: 'get_state' })
  const d3 = st3.data?.data ?? st3.data
  console.log('[B] new sessionFile:', d3?.sessionFile)
  const cloneFile = d3?.sessionFile

  // C. 切回原会话
  const sw = await A.call({ type: 'switch_session', sessionPath: file }, 30000)
  console.log('\n[C] switch back ->', sw.success, JSON.stringify(sw.data))

  const after = await readdir(dir)
  const added = after.filter((f) => !before.has(f))
  console.log('\n[files] +', added.length)
  for (const f of added) {
    const cl = (await readFile(join(dir, f), 'utf-8')).split('\n').filter(Boolean)
    const ids = new Set(cl.map((l) => { try { return JSON.parse(l).id } catch { return null } }).filter(Boolean))
    let dangling = 0
    const roles = []
    for (const l of cl.slice(1)) {
      try {
        const r = JSON.parse(l)
        if (r.parentId && !ids.has(r.parentId)) dangling++
        roles.push(r.type === 'message' ? r.message.role : r.type)
      } catch { /* ignore */ }
    }
    console.log(`  ${f}\n    lines=${cl.length} dangling=${dangling} roles=${roles.join(',')}`)
  }
  const origAfter = await stat(file)
  console.log('[source untouched]', origAfter.size === origStat.size && origAfter.mtimeMs === origStat.mtimeMs)

  // D. 用新 id 起第二个进程，验证能否 resume
  if (cloneFile) {
    const cloneHeader = JSON.parse((await readFile(cloneFile, 'utf-8')).split('\n')[0])
    const B = start(['--mode', 'rpc', '--session', cloneHeader.id], cwd)
    try {
      const m = await B.call({ type: 'get_messages' }, 30000)
      const list = m.data?.messages ?? m.data?.data?.messages ?? []
      console.log('\n[D] resume forked session -> messages =', list.length)
      console.log('    roles:', list.map((x) => x.role).join(','))
    } catch (e) {
      console.log('\n[D] resume failed:', e.message)
    } finally {
      B.child.kill()
    }
  }

  // E. revert 到第一轮的边界：fork 到首条 user 之前 → 空会话能否建立并恢复
  {
    const fk2 = await A.call({ type: 'get_fork_messages' })
    const first = (fk2.data?.messages ?? [])[0]
    if (first) {
      const r = await A.call({ type: 'fork', entryId: first.entryId }, 60000)
      const st = await A.call({ type: 'get_state' })
      const sf = (st.data?.data ?? st.data)?.sessionFile
      console.log('\n[E] fork@first-user ->', JSON.stringify(r.data), '| file:', sf?.split('\\').pop())
      if (sf) {
        const cl = (await readFile(sf, 'utf-8')).split('\n').filter(Boolean)
        console.log('[E] lines =', cl.length, '| roles =', cl.slice(1).map((l) => { try { const x = JSON.parse(l); return x.type === 'message' ? x.message.role : x.type } catch { return '?' } }).join(','))
        const E = start(['--mode', 'rpc', '--session', JSON.parse(cl[0]).id], cwd)
        try {
          const m = await E.call({ type: 'get_messages' }, 30000)
          console.log('[E] resume empty fork -> messages =', (m.data?.messages ?? []).length)
        } catch (e) {
          console.log('[E] resume failed:', e.message)
        } finally {
          E.child.kill()
        }
      }
      await A.call({ type: 'switch_session', sessionPath: file }, 30000)
    }
  }
} catch (e) {
  console.error('\nERROR:', e.message)
} finally {
  A.child.kill()
}
