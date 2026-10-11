import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Brain, FileText, RotateCcw, FolderOpen, Pencil, ArrowLeft, Folder } from 'lucide-react'
import { useI18n } from '../i18n'

interface MemoryItem {
  file: string
  filePath: string
  name: string
  description: string
  type: string
}

interface MemoryViewProps {
  workspacePath: string | null
  onOpenFile: (fullPath: string) => void
  onPreviewFile?: (fullPath: string) => void
  onBack: () => void
  tabs?: ReactNode
}

const TYPE_ORDER = ['user', 'feedback', 'project', 'reference']

function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/[\/]+$/, '')
}

function parseMemoryMd(raw: string, fallbackName: string): { name: string; description: string; type: string } {
  let name = fallbackName
  let description = ''
  let type = ''
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
      if (!kv) continue
      const key = kv[1].toLowerCase()
      const val = kv[2].trim().replace(/^["'](.*)["']$/, '$1')
      if (key === 'name' && val) name = val
      else if (key === 'description' && val) description = val
      else if (key === 'type' && val) type = val
    }
  }
  if (!description) {
    const body = m ? raw.slice(m[0].length) : raw
    const first = body.split(/\r?\n/).find(l => l.trim() && !l.trim().startsWith('#'))
    description = (first || '').trim().slice(0, 200)
  }
  return { name, description, type }
}

export default function MemoryView({ workspacePath, onOpenFile, onPreviewFile, onBack, tabs }: MemoryViewProps) {
  const { t } = useI18n()
  const [items, setItems] = useState<MemoryItem[]>([])
  const [dir, setDir] = useState('')
  const [indexPath, setIndexPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const ws = workspacePath ? norm(workspacePath) : ''
    const projectDir = ws ? await window.api.ai.resolveProjectDir(ws) : null
    const memoryDir = projectDir ? norm(projectDir) + '/memory' : ''
    setDir(memoryDir)
    setIndexPath(memoryDir ? memoryDir + '/MEMORY.md' : '')
    if (!memoryDir) {
      setItems([])
      setLoading(false)
      return
    }
    const r: any = await window.api.file.list(memoryDir)
    const items: MemoryItem[] = []
    if (Array.isArray(r)) {
      for (const e of r) {
        if (e.type !== 'file' || !e.name.endsWith('.md') || e.name === 'MEMORY.md') continue
        const filePath = memoryDir + '/' + e.name
        const rd: any = await window.api.file.read(filePath)
        const parsed = rd && typeof rd.content === 'string'
          ? parseMemoryMd(rd.content, e.name.slice(0, -3))
          : { name: e.name.slice(0, -3), description: '', type: '' }
        items.push({ file: e.name, filePath, ...parsed })
      }
    }
    items.sort((a, b) => a.name.localeCompare(b.name))
    setItems(items)
    setLoading(false)
  }, [workspacePath])

  useEffect(() => { void load() }, [load])

  const openExplorer = (path: string) => {
    window.api.file.openExplorer(path)
  }

  const groupHeader = (type: string, count: number) => {
    const collapsed = collapsedTypes.has(type)
    const toggleCollapsed = () => {
      const next = new Set(collapsedTypes)
      if (collapsed) next.delete(type)
      else next.add(type)
      setCollapsedTypes(next)
    }
    return (
      <div className="px-3 pt-3 pb-1 flex items-center gap-2 shrink-0">
        <button
          onClick={toggleCollapsed}
          title={collapsed ? t('Expand') : t('Collapse')}
          className="w-4 h-4 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 transition-transform shrink-0 ${collapsed ? '-rotate-90' : 'rotate-0'}`}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        <span className="text-xs font-bold uppercase tracking-wider text-ide-text shrink-0">{type ? t(type) : t('Other')}</span>
        <span className="text-xs text-ide-text-muted shrink-0">{count}</span>
        <button
          onClick={() => openExplorer(dir)}
          title={dir}
          className="min-w-0 flex items-center gap-1 text-[11px] text-ide-text-muted/60 hover:text-ide-accent transition-colors ml-auto"
        >
          <Folder size={12} className="shrink-0" />
        </button>
      </div>
    )
  }

  const row = (item: MemoryItem) => (
    <div
      key={item.file}
      onClick={() => (onPreviewFile ?? onOpenFile)(item.filePath)}
      className="group relative flex items-center gap-2 px-3 py-2 mx-1 rounded-lg hover:bg-ide-hover cursor-pointer min-w-0"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ide-text truncate">{item.name}</div>
        {item.description && <div className="text-[11px] text-ide-text-muted truncate">{item.description}</div>}
      </div>
      <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1 bg-ide-hover rounded-r-lg hidden group-hover:flex">
        <button
          onClick={(e) => { e.stopPropagation(); openExplorer(item.filePath) }}
          className="w-6 h-6 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-accent/20 flex items-center justify-center transition-colors"
          title={t('Open in Explorer')}
        >
          <FolderOpen size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenFile(item.filePath) }}
          className="w-6 h-6 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-accent/20 flex items-center justify-center transition-colors"
          title={t('Edit memory')}
        >
          <Pencil size={14} />
        </button>
      </div>
    </div>
  )

  const extraTypes = items.map(i => i.type).filter(ty => !TYPE_ORDER.includes(ty))
  const groups = [...TYPE_ORDER, ...Array.from(new Set(extraTypes))]
    .map(type => ({ type, items: items.filter(i => i.type === type) }))
    .filter(g => g.items.length > 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 outline-none focus:outline-none">
      <div className="h-9 px-3 flex items-center justify-between border-b border-ide-border shrink-0 acrylic-titlebar-clean">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={onBack}
            className="w-5 h-5 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors"
            title={t('Back')}
          >
            <ArrowLeft size={13} />
          </button>
          {tabs ?? (
            <>
              <Brain size={13} className="text-ide-accent shrink-0" />
              <span className="text-xs font-medium text-ide-text">{t('Memory')}</span>
            </>
          )}
          {items.length > 0 && <span className="text-[10px] text-ide-text-muted">({items.length})</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => openExplorer(dir)}
            disabled={!dir}
            className="w-5 h-5 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('Memory folder')}
          >
            <FolderOpen size={13} />
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="w-5 h-5 rounded text-ide-text-muted hover:bg-ide-hover hover:text-ide-text flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('Refresh')}
          >
            <RotateCcw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <Brain size={28} className="text-ide-text-muted/30" />
            <div className="text-sm text-ide-text-muted">{t('No memory yet')}</div>
            <div className="text-xs text-ide-text-muted/60 leading-relaxed">{t('Memory hint')}</div>
            {dir && <div className="text-[11px] font-mono text-ide-text-muted/50 break-all">{dir}</div>}
          </div>
        )}
        {items.length > 0 && indexPath && (
          <div
            onClick={() => (onPreviewFile ?? onOpenFile)(indexPath)}
            className="group relative flex items-center gap-2 px-3 py-2 mx-1 mt-2 rounded-lg hover:bg-ide-hover cursor-pointer min-w-0"
          >
            <FileText size={13} className="text-ide-text-muted shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ide-text truncate">MEMORY.md</div>
              <div className="text-[11px] text-ide-text-muted truncate">{t('Index of all memories')}</div>
            </div>
          </div>
        )}
        {groups.map(g => (
          <div key={g.type}>
            {groupHeader(g.type, g.items.length)}
            {!collapsedTypes.has(g.type) && g.items.map(row)}
          </div>
        ))}
      </div>
    </div>
  )
}
