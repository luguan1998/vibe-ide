import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = os.tmpdir()
const files = fs.readdirSync(dir).filter((f) => /^vibe-bm-mcp-.*\.json$/.test(f))
if (!files.length) {
  console.error('未找到 vibe-bm-mcp-*.json：请先在 AI 会话里点亮浏览器按钮（Web Debug）')
  process.exit(1)
}
files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)
const cfg = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf-8'))
const env = cfg.mcpServers['vibe-browser'].env

const tool = process.argv[2] || 'browser_snapshot'
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {}
const id = Date.now()

const sock = net.connect(env.VIBE_BM_PIPE, () => {
  sock.write(JSON.stringify({ id, type: 'call', name: tool, arguments: args, token: env.VIBE_BM_TOKEN }) + '\n')
})

let buf = ''
sock.on('data', (d) => {
  buf += d.toString('utf-8')
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id !== id) continue
    for (const part of msg.content || []) {
      if (part.type === 'text') console.log(part.text)
      if (part.type === 'image') {
        fs.writeFileSync('browser-tool-test.png', Buffer.from(part.data, 'base64'))
        console.log('screenshot saved -> browser-tool-test.png')
      }
    }
    if (msg.isError) process.exitCode = 1
    sock.end()
  }
})
sock.on('error', (e) => {
  console.error('pipe error:', e.message)
  process.exit(1)
})
setTimeout(() => {
  console.error('timeout')
  process.exit(1)
}, 70000)
