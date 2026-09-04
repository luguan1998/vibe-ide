'use strict'

// Vibe browser-control MCP bridge: stdio JSON-RPC (cc side) <-> named pipe (Electron main side).
// Auto-answers initialize/tools/list; forwards tools/call to the main process via named pipe.
// Loaded in every Claude session (tools error out when no embedded browser is open).

const net = require('net')
const readline = require('readline')

const PIPE = process.env.VIBE_BM_PIPE
const TOKEN = process.env.VIBE_BM_TOKEN

if (!PIPE || !TOKEN) {
  process.stderr.write('vibe-browser-mcp: missing VIBE_BM_PIPE or VIBE_BM_TOKEN env\n')
  process.exit(1)
}

const SNAP_NOTE = ' Acts return a fresh snapshot automatically (pass quiet:true to suppress). Refs are DOM-stamped and survive SPA re-renders, but real navigation invalidates them — on a "not found" error, re-snapshot.'

const TOOLS = [
  {
    name: 'browser_snapshot',
    description: 'List the interactive elements of the built-in embedded browser page as a text tree — one line per control, e.g. `e12 input[text] v="" label="Email" required`, `e13 [button] v="Sign in"`. Covers every frame: elements inside iframes (including cross-origin embedded documents like WebOffice/WPS) appear under a `--- frame <url> ---` section and their refs work like any other. Prefer this over screenshots for targeting. Always snapshot before acting.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        boxes: { type: 'boolean', description: 'include viewport rects in top-viewport CSS px (frame offsets already applied; only needed for coordinate reasoning)' },
        max: { type: 'integer', description: 'max lines, default 250; hidden refs remain reachable via browser_find' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'browser_find',
    description: 'Search all snapshot elements by text (label/placeholder/value/text), cheaper than a full snapshot. Searches every frame (main + iframes). Returns matching refs with snippets. Requires at least one browser_snapshot on the current page.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_click',
    description: 'Click element ref (auto scrolled into view; trusted real mouse event — hover menus, links and buttons all behave as user input). button: left/right. double: true for double-click.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'snapshot ref like "e12"' },
        button: { type: 'string', enum: ['left', 'right'], default: 'left' },
        double: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false }
      },
      required: ['ref'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_click_xy',
    description: 'Click at top-viewport CSS pixel coordinates (same space as snapshot box= rects). The way to hit canvas-rendered content — spreadsheet grids (WPS/WebOffice), maps, images — which exposes no DOM cells even inside its iframe. Flow for canvas UIs: browser_screenshot → convert screenshot px to CSS px with its VIEWPORT scale line → click here on the cell → browser_type to enter the value → browser_press "Tab"/"Return" to commit. button: left/right. double: true for double-click.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', description: 'top-viewport CSS px from left' },
        y: { type: 'integer', description: 'top-viewport CSS px from top' },
        button: { type: 'string', enum: ['left', 'right'], default: 'left' },
        double: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false }
      },
      required: ['x', 'y'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_fill',
    description: 'Set a field: text input/textarea (React/Vue-compatible native setter + input/change events), select (match by option value or visible text), checkbox/radio (value "true"/"false"), contenteditable. Use browser_click + browser_press for custom widgets.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        text: { type: 'string' },
        quiet: { type: 'boolean', default: false }
      },
      required: ['ref', 'text'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_fill_form',
    description: 'Fill many fields in one call — strongly preferred for forms (faster, fewer tokens, less turn churn). fields: [{ref, value}]; value rules same as browser_fill. Reports skipped fields.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ref: { type: 'string' }, value: { type: 'string' } },
            required: ['ref', 'value'],
            additionalProperties: false
          }
        },
        quiet: { type: 'boolean', default: false }
      },
      required: ['fields'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_press',
    description: 'Send a key combination to the focused element (optionally focus ref first): "Return", "Tab", "Escape", "ArrowDown", "Control+a", "Alt+Enter", "F5". Keys go to the globally focused element — this still works after clicking into an iframe or a canvas grid\'s hidden input.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        keys: { type: 'string' },
        ref: { type: 'string', description: 'optional: focus this element before pressing' },
        quiet: { type: 'boolean', default: false }
      },
      required: ['keys'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_type',
    description: 'Insert text (CJK/emoji safe) into the currently focused element at the browser input layer — reaches elements inside cross-origin iframes and canvas grids (e.g. a WebOffice cell editor focused by browser_click_xy). Prefer browser_fill for plain DOM inputs (it fires React-compatible events); use browser_type for everything not in the DOM.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        quiet: { type: 'boolean', default: false }
      },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page: pass ref to bring that element into view, or dx/dy wheel ticks (positive dy = down) at page center.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        dx: { type: 'integer' },
        dy: { type: 'integer' },
        quiet: { type: 'boolean', default: false }
      },
      additionalProperties: false
    }
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the embedded browser to url (scheme auto-added if missing); waits for load and returns a fresh snapshot. The user sees the same browser tab.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_back',
    description: 'Go back in browser history; returns fresh snapshot.' + SNAP_NOTE,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'browser_forward',
    description: 'Go forward in browser history; returns fresh snapshot.' + SNAP_NOTE,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'browser_reload',
    description: 'Reload the current page; returns fresh snapshot.' + SNAP_NOTE,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until text appears in the page or any iframe (or disappears with gone:true). Use after submitting a form or clicking something that loads asynchronously.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        gone: { type: 'boolean', default: false },
        timeout: { type: 'integer', description: 'ms, default 10000, max 60000' }
      },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'browser_screenshot',
    description: 'PNG screenshot of the embedded browser page — visual verification and the primary path for canvas/image-only UIs (spreadsheet grids, maps). The text result carries a VIEWPORT line: convert screenshot pixels to top-viewport CSS px with the reported scale, then drive the UI with browser_click_xy + browser_type + browser_press. For DOM-based UIs prefer browser_snapshot + refs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'browser_extract',
    description: 'Read visible text of the page or a region. selector: CSS selector, or "#eN" for a snapshot ref (resolved across frames), or omitted = whole page (falls back to iframes when the main frame is empty). max_chars default 8000 (max 50000).',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        max_chars: { type: 'integer', default: 8000 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'browser_eval',
    description: 'Escape hatch: async JS in the page for date pickers / custom widgets / structured reads. Body sees `el` (resolved from ref, or null); use `return value`. Result is stringified and truncated at 10k chars.' + SNAP_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'function body, e.g. "return document.title"' },
        ref: { type: 'string', description: 'optional: pass snapshot element as el' },
        in_frame: { type: 'string', description: 'optional: URL substring of the frame to run in (defaults to main frame). Main-process privileged — reaches cross-origin iframes (e.g. "weboffice" to run inside an embedded WPS document and touch its window objects). A ref overrides this routing.' }
      },
      required: ['code'],
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
        reject(new Error('main process call timeout (60s)'))
      }
    }, 60000)
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
      serverInfo: { name: 'vibe-browser', version: '0.1.0' }
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

process.stderr.write('vibe-browser-mcp ready\n')
