// 本地透明代理：拦截 Claude Code 发出的 /v1/messages 请求，完整导出 system / tools
// 用法：
//   UPSTREAM=https://api.deepseek.com/anthropic node scripts/export-context.mjs [outDir]
//   ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude -p "hi"
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.PROXY_PORT || 8787)
const UPSTREAM = process.env.UPSTREAM || 'https://api.anthropic.com'
const OUT = path.resolve(process.argv[2] || 'context-dump')
fs.mkdirSync(OUT, { recursive: true })

let seq = 0

const est = (s) => Math.round(s.length / 3.6)

function dump(bodyBuf) {
  let json
  try {
    json = JSON.parse(bodyBuf.toString('utf8'))
  } catch {
    return
  }
  if (!json.system && !json.tools) return

  const id = String(++seq).padStart(2, '0')
  const dir = path.join(OUT, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(json, null, 2))

  const systemText = (Array.isArray(json.system) ? json.system : [json.system])
    .map((b) => (typeof b === 'string' ? b : b?.text || ''))
    .filter(Boolean)
    .join('\n\n')
  fs.writeFileSync(path.join(dir, 'system.txt'), systemText)

  const tools = json.tools || []
  fs.writeFileSync(path.join(dir, 'tools.json'), JSON.stringify(tools, null, 2))
  const toolsMd = tools
    .map(
      (t) =>
        `## ${t.name}\n\n${t.description || ''}\n\n\`\`\`json\n${JSON.stringify(t.input_schema || {}, null, 2)}\n\`\`\``
    )
    .join('\n\n')
  fs.writeFileSync(path.join(dir, 'tools.md'), toolsMd)
  fs.writeFileSync(path.join(dir, 'messages.json'), JSON.stringify(json.messages || [], null, 2))

  const perTool = tools
    .map((t) => {
      const size = (t.description || '').length + JSON.stringify(t.input_schema || {}).length
      return `| ${t.name} | ${size} | ~${est(' '.repeat(size))} |`
    })
    .join('\n')

  fs.writeFileSync(
    path.join(dir, 'summary.md'),
    [
      `upstream: ${UPSTREAM}`,
      `model: ${json.model}`,
      `stream: ${json.stream}`,
      `system blocks: ${Array.isArray(json.system) ? json.system.length : 1}`,
      `system chars: ${systemText.length} (~${est(systemText)} tok)`,
      `tool count: ${tools.length}`,
      `tools chars: ${JSON.stringify(tools).length} (~${est(JSON.stringify(tools))} tok)`,
      `messages chars: ${JSON.stringify(json.messages || []).length}`,
      '',
      '| tool | chars | est tokens |',
      '|---|---|---|',
      perTool,
      ''
    ].join('\n')
  )

  console.log(
    `[dump ${id}] ${json.model} system=${systemText.length}c tools=${tools.length}/${JSON.stringify(tools).length}c`
  )
}

function forward(req, res, body) {
  const u = new URL(UPSTREAM)
  const mod = u.protocol === 'https:' ? https : http
  const headers = { ...req.headers, host: u.host }
  delete headers['content-length']

  const opts = {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: u.pathname.replace(/\/$/, '') + req.url,
    headers
  }

  const up = mod.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers)
    upRes.pipe(res)
  })
  up.setTimeout(Number(process.env.UPSTREAM_TIMEOUT_MS || 600000), () => {
    up.destroy(new Error('upstream timeout'))
  })
  up.on('error', (e) => {
    console.error(`[proxy] ${req.method} ${req.url} -> ${e.message}`)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`proxy error: ${e.message}`)
  })
  up.end(body)
}

http
  .createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      console.log(`[req] ${req.method} ${req.url} ${body.length}b`)
      if (req.url.includes('/v1/messages')) dump(body)
      forward(req, res, body)
    })
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`listening http://127.0.0.1:${PORT} -> ${UPSTREAM}`)
    console.log(`output: ${OUT}`)
    console.log(`\n另开终端：ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT} claude -p "hi"`)
  })
