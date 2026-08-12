'use strict'

// Vibe computer-use MCP bridge: stdio JSON-RPC (cc side) <-> named pipe (Electron main side).
// Auto-answers initialize/tools/list; forwards tools/call to the main process via named pipe.
// Loaded only when cc is spawned with computerUse=true (zero overhead when disabled).

const net = require('net')
const readline = require('readline')

const PIPE = process.env.VIBE_CU_PIPE
const TOKEN = process.env.VIBE_CU_TOKEN

if (!PIPE || !TOKEN) {
  process.stderr.write('vibe-cu-mcp: missing VIBE_CU_PIPE or VIBE_CU_TOKEN env\n')
  process.exit(1)
}

const TOOLS = [
  {
    name: 'screenshot',
    description: 'Take a screenshot of a display. Returns a base64 PNG image plus a snapshot_id and display info. display: "primary" (default), a target display_id from the "all displays" list in the text, or "all" for reconnaissance (one image per display; the returned snapshot is NOT usable for actions — call screenshot(display: <id>) for the display you want to operate on first). Coordinates in the image are physical pixels of that display; click/type/scroll coordinates map 1:1. All action tools MUST carry the latest snapshot_id (a stale snapshot_id is rejected).',
    inputSchema: {
      type: 'object',
      properties: {
        display: { type: 'string', default: 'primary', description: '"primary" (default), a target display_id, or "all" (reconnaissance: one image per display; snapshot not usable for actions)' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'cursor_position',
    description: 'Get the current mouse cursor position in global physical pixels, the display it is on (display_id, is_primary, scale_factor), the position relative to that display (matching screenshot coordinates), and the current snapshot_id.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'click',
    description: 'Click at (x, y) in the pixel coordinates of the most recent single-display screenshot. button: left/right/middle. count: 1/2/3 (2 = double click).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', description: 'x in the most recent single-display screenshot pixels' },
        y: { type: 'integer', description: 'y in the most recent single-display screenshot pixels' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        count: { type: 'integer', enum: [1, 2, 3], default: 1 },
        snapshot_id: { type: 'string', description: 'latest snapshot_id from screenshot()' }
      },
      required: ['x', 'y', 'snapshot_id'],
      additionalProperties: false
    }
  },
  {
    name: 'type_text',
    description: 'Type text by writing to the clipboard and sending Ctrl+V (most reliable for long text). Requires a prior single-display screenshot of the target display.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        snapshot_id: { type: 'string' }
      },
      required: ['text', 'snapshot_id'],
      additionalProperties: false
    }
  },
  {
    name: 'press_key',
    description: 'Press a key combination, e.g. "Return", "Escape", "Control_L+a", "Alt+F4". Uses xdotool-style key names. Requires a prior single-display screenshot of the target display.',
    inputSchema: {
      type: 'object',
      properties: {
        keys: { type: 'string' },
        snapshot_id: { type: 'string' }
      },
      required: ['keys', 'snapshot_id'],
      additionalProperties: false
    }
  },
  {
    name: 'scroll',
    description: 'Scroll at (x, y) by dx, dy ticks (positive dy = scroll down). x/y are pixel coordinates of the most recent single-display screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
        dx: { type: 'integer' },
        dy: { type: 'integer' },
        snapshot_id: { type: 'string' }
      },
      required: ['x', 'y', 'dx', 'dy', 'snapshot_id'],
      additionalProperties: false
    }
  }
]

let pipe = null
let pipeConnecting = null
const pendingCalls = new Map()
let nextCallId = 1

function ensurePipe () {
  if (pipe && pipe.writable) return Promise.resolve(pipe)
  if (pipeConnecting) return pipeConnecting
  pipeConnecting = new Promise((resolve, reject) => {
    const sock = net.connect(PIPE)
    let buf = ''
    sock.on('connect', () => { pipe = sock; pipeConnecting = null; resolve(sock) })
    sock.on('error', (e) => { pipe = null; pipeConnecting = null; reject(e) })
    sock.on('close', () => {
      pipe = null
      pipeConnecting = null
      for (const [, p] of pendingCalls) p.reject(new Error('pipe closed'))
      pendingCalls.clear()
    })
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf-8')
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        const t = line.trim()
        if (!t) continue
        let msg
        try { msg = JSON.parse(t) } catch { continue }
        const p = pendingCalls.get(msg.id)
        if (!p) continue
        pendingCalls.delete(msg.id)
        if (msg.type === 'result') p.resolve(msg)
        else if (msg.type === 'error') p.reject(new Error(msg.message || 'pipe error'))
      }
    })
    setTimeout(() => {
      if (!pipe) { pipeConnecting = null; reject(new Error('pipe connect timeout')) }
    }, 5000)
  })
  return pipeConnecting
}

async function callMain (name, args) {
  const id = `c${nextCallId++}`
  const sock = await ensurePipe()
  return new Promise((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject })
    sock.write(JSON.stringify({ id, type: 'call', name, arguments: args || {}, token: TOKEN }) + '\n')
    setTimeout(() => {
      if (pendingCalls.has(id)) {
        pendingCalls.delete(id)
        reject(new Error('main process call timeout (30s)'))
      }
    }, 30000)
  })
}

function send (obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function okResult (id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function errResult (id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handleMessage (req) {
  if (req.method === 'initialize') {
    okResult(req.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'vibe-cu', version: '0.1.0' }
    })
    return
  }
  if (req.method === 'notifications/initialized') {
    return
  }
  if (req.method === 'tools/list') {
    okResult(req.id, { tools: TOOLS })
    return
  }
  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params || {}
    try {
      const r = await callMain(name, args || {})
      okResult(req.id, {
        content: r.content || [{ type: 'text', text: 'ok' }],
        isError: !!r.isError
      })
    } catch (e) {
      okResult(req.id, {
        content: [{ type: 'text', text: `error: ${e.message}` }],
        isError: true
      })
    }
    return
  }
  if (req.id !== undefined) {
    errResult(req.id, -32601, `method not found: ${req.method}`)
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const t = line.trim()
  if (!t) return
  let req
  try { req = JSON.parse(t) } catch { return }
  handleMessage(req).catch((e) => {
    if (req && req.id !== undefined) errResult(req.id, -32603, `internal error: ${e.message}`)
  })
})

process.stderr.write('vibe-cu-mcp ready\n')
