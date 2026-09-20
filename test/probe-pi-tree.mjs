// 探针：pi get_tree / get_entries 的返回结构（评估网状对话可行性）
import { spawn } from 'node:child_process'
const [sid, cwd] = process.argv.slice(2)
const child = spawn('pi', ['--mode', 'rpc', '--session', sid], { cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
let buf = ''
const pending = new Map()
let n = 1
const call = (cmd) => new Promise((res) => { const id = 'x' + n++; pending.set(id, res); child.stdin.write(JSON.stringify({ ...cmd, id }) + '\n') })
child.stdout.on('data', (c) => {
  buf += c.toString()
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
    if (!line) continue
    let r; try { r = JSON.parse(line) } catch { continue }
    if (r.type === 'response' && r.id && pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id) }
  }
})
;(async () => {
  const tree = await call({ type: 'get_tree' })
  const d = tree.data ?? {}
  console.log('[get_tree] keys:', Object.keys(d))
  console.log(' leafId:', d.leafId)
  const t = d.tree
  if (Array.isArray(t)) {
    console.log(' tree is array, len =', t.length)
    console.log(' first node keys:', Object.keys(t[0] || {}))
    console.log(' sample:', JSON.stringify(t[0]).slice(0, 400))
    const kids = t.filter((x) => x.children?.length)
    console.log(' nodes with children:', kids.length)
  } else if (t) {
    console.log(' tree type:', typeof t, '| keys:', Object.keys(t).slice(0, 10))
    console.log(' sample:', JSON.stringify(t).slice(0, 400))
  }
  const ent = await call({ type: 'get_entries' })
  const e = ent.data ?? {}
  const list = e.entries ?? []
  console.log('\n[get_entries] count =', list.length, '| keys of entry:', Object.keys(list[0] || {}))
  console.log(' sample:', JSON.stringify(list[0]).slice(0, 300))
  child.kill(); process.exit(0)
})()
setTimeout(() => { console.log('TIMEOUT'); child.kill(); process.exit(1) }, 60000)
