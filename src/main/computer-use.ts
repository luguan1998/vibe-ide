import { app, desktopCapturer, clipboard, screen } from 'electron'
import { createServer, type Server, type Socket } from 'net'
import { join } from 'path'
import { writeFileSync, unlinkSync } from 'fs'
import { randomBytes } from 'crypto'
import { execFile } from 'child_process'

const ADD_TYPE_PS = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class VibeU{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,int d,IntPtr e);[DllImport("user32.dll")]public static extern void keybd_event(byte b,byte s,uint f,IntPtr e);[DllImport("user32.dll")]public static extern bool GetCursorPos(ref POINT p);public struct POINT{public int X;public int Y;}}' -Language CSharp`

const VK_MAP: Record<string, number> = {
  'control_l': 0xA2, 'control': 0xA2, 'ctrl': 0xA2, 'ctrl_l': 0xA2, 'control_r': 0xA3, 'ctrl_r': 0xA3,
  'shift': 0xA0, 'shift_l': 0xA0, 'shift_r': 0xA1,
  'alt': 0xA4, 'alt_l': 0xA4, 'alt_r': 0xA5, 'option': 0xA4,
  'super': 0x5B, 'super_l': 0x5B, 'super_r': 0x5C, 'meta': 0x5B, 'meta_l': 0x5B, 'meta_r': 0x5C, 'win': 0x5B, 'win_l': 0x5B, 'win_r': 0x5C,
  'command': 0x5B, 'command_l': 0x5B, 'command_r': 0x5C, 'cmd': 0x5B, 'cmd_l': 0x5B, 'cmd_r': 0x5C, 'right_cmd': 0x5C, 'left_cmd': 0x5B,
  'return': 0x0D, 'enter': 0x0D, 'kp_enter': 0x0D,
  'escape': 0x1B, 'esc': 0x1B,
  'tab': 0x09, 'space': 0x20, 'spacebar': 0x20,
  'backspace': 0x08, 'back_space': 0x08,
  'delete': 0x2E, 'del': 0x2E,
  'insert': 0x2D,
  'left': 0x25, 'right': 0x27, 'up': 0x26, 'down': 0x28,
  'home': 0x24, 'end': 0x23,
  'page_up': 0x21, 'page_down': 0x22, 'prior': 0x21, 'next': 0x22,
  'caps_lock': 0x14, 'num_lock': 0x90, 'scroll_lock': 0x91,
  'print': 0x2C, 'print_screen': 0x2C, 'sys_rq': 0x2C, 'pause': 0x13,
  'minus': 0xBD, 'equal': 0xBB, 'bracketleft': 0xDB, 'bracketright': 0xDD, 'backslash': 0xDC,
  'semicolon': 0xBA, 'apostrophe': 0xDE, 'grave': 0xC0, 'comma': 0xBC, 'period': 0xBE, 'slash': 0xBF,
  'kp_0': 0x60, 'kp_1': 0x61, 'kp_2': 0x62, 'kp_3': 0x63, 'kp_4': 0x64,
  'kp_5': 0x65, 'kp_6': 0x66, 'kp_7': 0x67, 'kp_8': 0x68, 'kp_9': 0x69,
  'kp_add': 0x6B, 'kp_subtract': 0x6D, 'kp_multiply': 0x6A, 'kp_divide': 0x6F, 'kp_decimal': 0x6E,
  'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74, 'f6': 0x75,
  'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
}

interface SessionState {
  sessionId: string
  pipeName: string
  token: string
  server: Server | null
  mcpConfigPath: string
  snapshotId: number
  client: Socket | null
  clientBuf: string
}

const sessions = new Map<string, SessionState>()

interface ToolResult { content: any[]; isError: boolean }

function resolveMcpScriptPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'computer-use-mcp.js')
  return join(app.getAppPath(), 'resources', 'computer-use-mcp.js')
}

function runPowershell(script: string): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}; stderr: ${stderr.toString().trim()}`))
      else resolve(stdout)
    })
  })
}

function keyToVk(k: string): number {
  const kl = k.toLowerCase()
  if (VK_MAP[kl] !== undefined) return VK_MAP[kl]
  if (/^[a-z]$/i.test(k)) return k.toUpperCase().charCodeAt(0)
  if (/^[0-9]$/.test(k)) return k.charCodeAt(0)
  const ASCII_VK: Record<string, number> = {
    '=': 0xBB, '+': 0xBB, '-': 0xBD, '_': 0xBD,
    '.': 0xBE, ',': 0xBC, '/': 0xBF, '?': 0xBF,
    ';': 0xBA, ':': 0xBA, "'": 0xDE, '"': 0xDE,
    '`': 0xC0, '~': 0xC0, '[': 0xDB, '{': 0xDB,
    ']': 0xDD, '}': 0xDD, '\\': 0xDC, '|': 0xDC,
    ' ': 0x20, '\t': 0x09,
  }
  if (ASCII_VK[kl] !== undefined) return ASCII_VK[kl]
  throw new Error(`unsupported key: ${k}`)
}

function snapshotIdOf(session: SessionState): string {
  return `snap_${session.snapshotId}`
}

function assertSnapshot(session: SessionState, id: string): void {
  if (session.snapshotId === 0) throw new Error('no screenshot taken yet; call screenshot() first')
  const current = snapshotIdOf(session)
  if (id !== current) throw new Error(`stale snapshot_id: got ${id}, expected ${current}; call screenshot() first`)
}

async function takeScreenshot(session: SessionState): Promise<ToolResult> {
  const display = screen.getPrimaryDisplay()
  const sf = display.scaleFactor
  const physW = Math.round(display.size.width * sf)
  const physH = Math.round(display.size.height * sf)
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: physW, height: physH },
  })
  const source = sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    return { content: [{ type: 'text', text: 'screen capture returned empty thumbnail (window minimized or locked?)' }], isError: true }
  }
  const img = source.thumbnail
  const b64 = img.toPNG().toString('base64')
  const size = img.getSize()
  session.snapshotId++
  const sid = snapshotIdOf(session)
  return {
    content: [
      { type: 'image', data: b64, mimeType: 'image/png' },
      { type: 'text', text: `snapshot_id=${sid}; width=${size.width}; height=${size.height}; display=${display.size.width}x${display.size.height}@${sf}x` },
    ],
    isError: false,
  }
}

async function sendClick(x: number, y: number, button: string, count: number): Promise<void> {
  const flags = button === 'right' ? 0x08 | 0x10 : button === 'middle' ? 0x20 | 0x40 : 0x02 | 0x04
  let ps = `${ADD_TYPE_PS}\n[VibeU]::SetCursorPos(${x},${y})\n`
  for (let i = 0; i < count; i++) ps += `[VibeU]::mouse_event(${flags},0,0,0,0)\n`
  await runPowershell(ps)
}

async function sendTypeText(text: string): Promise<void> {
  clipboard.writeText(text)
  const ps = `${ADD_TYPE_PS}\n[VibeU]::keybd_event(0xA2,0,0,0)\n[VibeU]::keybd_event(0x56,0,0,0)\n[VibeU]::keybd_event(0x56,0,2,0)\n[VibeU]::keybd_event(0xA2,0,2,0)\n`
  await runPowershell(ps)
}

async function sendKeys(keys: string): Promise<void> {
  const vks = keys.split('+').map(k => keyToVk(k.trim()))
  let ps = `${ADD_TYPE_PS}\n`
  for (const v of vks) ps += `[VibeU]::keybd_event(${v},0,0,0)\n`
  for (let i = vks.length - 1; i >= 0; i--) ps += `[VibeU]::keybd_event(${vks[i]},0,2,0)\n`
  await runPowershell(ps)
}

async function sendScroll(x: number, y: number, dx: number, dy: number): Promise<void> {
  let ps = `${ADD_TYPE_PS}\n[VibeU]::SetCursorPos(${x},${y})\n`
  if (dy !== 0) ps += `[VibeU]::mouse_event(0x0800,0,0,${dy * 120},0)\n`
  if (dx !== 0) ps += `[VibeU]::mouse_event(0x1000,0,0,${dx * 120},0)\n`
  await runPowershell(ps)
}

async function cursorPosition(): Promise<{ x: number; y: number }> {
  const ps = `${ADD_TYPE_PS}\n$p = New-Object VibeU+POINT; [VibeU]::GetCursorPos([ref]$p) | Out-Null; "$($p.X),$($p.Y)"`
  const out = (await runPowershell(ps)).trim()
  const parts = out.split(',')
  return { x: Number(parts[0]) || 0, y: Number(parts[1]) || 0 }
}

async function handleClientCall(session: SessionState, name: string, args: any): Promise<ToolResult> {
  switch (name) {
    case 'screenshot':
      return takeScreenshot(session)
    case 'cursor_position': {
      const { x, y } = await cursorPosition()
      return { content: [{ type: 'text', text: JSON.stringify({ x, y, snapshot_id: snapshotIdOf(session) }) }], isError: false }
    }
    case 'click':
      assertSnapshot(session, args?.snapshot_id)
      await sendClick(args.x, args.y, args.button || 'left', args.count || 1)
      return { content: [{ type: 'text', text: `clicked ${args.button || 'left'} at (${args.x},${args.y})` }], isError: false }
    case 'type_text':
      assertSnapshot(session, args?.snapshot_id)
      await sendTypeText(args.text)
      return { content: [{ type: 'text', text: `typed ${args.text.length} chars` }], isError: false }
    case 'press_key':
      assertSnapshot(session, args?.snapshot_id)
      await sendKeys(args.keys)
      return { content: [{ type: 'text', text: `pressed ${args.keys}` }], isError: false }
    case 'scroll':
      assertSnapshot(session, args?.snapshot_id)
      await sendScroll(args.x, args.y, args.dx, args.dy)
      return { content: [{ type: 'text', text: `scrolled dx=${args.dx} dy=${args.dy}` }], isError: false }
    default:
      return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
  }
}

async function handleClientMessage(session: SessionState, sock: Socket, msg: any): Promise<void> {
  if (msg.type !== 'call') return
  if (msg.token !== session.token) {
    sock.write(JSON.stringify({ id: msg.id, type: 'error', message: 'bad token' }) + '\n')
    return
  }
  try {
    const result = await handleClientCall(session, msg.name, msg.arguments || {})
    sock.write(JSON.stringify({ id: msg.id, type: 'result', content: result.content, isError: result.isError }) + '\n')
  } catch (e: any) {
    sock.write(JSON.stringify({ id: msg.id, type: 'result', content: [{ type: 'text', text: `error: ${e.message}` }], isError: true }) + '\n')
  }
}

export function startForSession(sessionId: string): { pipeName: string; token: string; mcpConfigPath: string } {
  const pipeName = `\\\\.\\pipe\\vibe-cu-${randomBytes(8).toString('hex')}`
  const token = randomBytes(16).toString('hex')
  const scriptPath = resolveMcpScriptPath()
  const mcpConfigPath = join(app.getPath('temp'), `vibe-cu-mcp-${sessionId}.json`)

  const session: SessionState = {
    sessionId,
    pipeName,
    token,
    server: null,
    mcpConfigPath,
    snapshotId: 0,
    client: null,
    clientBuf: '',
  }

  const server = createServer((sock) => {
    session.client = sock
    sock.on('data', (chunk) => {
      session.clientBuf += chunk.toString('utf-8')
      const lines = session.clientBuf.split('\n')
      session.clientBuf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t) continue
        let msg: any
        try { msg = JSON.parse(t) } catch { continue }
        handleClientMessage(session, sock, msg).catch(() => {})
      }
    })
    sock.on('close', () => { if (session.client === sock) session.client = null })
    sock.on('error', () => {})
  })
  server.on('error', (e: any) => {
    console.error(`[cu:${sessionId}] pipe listen error:`, e.message)
    try { session.server?.close() } catch {}
    try { unlinkSync(session.mcpConfigPath) } catch {}
    sessions.delete(sessionId)
  })
  session.server = server
  server.listen(pipeName)

  const config = {
    mcpServers: {
      'vibe-cu': {
        command: process.execPath,
        args: [scriptPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          VIBE_CU_PIPE: pipeName,
          VIBE_CU_TOKEN: token,
        },
      },
    },
  }
  writeFileSync(mcpConfigPath, JSON.stringify(config))

  sessions.set(sessionId, session)
  return { pipeName, token, mcpConfigPath }
}

export function stopForSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  try { session.server?.close() } catch {}
  try { session.client?.destroy() } catch {}
  try { unlinkSync(session.mcpConfigPath) } catch {}
  sessions.delete(sessionId)
}
