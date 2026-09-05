import { useCallback, useEffect, useState } from 'react'
import { Sparkles, Plus, RotateCcw, FolderOpen, Pencil, Trash2, ArrowLeft, X, Check, Folder } from 'lucide-react'
import { useI18n } from '../i18n'

interface SkillItem {
  name: string
  description: string
  dir: string
  filePath: string
  rootDir: string
}

interface SkillRoot {
  dir: string
  source: 'project' | 'global'
  label: string
}

interface SkillViewProps {
  workspacePath: string | null
  onOpenFile: (fullPath: string) => void
  onPreviewFile?: (fullPath: string) => void
  onBack: () => void
}

function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/[\/]+$/, '')
}

function parseSkillMd(raw: string, fallbackName: string): { name: string; description: string } {
  let name = fallbackName
  let description = ''
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/)
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
      if (!kv) continue
      const key = kv[1].toLowerCase()
      const val = kv[2].trim().replace(/^["'](.*)["']$/, '$1')
      if (key === 'name' && val) name = val
      else if (key === 'description' && val) description = val
    }
  }
  if (!description) {
    const body = m ? raw.slice(m[0].length) : raw
    const first = body.split(/\r?\n/).find(l => l.trim() && !l.trim().startsWith('#'))
    description = (first || '').trim().slice(0, 200)
  }
  return { name, description }
}

function skillTemplate(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description || name}\n---\n\n# ${name}\n\nTODO: describe the workflow.\n`
}

function isValidSkillName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
}

export default function SkillView({ workspacePath, onOpenFile, onPreviewFile, onBack }: SkillViewProps) {
  const { t } = useI18n()
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [roots, setRoots] = useState<SkillRoot[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [rootChoice, setRootChoice] = useState<string>('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillItem | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const [rawHome, rawCfgDir] = await Promise.all([window.api.appHome(), window.api.claudeConfig.dir()])
    const home = norm(rawHome)
    const cfgDir = norm(rawCfgDir)
    const nextRoots: SkillRoot[] = []
    if (workspacePath) {
      const ws = norm(workspacePath)
      nextRoots.push({ dir: ws + '/.claude/skills', source: 'project', label: './.claude' })
      nextRoots.push({ dir: ws + '/.agents/skills', source: 'project', label: './.agents' })
      nextRoots.push({ dir: ws + '/.dsh/skills', source: 'project', label: './.dsh' })
    }
    nextRoots.push({ dir: cfgDir + '/skills', source: 'global', label: '~/.claude' })
    nextRoots.push({ dir: home + '/.agents/skills', source: 'global', label: '~/.agents' })
    nextRoots.push({ dir: home + '/.dsh/skills', source: 'global', label: '~/.dsh' })
    const items: SkillItem[] = []
    for (const root of nextRoots) {
      const r: any = await window.api.file.list(root.dir)
      if (!Array.isArray(r)) continue
      for (const e of r) {
        if (e.type !== 'directory') continue
        const dirPath = norm(root.dir) + '/' + e.name
        const filePath = dirPath + '/SKILL.md'
        const rd: any = await window.api.file.read(filePath)
        if (rd && typeof rd.content === 'string') {
          const parsed = parseSkillMd(rd.content, e.name)
          items.push({ name: parsed.name, description: parsed.description, dir: dirPath, filePath, rootDir: norm(root.dir) })
        } else {
          items.push({ name: e.name, description: '', dir: dirPath, filePath, rootDir: norm(root.dir) })
        }
      }
    }
    items.sort((a, b) => a.name.localeCompare(b.name))
    setSkills(items)
    setRoots(nextRoots)
    setRootChoice(prev => {
      if (prev && nextRoots.some(r => r.dir === prev)) return prev
      return nextRoots.find(r => r.source === 'project')?.dir ?? nextRoots[0]?.dir ?? ''
    })
    setLoading(false)
  }, [workspacePath])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!deleteTarget) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setDeleteTarget(null)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [deleteTarget])

  const openExplorer = (path: string) => {
    window.api.file.openExplorer(path)
  }

  const createSkill = useCallback(async () => {
    const name = newName.trim()
    if (!name || busy) return
    if (!isValidSkillName(name)) {
      setFormError(t('Invalid skill name'))
      return
    }
    const root = roots.find(r => r.dir === rootChoice) ?? roots[0]
    if (!root) {
      setFormError(t('No skills folder'))
      return
    }
    const exists = skills.some(s => s.dir.toLowerCase() === (root.dir + '/' + name).toLowerCase())
    if (exists) {
      setFormError(t('Skill already exists'))
      return
    }
    setBusy(true)
    setFormError(null)
    const res: any = await window.api.file.write(root.dir + '/' + name + '/SKILL.md', skillTemplate(name, newDesc.trim()))
    setBusy(false)
    if (res && res.error) {
      setFormError(res.error)
      return
    }
    setShowForm(false)
    setNewName('')
    setNewDesc('')
    await load()
  }, [newName, newDesc, busy, roots, rootChoice, skills, load, t])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || busy) return
    setBusy(true)
    await window.api.file.delete(deleteTarget.dir)
    setBusy(false)
    setDeleteTarget(null)
    await load()
  }, [deleteTarget, busy, load])

  const segOf = (dir: string): string => /\/\.[^\/]+\/skills$/.exec(dir)?.[0] ?? ''

  const rootLabel = (root: SkillRoot): string => t(root.source === 'project' ? 'Project' : 'Global') + ' ' + root.label

  const groupHeader = (root: SkillRoot) => {
    const dir = norm(root.dir)
    const seg = segOf(dir)
    const collapsed = collapsedDirs.has(dir)
    const toggleCollapsed = () => {
      const next = new Set(collapsedDirs)
      if (collapsed) next.delete(dir)
      else next.add(dir)
      setCollapsedDirs(next)
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
        <span className="text-[11px] font-bold uppercase tracking-wider text-ide-text-muted shrink-0">{t(root.source === 'project' ? 'Project' : 'Global')}</span>
        {seg && <span className="text-[11px] font-mono text-ide-text-muted/70 shrink-0">{seg}</span>}
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

  const row = (item: SkillItem) => (
    <div
      key={item.dir}
      onClick={() => (onPreviewFile ?? onOpenFile)(item.filePath)}
      className="group relative flex items-center gap-2 px-3 py-2 mx-1 rounded-lg hover:bg-ide-hover cursor-pointer min-w-0"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ide-text truncate">{item.name}</div>
        {item.description && <div className="text-[11px] text-ide-text-muted truncate">{item.description}</div>}
      </div>
      <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1 bg-ide-hover rounded-r-lg hidden group-hover:flex">
        <button
          onClick={(e) => { e.stopPropagation(); openExplorer(item.dir) }}
          className="w-6 h-6 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-accent/20 flex items-center justify-center transition-colors"
          title={t('Open in Explorer')}
        >
          <FolderOpen size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenFile(item.filePath) }}
          className="w-6 h-6 rounded text-ide-text-muted hover:text-ide-text hover:bg-ide-accent/20 flex items-center justify-center transition-colors"
          title={t('Edit skill')}
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setDeleteTarget(item) }}
          className="w-6 h-6 rounded text-ide-text-muted hover:text-ide-danger hover:bg-ide-hover flex items-center justify-center transition-colors"
          title={t('Delete')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )

  const empty = skills.length === 0
  const groups = roots
    .map(root => ({ root, items: skills.filter(s => s.rootDir === norm(root.dir)) }))
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
          <Sparkles size={13} className="text-ide-accent shrink-0" />
          <span className="text-xs font-medium text-ide-text">{t('Skills')}</span>
          {skills.length > 0 && <span className="text-[10px] text-ide-text-muted">({skills.length})</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => { setShowForm(v => !v); setFormError(null) }}
            className={`h-5 px-2 rounded flex items-center gap-1 text-[11px] transition-colors ${showForm ? 'bg-ide-accent/15 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text hover:bg-ide-hover'}`}
            title={t('New Skill')}
          >
            <Plus size={11} />
            <span>{t('New Skill')}</span>
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

      {showForm && (
        <div className="border-b border-ide-border px-3 py-2 shrink-0 space-y-1.5 bg-ide-sidebar/50">
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={newName}
              onChange={e => { setNewName(e.target.value); setFormError(null) }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void createSkill() }
                if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setShowForm(false) }
              }}
              placeholder={t('Skill name')}
              className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-ide-panel border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
            />
            <select
              value={rootChoice || roots[0]?.dir || ''}
              onChange={e => setRootChoice(e.target.value)}
              disabled={roots.length === 0}
              title={t('Skills folder')}
              className="min-w-0 max-w-[200px] px-1.5 py-1 text-xs text-ide-text bg-ide-panel border border-ide-border rounded focus:outline-none focus:border-ide-accent disabled:opacity-40"
            >
              {roots.map(r => (
                <option key={r.dir} value={r.dir}>{rootLabel(r)}</option>
              ))}
            </select>
          </div>
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void createSkill() }
              if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setShowForm(false) }
            }}
            placeholder={t('Skill description (optional)')}
            className="w-full px-2 py-1.5 text-sm bg-ide-panel border border-ide-border rounded text-ide-text placeholder:text-ide-text-muted/50 focus:outline-none focus:border-ide-accent/60"
          />
          {formError && <div className="text-[11px] text-ide-danger">{formError}</div>}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); setFormError(null) }}
              className="px-2.5 py-1 rounded text-xs text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors flex items-center gap-1"
            >
              <X size={12} />
              {t('Cancel')}
            </button>
            <button
              onClick={() => void createSkill()}
              disabled={!newName.trim() || busy}
              className="px-2.5 py-1 rounded text-xs text-ide-accent border border-ide-accent/50 hover:bg-ide-accent/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Check size={12} />
              {t('Create')}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {empty && !loading && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <Sparkles size={28} className="text-ide-text-muted/30" />
            <div className="text-sm text-ide-text-muted">{t('No skills yet')}</div>
            <div className="text-xs text-ide-text-muted/60 leading-relaxed">
              {t('Skills hint')}
            </div>
            {roots.map(r => (
              <div key={r.dir} className="text-[11px] font-mono text-ide-text-muted/50 break-all">{r.dir}</div>
            ))}
          </div>
        )}
        {groups.map(g => (
          <div key={g.root.dir}>
            {groupHeader(g.root)}
            {!collapsedDirs.has(norm(g.root.dir)) && g.items.map(row)}
          </div>
        ))}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteTarget(null)}>
          <div className="w-[360px] bg-ide-panel border border-ide-border rounded-xl shadow-2xl p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <Trash2 size={16} className="text-ide-danger shrink-0" />
              <span className="text-sm font-medium text-ide-text truncate">{t('Delete skill')}</span>
            </div>
            <div className="text-sm text-ide-text-muted mb-1">{t('Delete skill confirm')}</div>
            <div className="text-xs font-mono text-ide-text-muted/70 break-all mb-3">{deleteTarget.dir}</div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1 rounded text-sm text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={() => void confirmDelete()}
                disabled={busy}
                className="px-3 py-1 rounded text-sm text-white bg-ide-danger hover:bg-ide-danger/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
