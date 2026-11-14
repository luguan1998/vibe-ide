import React, { useState, useEffect, useCallback, useRef } from 'react'
import { FolderPlus, FolderUp, HardDrive, Server, Plus, Trash2, Pencil, Monitor } from 'lucide-react'
import { ModalOverlay } from './ModalOverlay'
import { FolderIcon } from './FileIcons'
import { ToolIcon } from './AiTab/tools'
import { useI18n } from '../i18n'
import { useRecentDirs } from '../cwdStore'
import { getLastNewMode } from '../utils/sessionModePrefs'
import { isLocalAbsPath } from '../utils/filePathUtils'
import { ClaudeLogoIcon } from './ClaudeLogoIcon'
import { PiLogoIcon } from './PiLogoIcon'
import type { SshHost, SshHostInput } from '@shared/types'

export type SessionMode = 'term' | 'gui' | 'pi'

export interface SshLaunchInfo {
  connectionId: string
  hostId: string
  hostLabel: string
}

interface DirEntry { name: string; path: string; type: string }

interface HostDraft {
  id?: string
  label: string
  host: string
  port: string
  username: string
  authMethod: 'password' | 'key' | 'agent'
  privateKeyPath: string
  password: string
  passphrase: string
}

const emptyDraft = (): HostDraft => ({
  label: '',
  host: '',
  port: '',
  username: '',
  authMethod: 'password',
  privateKeyPath: '',
  password: '',
  passphrase: '',
})

const hostToDraft = (host: SshHost): HostDraft => ({
  id: host.id,
  label: host.label,
  host: host.host,
  port: host.port ? String(host.port) : '',
  username: host.username || '',
  authMethod: host.authMethod,
  privateKeyPath: host.privateKeyPath || '',
  password: '',
  passphrase: '',
})

const draftToInput = (draft: HostDraft): SshHostInput => ({
  id: draft.id,
  label: draft.label.trim(),
  host: draft.host.trim(),
  port: draft.port.trim() ? Number(draft.port.trim()) : undefined,
  username: draft.username.trim() || undefined,
  authMethod: draft.authMethod,
  privateKeyPath: draft.authMethod === 'key' ? draft.privateKeyPath.trim() || undefined : undefined,
  password: draft.authMethod === 'password' ? draft.password || undefined : undefined,
  passphrase: draft.passphrase || undefined,
})

const sshParent = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  if (!trimmed || trimmed === '/') return '/'
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

// 最近目录路径：父路径吃剩余宽度按需省略，目录名（叶子）恒完整——宽度交给浏览器排版，随弹窗改大小自适应
const RecentDirPath = ({ path }: { path: string }) => {
  const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  const head = idx < 0 ? '' : path.slice(0, idx)
  const name = idx < 0 ? path : path.slice(idx)
  return (
    <span className="flex-1 min-w-0 overflow-hidden flex items-center">
      {head && <span className="truncate">{head}</span>}
      <span className="shrink-0">{name}</span>
    </span>
  )
}

const crumbCls = 'shrink-0 px-1 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors'

const Breadcrumbs = ({ items, root, onNavigate }: {
  items: { label: string; path: string }[]
  root?: boolean
  onNavigate: (path: string) => void
}) => (
  <>
    {root && (
      <button
        onClick={(e) => { e.stopPropagation(); onNavigate('/') }}
        className={crumbCls}
        title="/"
      >
        /
      </button>
    )}
    {items.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span className="text-ide-text-muted shrink-0">/</span>}
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(c.path) }}
          className={`${crumbCls} max-w-[160px] truncate`}
          title={c.path}
        >
          {c.label}
        </button>
      </React.Fragment>
    ))}
  </>
)

const DirRow = ({ entry, onOpen }: { entry: DirEntry; onOpen: (path: string) => void }) => (
  <button
    onClick={() => onOpen(entry.path)}
    className="w-full px-3 py-0.5 text-left text-xs text-ide-text hover:bg-ide-hover flex items-center gap-1.5"
  >
    <FolderIcon name={entry.name} className="w-3 h-3 text-ide-text-muted" />
    <span className="truncate">{entry.name}</span>
  </button>
)

export function DirectoryPicker({ initialDir, onConfirm, onCancel }: {
  initialDir: string
  onConfirm: (cwd: string, mode: SessionMode, ssh?: SshLaunchInfo) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const recentDirs = useRecentDirs().filter(isLocalAbsPath)
  const [tab, setTab] = useState<'local' | 'ssh'>('local')
  const [cwd, setCwd] = useState(initialDir)
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<SessionMode>(getLastNewMode())
  const [drives, setDrives] = useState<string[] | null>(null)
  const [editingPath, setEditingPath] = useState(false)
  const [pathText, setPathText] = useState(initialDir)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderError, setNewFolderError] = useState<string | null>(null)
  const [launchMenuOpen, setLaunchMenuOpen] = useState(false)

  const [hosts, setHosts] = useState<SshHost[]>([])
  const [draft, setDraft] = useState<HostDraft | null>(null)
  const [deletingHost, setDeletingHost] = useState<SshHost | null>(null)
  const [sshError, setSshError] = useState<string | null>(null)
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null)
  const [sshConn, setSshConn] = useState<{ id: string; hostId: string; hostLabel: string } | null>(null)
  const [sshPath, setSshPath] = useState('')
  const [sshPathText, setSshPathText] = useState('')
  const [sshEditingPath, setSshEditingPath] = useState(false)
  const [sshEntries, setSshEntries] = useState<DirEntry[] | null>(null)
  const [sshLoading, setSshLoading] = useState(false)
  const launchedRef = useRef(false)
  const sshConnRef = useRef(sshConn)
  sshConnRef.current = sshConn

  useEffect(() => () => {
    if (!launchedRef.current && sshConnRef.current) {
      window.api.ssh.disconnect(sshConnRef.current.id).catch(() => {})
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.file.getDrives().then((d: string[]) => {
      if (cancelled) return
      setDrives(d)
      // 全新环境默认 C:\：跳到第一个非系统盘
      if (/^C:[\\/]*$/i.test(initialDir)) {
        const nonC = d.find(x => !/^C:/i.test(x))
        if (nonC) setCwd(nonC)
      }
    })
    return () => { cancelled = true }
  }, [initialDir])

  const loadDir = useCallback((dir: string) => {
    let cancelled = false
    setEntries(null)
    setError(null)
    window.api.file.list(dir).then((res: any) => {
      if (cancelled) return
      if (res?.error) { setError(res.error); setEntries([]); return }
      const dirs = ((res as DirEntry[]) || [])
        .filter(e => e.type === 'directory')
        .sort((a, b) => a.name.localeCompare(b.name))
      setEntries(dirs)
    }).catch((e: any) => {
      if (!cancelled) { setError(e?.message ?? String(e)); setEntries([]) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => loadDir(cwd), [cwd, loadDir])

  const isRoot = /^[A-Za-z]:[\\/]*$/.test(cwd) || /^[\\/]{1,2}$/.test(cwd) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]*$/.test(cwd)
  const parent = (() => {
    const trimmed = cwd.replace(/[\\/]+$/, '')
    const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
    return idx < 0 ? cwd : trimmed.slice(0, idx + 1)
  })()

  const crumbs: { label: string; path: string }[] = []
  let accPath = ''
  for (const p of cwd.split(/[\\/]/).filter(Boolean)) {
    accPath = accPath === '' ? p + '\\' : accPath + '\\' + p
    crumbs.push({ label: p, path: accPath })
  }

  // 盘符/列表导航时同步路径文本，并取消未完成的新建
  useEffect(() => { setPathText(cwd); setCreatingFolder(false); setNewFolderError(null) }, [cwd])

  const startEdit = () => { setPathText(cwd); setEditingPath(true) }
  const commitPath = () => {
    const p = pathText.trim()
    setEditingPath(false)
    if (p && p !== cwd) setCwd(p)
  }

  const cancelCreateFolder = () => { setCreatingFolder(false); setNewFolderError(null) }

  useEffect(() => {
    if (!launchMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.dir-picker__launch')) setLaunchMenuOpen(false)
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [launchMenuOpen])

  const handleCreateFolder = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) { cancelCreateFolder(); return }
    const sep = cwd.includes('\\') ? '\\' : '/'
    const newPath = cwd.replace(/[\\/]+$/, '') + sep + trimmed
    const res = await window.api.file.createDir(newPath)
    if (res?.error) { setNewFolderError(res.error); return }
    cancelCreateFolder()
    loadDir(cwd)
  }

  const modes: { key: SessionMode; label: string; icon: React.ReactNode }[] = [
    { key: 'term', label: t('Terminal'), icon: <ToolIcon category="command" /> },
    { key: 'gui', label: 'Claude', icon: <ClaudeLogoIcon size={14} /> },
    { key: 'pi', label: 'Pi', icon: <PiLogoIcon size={14} /> },
  ]

  const currentMode = modes.find(m => m.key === selectedMode) ?? modes[0]

  const refreshHosts = useCallback(async () => {
    try {
      setHosts(await window.api.ssh.hosts())
    } catch (err: any) {
      setSshError(err?.message ?? String(err))
    }
  }, [])

  useEffect(() => { refreshHosts() }, [refreshHosts])

  const loadSshDir = useCallback(async (connectionId: string, path: string) => {
    setSshLoading(true)
    setSshError(null)
    try {
      const list = await window.api.ssh.listDir(connectionId, path)
      setSshEntries((list || [])
        .filter(e => e.type === 'directory')
        .sort((a, b) => a.name.localeCompare(b.name)))
    } catch (err: any) {
      setSshError(err?.message ?? String(err))
      setSshEntries([])
    } finally {
      setSshLoading(false)
    }
  }, [])

  const connectHost = useCallback(async (host: SshHost) => {
    if (sshConn?.hostId === host.id) return
    if (sshConn && sshConn.hostId !== host.id) {
      try { await window.api.ssh.disconnect(sshConn.id) } catch {}
      setSshConn(null)
    }
    setConnectingHostId(host.id)
    setSshError(null)
    setDraft(null)
    try {
      const result = await window.api.ssh.connect({ hostId: host.id })
      if (result.state !== 'connected') {
        setSshError(result.message || t('Connection failed'))
        return
      }
      const home = await window.api.ssh.home(result.connectionId)
      setSshConn({ id: result.connectionId, hostId: host.id, hostLabel: host.label })
      setSshPath(home)
      setSshPathText(home)
      await loadSshDir(result.connectionId, home)
    } catch (err: any) {
      setSshError(err?.message ?? String(err))
    } finally {
      setConnectingHostId(null)
    }
  }, [loadSshDir, sshConn, t])

  const saveAndConnect = async () => {
    if (!draft) return
    const input = draftToInput(draft)
    if (!input.label || !input.host) {
      setSshError(t('Name and host are required'))
      return
    }
    try {
      setSshError(null)
      const saved = await window.api.ssh.saveHost(input)
      await refreshHosts()
      window.dispatchEvent(new CustomEvent('ssh-hosts-changed'))
      await connectHost(saved)
    } catch (err: any) {
      setSshError(err?.message ?? String(err))
    }
  }

  const disconnectHost = async () => {
    if (!sshConn) return
    try { await window.api.ssh.disconnect(sshConn.id) } catch {}
    setSshConn(null)
    setSshPath('')
    setSshPathText('')
    setSshEntries(null)
  }

  const handleCancel = async () => {
    launchedRef.current = true
    if (sshConn) {
      try { await window.api.ssh.disconnect(sshConn.id) } catch {}
    }
    onCancel()
  }

  const handleDeleteHost = async () => {
    if (!deletingHost) return
    try {
      await window.api.ssh.deleteHost(deletingHost.id)
      if (sshConn?.hostId === deletingHost.id) await disconnectHost()
      if (draft?.id === deletingHost.id) setDraft(null)
      await refreshHosts()
      window.dispatchEvent(new CustomEvent('ssh-hosts-changed'))
    } catch (err: any) {
      setSshError(err?.message ?? String(err))
    } finally {
      setDeletingHost(null)
    }
  }

  const gotoRemote = (path: string) => {
    if (!sshConn) return
    const next = path.trim()
    if (!next) return
    setSshEditingPath(false)
    setSshPath(next)
    setSshPathText(next)
    loadSshDir(sshConn.id, next)
  }

  const sshCrumbs: { label: string; path: string }[] = []
  if (sshPath.startsWith('/')) {
    let acc = ''
    for (const p of sshPath.split('/').filter(Boolean)) {
      acc += '/' + p
      sshCrumbs.push({ label: p, path: acc })
    }
  }

  const launchSsh = () => {
    if (!sshConn || !sshPath) return
    launchedRef.current = true
    onConfirm(sshPath, 'term', { connectionId: sshConn.id, hostId: sshConn.hostId, hostLabel: sshConn.hostLabel })
  }

  const fieldCls = 'flex-1 min-w-0 bg-ide-bg border border-ide-border rounded px-2 py-1 text-xs text-ide-text outline-none placeholder:text-ide-text-muted focus:border-ide-accent/60'
  const labelCls = 'text-[10px] text-ide-text-muted uppercase tracking-wider'

  return (
    <ModalOverlay onClose={handleCancel}>
      <div className="dir-picker bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[520px] h-[560px] min-w-[400px] min-h-[320px] resize flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-ide-border shrink-0">
          <span className="text-sm font-medium text-ide-text">{t('New Workspace')}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab('local')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${tab === 'local' ? 'bg-ide-accent/20 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            >
              <Monitor size={13} />
              {t('Local')}
            </button>
            <button
              onClick={() => setTab('ssh')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${tab === 'ssh' ? 'bg-ide-accent/20 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            >
              <Server size={13} />
              SSH
            </button>
          </div>
        </div>

        {tab === 'local' ? (
          <>
            {recentDirs.length > 0 && (
              <div className="px-2 py-1.5 border-b border-ide-border shrink-0 grid grid-cols-2 gap-0.5 overflow-y-auto overflow-x-auto max-h-[120px]">
                {recentDirs.map(d => (
                  <button
                    key={d}
                    onClick={() => setCwd(d)}
                    title={d}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors min-w-0"
                  >
                    <FolderIcon name={d.split(/[\\/]/).filter(Boolean).pop() || ''} className="w-3 h-3 shrink-0 text-ide-text-muted" />
                    <RecentDirPath path={d} />
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-1 min-h-0">
              <div className="w-[104px] shrink-0 border-r border-ide-border overflow-y-auto py-1.5 flex flex-col gap-0.5">
                <div className="px-3 pb-0.5">
                  <span className="text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Disks')}</span>
                </div>
                {(drives || []).map(d => {
                  const active = cwd.toLowerCase().startsWith(d.toLowerCase())
                  return (
                    <button
                      key={d}
                      onClick={() => setCwd(d)}
                      title={d}
                      className={`flex items-center gap-1 px-2 py-1 mx-1.5 rounded text-xs font-mono transition-colors ${active ? 'bg-ide-accent/20 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
                    >
                      <HardDrive size={12} className={`shrink-0 ${active ? 'text-ide-accent' : 'text-ide-text-muted'}`} />
                      <span className="truncate">{d}</span>
                    </button>
                  )
                })}
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-1 px-3 py-2 border-b border-ide-border shrink-0">
                  <div className={`flex-1 min-w-0 flex items-center gap-0.5 pl-2 pr-2 py-1 rounded bg-ide-sidebar border font-mono text-xs ${error ? 'border-ide-danger' : 'border-ide-border'}`}>
                    {editingPath ? (
                      <input
                        autoFocus
                        value={pathText}
                        onChange={e => setPathText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitPath(); else if (e.key === 'Escape') setEditingPath(false) }}
                        onBlur={() => setEditingPath(false)}
                        spellCheck={false}
                        className="flex-1 min-w-0 bg-transparent text-ide-text outline-none placeholder:text-ide-text-muted"
                      />
                    ) : (
                      <div
                        onClick={startEdit}
                        className="flex-1 min-w-0 flex items-center gap-0.5 cursor-text overflow-hidden"
                        title={cwd}
                      >
                        <Breadcrumbs items={crumbs} onNavigate={setCwd} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5 shrink-0">
                  <span className="text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Folder Selection')}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setNewFolderError(null); setCreatingFolder(true) }}
                      title={t('New Folder')}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                    >
                      <FolderPlus size={12} />
                      {t('New Folder')}
                    </button>
                    <button
                      onClick={() => setCwd(parent)}
                      disabled={isRoot}
                      title={t('Parent')}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
                        isRoot ? 'text-ide-text-muted opacity-40 cursor-not-allowed' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
                      }`}
                    >
                      <FolderUp size={12} />
                      {t('Parent')}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto py-0.5">
                  {creatingFolder && (
                    <div className="flex flex-col">
                      <div className="px-3 py-1 flex items-center gap-2 bg-ide-accent/10">
                        <FolderIcon className="w-3.5 h-3.5 text-ide-warning" />
                        <input
                          autoFocus
                          placeholder={t('Folder name')}
                          spellCheck={false}
                          className="flex-1 min-w-0 bg-ide-bg border border-ide-accent rounded px-1 py-px text-xs text-ide-text outline-none placeholder:text-ide-text-muted"
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); handleCreateFolder(e.currentTarget.value) }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelCreateFolder() }
                          }}
                          onBlur={cancelCreateFolder}
                        />
                      </div>
                      {newFolderError && <div className="px-3 py-0.5 text-[11px] text-ide-danger">{newFolderError}</div>}
                    </div>
                  )}
                  {error ? (
                    <div className="px-3 py-4 text-sm text-ide-danger text-center">{error}</div>
                  ) : entries === null ? (
                    <div className="px-3 py-4 text-sm text-ide-text-muted text-center">Loading...</div>
                  ) : entries.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-ide-text-muted text-center">无子目录</div>
                  ) : (
                    entries.map(e => <DirRow key={e.path} entry={e} onOpen={setCwd} />)
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 min-h-0">
            <div className="w-[104px] shrink-0 border-r border-ide-border overflow-y-auto py-1.5 flex flex-col gap-0.5">
              <div className="px-3 pb-0.5">
                <span className="text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Hosts')}</span>
              </div>
              {hosts.map(h => {
                const active = sshConn?.hostId === h.id
                return (
                  <div key={h.id} className="group relative mx-1.5">
                    <button
                      onClick={() => connectHost(h)}
                      disabled={!!connectingHostId}
                      title={`${h.label} (${h.host})`}
                      className={`w-full flex items-center gap-1 pl-2 pr-2 group-hover:pr-8 py-1 rounded text-xs transition-colors ${active ? 'bg-ide-accent/20 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'} disabled:opacity-60`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-ide-accent' : 'bg-ide-text-muted/40'}`} />
                      <span className="truncate">{connectingHostId === h.id ? '…' : h.label}</span>
                    </button>
                    <div className="absolute right-0.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingHost(null); setSshError(null); setDraft(hostToDraft(h)) }}
                        title={t('Edit')}
                        className="flex items-center justify-center w-4 h-4 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingHost(h) }}
                        title={t('Delete')}
                        className="flex items-center justify-center w-4 h-4 rounded text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover transition-colors"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                )
              })}
              <button
                onClick={() => { setDraft(emptyDraft()); setSshError(null) }}
                className="flex items-center gap-1 px-2 py-1 mx-1.5 rounded text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
              >
                <Plus size={12} className="shrink-0" />
                <span className="truncate">{t('Add')}</span>
              </button>
            </div>

            <div className="flex-1 min-w-0 flex flex-col">
              {draft ? (
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className={labelCls}>{t('Name')}</span>
                    <input
                      autoFocus
                      value={draft.label}
                      onChange={e => setDraft({ ...draft, label: e.target.value })}
                      placeholder="my-server"
                      spellCheck={false}
                      className={fieldCls}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={labelCls}>{t('Host')}</span>
                    <input
                      value={draft.host}
                      onChange={e => setDraft({ ...draft, host: e.target.value })}
                      placeholder="host ip or ~/.ssh/config alias"
                      spellCheck={false}
                      className={fieldCls}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={labelCls}>{t('Port')}</span>
                    <input
                      value={draft.port}
                      onChange={e => setDraft({ ...draft, port: e.target.value.replace(/[^0-9]/g, '') })}
                      placeholder="22"
                      className={`${fieldCls} max-w-[90px]`}
                    />
                    <span className={labelCls}>{t('Username')}</span>
                    <input
                      value={draft.username}
                      onChange={e => setDraft({ ...draft, username: e.target.value })}
                      placeholder="root"
                      spellCheck={false}
                      className={fieldCls}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={labelCls}>{t('Authentication')}</span>
                    <select
                      value={draft.authMethod}
                      onChange={e => setDraft({ ...draft, authMethod: e.target.value as HostDraft['authMethod'] })}
                      className={fieldCls}
                    >
                      <option value="password">{t('Password')}</option>
                      <option value="key">{t('Private Key')}</option>
                      <option value="agent">{t('SSH Agent')}</option>
                    </select>
                  </div>
                  {draft.authMethod === 'password' && (
                    <div className="flex items-center gap-2">
                      <span className={labelCls}>{t('Password')}</span>
                      <input
                        type="password"
                        value={draft.password}
                        onChange={e => setDraft({ ...draft, password: e.target.value })}
                        placeholder={t('Leave empty to keep saved password')}
                        className={fieldCls}
                      />
                    </div>
                  )}
                  {draft.authMethod === 'key' && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={labelCls}>{t('Private Key Path')}</span>
                        <input
                          value={draft.privateKeyPath}
                          onChange={e => setDraft({ ...draft, privateKeyPath: e.target.value })}
                          placeholder="C:\\Users\\you\\.ssh\\id_rsa"
                          spellCheck={false}
                          className={fieldCls}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={labelCls}>{t('Passphrase')}</span>
                        <input
                          type="password"
                          value={draft.passphrase}
                          onChange={e => setDraft({ ...draft, passphrase: e.target.value })}
                          placeholder={t('Optional')}
                          className={fieldCls}
                        />
                      </div>
                    </>
                  )}
                  {sshError && <div className="text-[11px] text-ide-danger">{sshError}</div>}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => { setDraft(null); setSshError(null) }}
                      className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                    >
                      {t('Cancel')}
                    </button>
                    <button
                      onClick={saveAndConnect}
                      className="px-3 py-1.5 text-xs rounded bg-ide-accent text-white hover:brightness-110 transition-colors disabled:opacity-40"
                      disabled={!!connectingHostId}
                    >
                      {connectingHostId ? t('Connecting...') : t('Save and Connect')}
                    </button>
                  </div>
                </div>
              ) : sshConn ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-ide-border shrink-0">
                    <Server size={12} className="text-ide-accent shrink-0" />
                    <span className="text-xs text-ide-text truncate">{sshConn.hostLabel}</span>
                    <span className="text-[10px] text-ide-accent">{t('Connected')}</span>
                    <button
                      onClick={disconnectHost}
                      className="ml-auto text-[11px] text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded px-1.5 py-0.5 transition-colors"
                    >
                      {t('Disconnect')}
                    </button>
                  </div>
                  <div className="flex items-center gap-1 px-3 py-2 border-b border-ide-border shrink-0">
                    <div className={`flex-1 min-w-0 flex items-center gap-0.5 pl-2 pr-2 py-1 rounded bg-ide-sidebar border font-mono text-xs ${sshError ? 'border-ide-danger' : 'border-ide-border'}`}>
                      {sshEditingPath ? (
                        <input
                          autoFocus
                          value={sshPathText}
                          onChange={e => setSshPathText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') gotoRemote(sshPathText); else if (e.key === 'Escape') setSshEditingPath(false) }}
                          onBlur={() => setSshEditingPath(false)}
                          spellCheck={false}
                          className="flex-1 min-w-0 bg-transparent text-ide-text outline-none placeholder:text-ide-text-muted"
                        />
                      ) : (
                        <div
                          onClick={() => { setSshPathText(sshPath); setSshEditingPath(true) }}
                          className="flex-1 min-w-0 flex items-center gap-0.5 cursor-text overflow-hidden"
                          title={sshPath}
                        >
                          <Breadcrumbs items={sshCrumbs} root onNavigate={gotoRemote} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5 shrink-0">
                    <span className="text-[10px] text-ide-text-muted uppercase tracking-wider">{t('Remote Directory')}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => gotoRemote(sshParent(sshPath))}
                        disabled={sshPath === '/'}
                        title={t('Parent')}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
                          sshPath === '/' ? 'text-ide-text-muted opacity-40 cursor-not-allowed' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'
                        }`}
                      >
                        <FolderUp size={12} />
                        {t('Parent')}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto py-0.5">
                    {sshError ? (
                      <div className="px-3 py-4 text-sm text-ide-danger text-center">{sshError}</div>
                    ) : sshLoading || sshEntries === null ? (
                      <div className="px-3 py-4 text-sm text-ide-text-muted text-center">Loading...</div>
                    ) : sshEntries.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-ide-text-muted text-center">无子目录</div>
                    ) : (
                      sshEntries.map(e => <DirRow key={e.path} entry={e} onOpen={gotoRemote} />)
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <Server size={22} className="text-ide-text-muted/50" />
                  <span className="text-xs text-ide-text-muted">{t('Select a host or add a new SSH connection')}</span>
                  {sshError && <span className="text-[11px] text-ide-danger">{sshError}</span>}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 px-3 py-2 border-t border-ide-border shrink-0">
          <button onClick={handleCancel} className="px-3 py-1.5 text-sm text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors">
            {t('Cancel')}
          </button>
          {tab === 'local' ? (
            <div className="dir-picker__launch ml-auto relative flex items-stretch gap-1">
              <button
                onClick={() => setLaunchMenuOpen(v => !v)}
                title={t('Session mode')}
                className="flex items-center gap-1.5 px-2 rounded-md border border-ide-border text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors whitespace-nowrap"
              >
                {currentMode.icon}
                <span>{currentMode.label}</span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>
              <button
                onClick={() => {
                  launchedRef.current = true
                  if (sshConn) window.api.ssh.disconnect(sshConn.id).catch(() => {})
                  onConfirm(cwd, selectedMode)
                }}
                className="flex items-center px-3 py-1.5 text-sm rounded-md bg-ide-accent text-white hover:brightness-110 transition-colors whitespace-nowrap"
              >
                <span>{t('Launch')}</span>
              </button>
              {launchMenuOpen && (
                <div
                  className="absolute bottom-full right-0 mb-1 min-w-full bg-ide-bg border border-ide-border rounded shadow-lg py-1 z-50"
                  onClick={(e) => e.stopPropagation()}
                >
                  {modes.map(m => (
                    <button
                      key={m.key}
                      onClick={() => { setSelectedMode(m.key); setLaunchMenuOpen(false) }}
                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors flex items-center gap-2 whitespace-nowrap ${
                        selectedMode === m.key ? 'text-ide-accent bg-ide-accent/10' : 'text-ide-text hover:bg-ide-hover'
                      }`}
                    >
                      {m.icon}
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="ml-auto flex items-stretch gap-1">
              <span className="flex items-center gap-1.5 px-2 text-ide-text-muted whitespace-nowrap">
                <ToolIcon category="command" />
                <span>{t('Terminal')}</span>
              </span>
              <button
                onClick={launchSsh}
                disabled={!sshConn || !sshPath}
                className="flex items-center px-3 py-1.5 text-sm rounded-md bg-ide-accent text-white hover:brightness-110 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>{t('Launch')}</span>
              </button>
            </div>
          )}
        </div>

        {deletingHost && (
          <ModalOverlay onClose={() => setDeletingHost(null)}>
            <div className="bg-ide-bg border border-ide-border rounded-lg shadow-2xl w-[320px] p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
              <span className="text-sm text-ide-text">{t('Delete host?')}</span>
              <span className="text-xs text-ide-text-muted break-all">{deletingHost.label} ({deletingHost.host})</span>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeletingHost(null)}
                  className="px-3 py-1.5 text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover rounded transition-colors"
                >
                  {t('Cancel')}
                </button>
                <button
                  onClick={handleDeleteHost}
                  className="px-3 py-1.5 text-xs rounded bg-ide-danger text-white hover:brightness-110 transition-colors"
                >
                  {t('Delete')}
                </button>
              </div>
            </div>
          </ModalOverlay>
        )}
      </div>
    </ModalOverlay>
  )
}
