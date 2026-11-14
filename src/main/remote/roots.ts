const remoteRoots = new Map<string, string>()

const norm = (p: string): string => {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return n || '/'
}

export function registerRemoteRoot(root: string, connectionId: string): void {
  if (typeof root !== 'string' || !root.startsWith('/')) return
  remoteRoots.set(norm(root), connectionId)
}

export function unregisterRemoteConnection(connectionId: string): void {
  for (const [root, cid] of remoteRoots) {
    if (cid === connectionId) remoteRoots.delete(root)
  }
}

export function resolveRemoteConnection(filePath: string): string | undefined {
  if (typeof filePath !== 'string' || !filePath.startsWith('/')) return undefined
  const n = norm(filePath)
  let best = -1
  let connectionId: string | undefined
  for (const [root, cid] of remoteRoots) {
    const hit = root === '/' ? true : n === root || n.startsWith(root + '/')
    if (hit && root.length > best) {
      best = root.length
      connectionId = cid
    }
  }
  return connectionId
}

export function isRemotePath(filePath: string): boolean {
  return resolveRemoteConnection(filePath) !== undefined
}
