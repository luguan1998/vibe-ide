// 验证 get_messages 回放的记录是否带毫秒 timestamp（meta hover 显示的时间来源）
import { spawn } from 'node:child_process'
const [sid, cwd] = process.argv.slice(2)
const child = spawn('pi', ['--mode', 'rpc', '--session', sid], { cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
let buf = ''
child.stdout.on('data', (c) => {
  buf += c.toString()
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (r.type === 'response' && r.command === 'get_messages') {
      const ms = r.data?.messages ?? []
      console.log('count =', ms.length)
      for (const m of ms.slice(0, 3)) console.log('  role:', m.role, '| timestamp:', m.timestamp, '| typeof:', typeof m.timestamp)
      child.kill()
      process.exit(0)
    }
  }
})
child.stdin.write(JSON.stringify({ type: 'get_messages', id: 'x1' }) + '\n')
setTimeout(() => { console.log('TIMEOUT'); child.kill(); process.exit(1) }, 45000)
