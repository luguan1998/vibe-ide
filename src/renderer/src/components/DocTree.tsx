import { getFileInfo, FILE_ICON_PATHS } from './FileIcons'

interface DocTreeNode {
  name: string
  path: string
  comment: string
  isDir: boolean
  children: DocTreeNode[]
}

function parseCommands(md: string): Array<{ command: string; comment: string }> {
  const result: Array<{ command: string; comment: string }> = []
  const normalized = md.replace(/\r\n/g, '\n')
  const startMatch = normalized.match(/^## (?:Commands|命令)\s*$/im)
  if (!startMatch || startMatch.index === undefined) return result
  const rest = normalized.slice(startMatch.index + startMatch[0].length)
  const nextH2 = rest.search(/\n## /)
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2)
  const codeBlockRe = /```[^\n]*\n([\s\S]*?)```/g
  let match
  while ((match = codeBlockRe.exec(section)) !== null) {
    for (const line of match[1].split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const hashIdx = trimmed.indexOf('#')
      if (hashIdx >= 0) {
        result.push({ command: trimmed.slice(0, hashIdx).trim(), comment: trimmed.slice(hashIdx + 1).trim() })
      } else {
        result.push({ command: trimmed, comment: '' })
      }
    }
  }
  return result
}

function parseDocTree(md: string): DocTreeNode[] {
  const root: DocTreeNode[] = []
  const stack: { depth: number; node: DocTreeNode }[] = []
  let rootPrefix = ''
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(/^([\s│]*)[├└]──\s+(\S+)/)
    if (!m) continue

    // Detect root directory from preceding line
    if (rootPrefix === '' && i > 0) {
      const prevLine = lines[i - 1].trim()
      const rootMatch = prevLine.match(/^(\S+?\/)\s*$/)
      if (rootMatch) rootPrefix = rootMatch[1]
    }

    const rawName = m[2]
    const isDir = rawName.endsWith('/')
    const name = rawName.replace(/\/$/, '')
    const comment = (line.match(/#\s*(.+)/) || [])[1] || ''
    const depth = Math.max(0, Math.floor(m[1].length / 4))
    const node: DocTreeNode = { name, path: name, comment, isDir, children: [] }

    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length === 0) {
      node.path = rootPrefix + name
      root.push(node)
    } else {
      const parent = stack[stack.length - 1].node
      node.path = parent.path + '/' + name
      parent.children.push(node)
    }
    stack.push({ depth, node })
  }
  return root
}

async function loadMdContent(basePath: string): Promise<string | null> {
  const normalizedBase = basePath.replace(/\\/g, '/')
  const candidates = ['CLAUDE.md', 'AGENTS.md']
  for (const candidate of candidates) {
    try {
      const mdPath = normalizedBase + '/' + candidate
      const res: any = await window.api.file.read(mdPath)
      if (res.content) return res.content.replace(/\r\n/g, '\n')
    } catch {}
  }
  return null
}

function DocTreeItem({ node, depth, expandedDirs, onToggle, onOpenFile, workspacePath }: {
  node: DocTreeNode
  depth: number
  expandedDirs: Set<string>
  onToggle: (path: string) => void
  onOpenFile: (fullPath: string) => void
  workspacePath: string
}) {
  const isExpanded = expandedDirs.has(node.path)
  const paddingLeft = 12 + depth * 14

  return (
    <>
      <div
        className={`pr-2 py-0.5 text-xs cursor-pointer hover:bg-ide-hover flex items-center gap-0.5 select-none ${!node.isDir ? 'hover:text-ide-accent' : ''}`}
        style={{ paddingLeft }}
        onClick={() => {
          if (node.isDir) { onToggle(node.path); return }
          const normalizedWs = workspacePath.replace(/\\/g, '/')
          onOpenFile(normalizedWs + '/' + node.path)
        }}
      >
        {node.isDir ? (
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-ide-text-muted transition-transform shrink-0 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {node.isDir ? (
          isExpanded ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <path d="M2 10h12l2 4h6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-ide-warning shrink-0">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          )
        ) : (
          (() => {
            const info = getFileInfo(node.name)
            return (
              <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 ${info.color}`}
                dangerouslySetInnerHTML={{ __html: FILE_ICON_PATHS[info.kind] || FILE_ICON_PATHS.default }} />
            )
          })()
        )}
        <span className="text-[11px] truncate text-ide-text">{node.name}</span>
        {node.comment && (
          <span className="text-[10px] text-ide-text-muted/60 truncate ml-2">{node.comment}</span>
        )}
      </div>
      {node.isDir && isExpanded && node.children.map(child => (
        <DocTreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          expandedDirs={expandedDirs}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          workspacePath={workspacePath}
        />
      ))}
    </>
  )
}

export { parseCommands, parseDocTree, loadMdContent, DocTreeItem }
export type { DocTreeNode }
