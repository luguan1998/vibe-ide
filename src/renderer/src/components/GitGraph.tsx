import React, { useMemo } from 'react'
import { GitGraphEntry } from '@shared/types'
import { useI18n } from '../i18n'

const ROW_HEIGHT = 36
const LANE_WIDTH = 20
const CIRCLE_RADIUS = 5
const PADDING_LEFT = 12

const PALETTE = [
  'rgb(var(--ide-accent))',
  'rgb(var(--ide-success))',
  'rgb(var(--ide-warning))',
  'rgb(var(--ide-danger))',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
]

interface RefItem {
  type: 'head' | 'branch' | 'remote' | 'tag'
  display: string
}

function parseRefs(refs: string): RefItem[] {
  if (!refs) return []
  const items: RefItem[] = []
  for (const part of refs.split(', ')) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const headMatch = trimmed.match(/^HEAD\s*->\s*(.+)$/)
    if (headMatch) {
      const branchName = headMatch[1].trim()
      if (branchName) items.push({ type: 'branch', display: branchName })
      continue
    }

    const tagMatch = trimmed.match(/^tag:\s*(.+)$/)
    if (tagMatch) {
      items.push({ type: 'tag', display: tagMatch[1].trim() })
      continue
    }

    if (trimmed.includes('/')) {
      items.push({ type: 'remote', display: trimmed })
      continue
    }

    items.push({ type: 'branch', display: trimmed })
  }
  return items
}

const REF_STYLES: Record<RefItem['type'], string> = {
  head: 'text-ide-accent bg-ide-accent/15',
  branch: 'text-ide-success bg-ide-success/15',
  remote: 'text-[#8b5cf6] bg-[#8b5cf6]/15',
  tag: 'text-ide-warning bg-ide-warning/15',
}

function RefBadge({ item }: { item: RefItem }) {
  return (
    <span className={`inline-flex items-center px-1.5 rounded-sm text-[10px] font-medium leading-tight ${REF_STYLES[item.type]}`}>
      {item.display}
    </span>
  )
}

interface LaneNode {
  id: string
  color: string
}

interface GraphRow {
  entry: GitGraphEntry
  inputLanes: LaneNode[]
  outputLanes: LaneNode[]
  laneIndex: number
  mergeToLane?: number
  foundLane: boolean
}

function buildGraphRows(entries: GitGraphEntry[]): { rows: GraphRow[]; maxLanes: number } {
  const rows: GraphRow[] = []
  let prevOutput: LaneNode[] = []
  let colorIdx = 0
  let maxLanes = 0

  for (const entry of entries) {
    const inputLanes = prevOutput.map(l => ({ ...l }))

    const foundLane = inputLanes.findIndex(l => l.id === entry.hash)
    let laneIndex = foundLane
    if (laneIndex === -1) {
      laneIndex = inputLanes.length
      inputLanes.push({ id: entry.hash, color: PALETTE[colorIdx % PALETTE.length] })
      colorIdx++
    }

    const outputLanes = inputLanes.map(l => ({ ...l }))
    let mergeToLane: number | undefined

    if (entry.parents.length > 0) {
      const firstParent = entry.parents[0]
      const existingIdx = outputLanes.findIndex(
        (l, idx) => l.id === firstParent && idx !== laneIndex
      )

      if (existingIdx !== -1) {
        mergeToLane = existingIdx
        outputLanes.splice(laneIndex, 1)
        if (existingIdx > laneIndex) mergeToLane = existingIdx - 1
      } else {
        outputLanes[laneIndex] = { ...outputLanes[laneIndex], id: firstParent }
      }

      for (let i = 1; i < entry.parents.length; i++) {
        const pid = entry.parents[i]
        if (!outputLanes.some(l => l.id === pid)) {
          outputLanes.push({ id: pid, color: PALETTE[colorIdx % PALETTE.length] })
          colorIdx++
        }
      }
    } else {
      outputLanes.splice(laneIndex, 1)
    }

    maxLanes = Math.max(maxLanes, inputLanes.length, outputLanes.length)

    rows.push({ entry, inputLanes, outputLanes, laneIndex, mergeToLane, foundLane: foundLane !== -1 })
    prevOutput = outputLanes
  }

  return { rows, maxLanes }
}

function laneX(lane: number): number {
  return PADDING_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`
}

interface GitGraphProps {
  entries: GitGraphEntry[]
  hasMore: boolean
  loadingMore: boolean
  expandedHash: string | null
  onCommitClick: (hash: string) => void
  onContextMenu: (e: React.MouseEvent, hash: string, message: string) => void
  onLoadMore: () => void
  renderExpanded: (hash: string) => React.ReactNode
}

export default function GitGraph({
  entries, hasMore, loadingMore, expandedHash,
  onCommitClick, onContextMenu, onLoadMore, renderExpanded
}: GitGraphProps) {
  const { t } = useI18n()

  const { rows } = useMemo(
    () => buildGraphRows(entries),
    [entries]
  )

  if (entries.length === 0) {
    return <div className="px-2 py-2 text-xs text-ide-text-muted text-center">{t('No commits yet')}</div>
  }

  return (
    <div className="flex flex-col">
      {rows.map(row => {
        const midY = ROW_HEIGHT / 2
        const topY = 0
        const botY = ROW_HEIGHT
        const xc = laneX(row.laneIndex)
        const color = row.inputLanes[row.laneIndex]?.color || PALETTE[0]
        const isHead = String(row.entry.refs || '').includes('HEAD ->')
        const isMerge = row.entry.parents.length > 1
        const isExpanded = row.entry.hash === expandedHash
        const r = CIRCLE_RADIUS
        const refItems = parseRefs(row.entry.refs)
        const rowWidth = PADDING_LEFT + Math.max(row.inputLanes.length, row.outputLanes.length) * LANE_WIDTH

        const elements: React.ReactNode[] = []

        // Pass-through lanes (not the commit's lane)
        for (let j = 0; j < row.inputLanes.length; j++) {
          if (j === row.laneIndex) continue
          const xj = laneX(j)
          const node = row.inputLanes[j]
          const outIdx = row.outputLanes.findIndex(l => l.id === node.id)

          if (outIdx === j) {
            elements.push(
              <line key={`pass-${j}`} x1={xj} y1={topY} x2={xj} y2={botY}
                stroke={node.color} strokeWidth={2} strokeLinecap="round"
              />
            )
          } else if (outIdx >= 0) {
            const xo = laneX(outIdx)
            elements.push(
              <path key={`shift-${j}`}
                d={curvePath(xj, topY, xo, botY)}
                fill="none" stroke={node.color} strokeWidth={2} strokeLinecap="round"
              />
            )
          } else {
            elements.push(
              <path key={`end-${j}`}
                d={curvePath(xj, topY, xc, midY)}
                fill="none" stroke={node.color} strokeWidth={2} strokeLinecap="round"
              />
            )
          }
        }

        // Commit's incoming line — only if lane was inherited from a child commit
        if (row.foundLane) {
          elements.push(
            <line key="in" x1={xc} y1={topY} x2={xc} y2={midY - r}
              stroke={color} strokeWidth={2} strokeLinecap="round"
            />
          )
        }

        // Outgoing from commit
        if (row.mergeToLane !== undefined) {
          const xm = laneX(row.mergeToLane)
          elements.push(
            <path key="merge-out"
              d={curvePath(xc, midY + r, xm, botY)}
              fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
            />
          )
        } else if (row.entry.parents.length > 0) {
          const parentLane = row.outputLanes.findIndex(
            l => l.id === row.entry.parents[0]
          )
          if (parentLane === row.laneIndex || parentLane === -1) {
            elements.push(
              <line key="out-straight" x1={xc} y1={midY + r} x2={xc} y2={botY}
                stroke={color} strokeWidth={2} strokeLinecap="round"
              />
            )
          } else {
            const xp = laneX(parentLane)
            elements.push(
              <path key="out-curve"
                d={curvePath(xc, midY + r, xp, botY)}
                fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
              />
            )
          }

          // Extra parents (merge lines)
          for (let pi = 1; pi < row.entry.parents.length; pi++) {
            const pid = row.entry.parents[pi]
            const pl = row.outputLanes.findIndex(l => l.id === pid)
            if (pl >= 0 && pl !== row.laneIndex) {
              const xp = laneX(pl)
              elements.push(
                <path key={`merge-${pi}`}
                  d={curvePath(xc, midY + r, xp, botY)}
                  fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
                />
              )
            }
          }
        }

        // New lanes from this commit (output lanes without input counterpart)
        for (let j = row.inputLanes.length; j < row.outputLanes.length; j++) {
          const xj = laneX(j)
          const node = row.outputLanes[j]
          elements.push(
            <path key={`new-${j}`}
              d={curvePath(xc, midY + r, xj, botY)}
              fill="none" stroke={node.color} strokeWidth={2} strokeLinecap="round"
            />
          )
        }

        // Commit circle
        const circleFill = isExpanded ? 'rgb(var(--ide-accent))' : color
        if (isHead) {
          elements.push(
            <circle key="head-outer" cx={xc} cy={midY} r={r + 2.5}
              fill="none" stroke={circleFill} strokeWidth={1.5}
            />,
            <circle key="head-inner" cx={xc} cy={midY} r={r}
              fill={circleFill}
            />
          )
        } else if (isMerge) {
          elements.push(
            <circle key="merge-outer" cx={xc} cy={midY} r={r + 1.5}
              fill="none" stroke={circleFill} strokeWidth={1.5}
            />,
            <circle key="merge-inner" cx={xc} cy={midY} r={r - 1.5}
              fill={circleFill}
            />
          )
        } else {
          elements.push(
            <circle key="circle" cx={xc} cy={midY} r={r} fill={circleFill} />
          )
        }

        return (
          <React.Fragment key={row.entry.hash}>
            <div
              className={`flex items-center cursor-pointer hover:bg-ide-hover border-b border-ide-border/50 ${
                isExpanded ? 'bg-ide-accent/10' : ''
              }`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onCommitClick(row.entry.hash)}
              onContextMenu={(e) => {
                e.preventDefault()
                onContextMenu(e, row.entry.hash, row.entry.message)
              }}
            >
              <svg
                width={rowWidth}
                height={ROW_HEIGHT}
                style={{ display: 'block', flexShrink: 0 }}
              >
                {elements}
              </svg>

              <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden pr-2">
                <div className="text-xs text-ide-text truncate leading-tight">{row.entry.message}</div>
                <div className="flex items-center gap-1 text-[11px] text-ide-text-muted leading-tight mt-px">
                  <span className="text-ide-accent shrink-0">{row.entry.hash.slice(0, 7)}</span>
                  <span className="truncate">{row.entry.author}</span>
                  <span className="shrink-0">{new Date(row.entry.date).toLocaleDateString()}</span>
                </div>
              </div>

              {refItems.length > 0 && (
                <div className="flex items-center gap-px flex-shrink-0 ml-1.5">
                  {refItems.map((item, idx) => (
                    <RefBadge key={idx} item={item} />
                  ))}
                </div>
              )}
            </div>

            {isExpanded && renderExpanded(row.entry.hash)}
          </React.Fragment>
        )
      })}
      {hasMore && (
        <div
          className="pl-5 pr-2 py-1.5 text-xs text-center text-ide-text-muted bg-ide-hover/30 cursor-pointer hover:bg-ide-hover hover:text-ide-accent"
          onClick={onLoadMore}
        >
          {loadingMore ? t('Loading...') : t('Load more commits')}
        </div>
      )}
    </div>
  )
}
