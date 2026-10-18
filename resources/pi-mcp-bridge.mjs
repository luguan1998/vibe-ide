export default function (pi) {
  const raw = process.env.VIBE_PI_MCP_SERVERS
  if (!raw) return
  let servers
  try {
    servers = JSON.parse(raw)
  } catch {
    return
  }
  for (const [name, config] of Object.entries(servers || {})) {
    try {
      pi.registerMcpServer(name, config)
    } catch (e) {
      process.stderr.write(`vibe-pi-mcp: register ${name} failed: ${e?.message ?? e}\n`)
    }
  }
}
