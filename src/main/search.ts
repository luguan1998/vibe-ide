import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import { grepFiles, replaceInFiles, type GrepOptions, type ReplaceOptions } from '../shared/contentSearch'
import { getSshRelay } from './remote/ssh'
import { resolveRemoteConnection } from './remote/roots'

function remoteRelay(cwd: string) {
  const connectionId = resolveRemoteConnection(cwd)
  return connectionId ? getSshRelay(connectionId) : undefined
}

export function registerSearchHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SEARCH_GREP, async (_event, options: GrepOptions) => {
    const { query, cwd } = options || {}

    if (!query || !cwd) {
      return { matches: [], total: 0, truncated: false }
    }

    const relay = remoteRelay(cwd)
    if (relay) return relay.request('search.grep', options)

    return await grepFiles(options)
  })

  ipcMain.handle(IPC_CHANNELS.SEARCH_REPLACE, async (_event, options: ReplaceOptions) => {
    const { query, cwd } = options || {}

    if (!query || !cwd) {
      return { filesModified: 0, totalReplacements: 0, errors: [] }
    }

    const relay = remoteRelay(cwd)
    if (relay) return relay.request('search.replace', options)

    return await replaceInFiles(options)
  })
}
