import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file/browser'
import type { TabSnapshot, TabRuntime } from '../fileTabs'

interface SheetPreviewProps {
  fullPath: string
  fileName: string
  onDismiss?: () => void
  onToggleEdit?: () => void
  onStats?: (rows: number, cols: number) => void
  tabId?: string
  getSnapshot?: () => TabSnapshot | null
  onPushSnapshot?: (s: TabSnapshot) => void
  onRuntimeChange?: (rt: TabRuntime | null) => void
  headerLeading?: ReactNode
}

const MAX_ROWS = 1000
const MAX_COLS = 40

interface PreviewSheet {
  name: string
  rows: string[][]
  total: number | null
  truncated: boolean
  colTruncated: boolean
  colCount: number
}

interface CellEdit {
  r: number
  c: number
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const iso = v.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ')
  }
  return String(v)
}

function columnName(index: number): string {
  let name = ''
  let n = index
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

function buildSheet(name: string, raw: unknown[][], total: number | null, slice: boolean): PreviewSheet {
  const colTruncated = raw.some(r => r.length > MAX_COLS)
  const colCount = Math.min(MAX_COLS, raw.reduce((m, r) => Math.max(m, r.length), 0))
  const source = slice ? raw.slice(0, MAX_ROWS) : raw
  const rows = source.map(r => (slice ? r.slice(0, MAX_COLS) : r).map(formatCell))
  return {
    name,
    rows,
    total,
    truncated: total !== null ? total > MAX_ROWS : raw.length > MAX_ROWS,
    colTruncated,
    colCount
  }
}

const SheetPreview = React.memo(function SheetPreview({
  fullPath,
  fileName,
  onDismiss,
  onToggleEdit,
  onStats,
  tabId,
  getSnapshot,
  onPushSnapshot,
  onRuntimeChange,
  headerLeading
}: SheetPreviewProps) {
  const [sheets, setSheets] = useState<PreviewSheet[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [editing, setEditing] = useState<CellEdit | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dirtyRef = useRef(false)
  const editingRef = useRef<CellEdit | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const sheetsRef = useRef(sheets)
  const encodingRef = useRef('utf-8')
  const bomRef = useRef(false)
  const csvMetaRef = useRef({ delimiter: ',', newline: '\n', trailingNewline: false })

  const isCsv = /\.(csv|tsv)$/i.test(fileName)
  editingRef.current = editing
  dirtyRef.current = dirty
  sheetsRef.current = sheets

  const onStatsRef = useRef(onStats)
  const onPushSnapshotRef = useRef(onPushSnapshot)
  const onRuntimeChangeRef = useRef(onRuntimeChange)
  const getSnapshotRef = useRef(getSnapshot)
  onStatsRef.current = onStats
  onPushSnapshotRef.current = onPushSnapshot
  onRuntimeChangeRef.current = onRuntimeChange
  getSnapshotRef.current = getSnapshot

  const serializeRows = useCallback((rows: string[][]) => {
    const { delimiter, newline, trailingNewline } = csvMetaRef.current
    const text = Papa.unparse(rows, { delimiter, newline })
    return trailingNewline ? text + newline : text
  }, [])

  const handleSave = useCallback(async () => {
    if (!isCsv || !dirtyRef.current) return true
    const cur = sheetsRef.current[0]
    if (!cur) return true
    const res = await window.api.file.writeWithEncoding(
      fullPath,
      serializeRows(cur.rows),
      encodingRef.current,
      bomRef.current
    )
    if (!res?.success) return false
    dirtyRef.current = false
    setDirty(false)
    return true
  }, [isCsv, fullPath, serializeRows])

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  const commitEdit = useCallback(() => {
    const ed = editingRef.current
    if (!ed) return
    const value = inputRef.current?.value ?? ''
    editingRef.current = null
    setEditing(null)
    const cur = sheetsRef.current[0]
    if (!cur) return
    const old = cur.rows[ed.r]?.[ed.c] ?? ''
    if (old === value) return
    const rows = cur.rows.map(r => r.slice())
    const row = rows[ed.r] ?? (rows[ed.r] = [])
    while (row.length < ed.c) row.push('')
    row[ed.c] = value
    const next = [{ ...cur, rows }]
    sheetsRef.current = next
    setSheets(next)
    dirtyRef.current = true
    setDirty(true)
  }, [])

  const startEdit = useCallback((r: number, c: number) => {
    if (!isCsv) return
    const cur = editingRef.current
    if (cur && cur.r === r && cur.c === c) return
    const next = { r, c }
    editingRef.current = next
    setEditing(next)
  }, [isCsv])

  useEffect(() => {
    if (!onDismiss) return
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'escape') return
      if (!containerRef.current?.offsetParent) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (editingRef.current) {
        editingRef.current = null
        setEditing(null)
        return
      }
      onDismiss()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onDismiss])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSheets([])
    setActive(0)
    setDirty(false)
    dirtyRef.current = false
    setEditing(null)
    editingRef.current = null

    const load = async () => {
      try {
        if (isCsv) {
          const res = await window.api.file.readWithEncoding(fullPath)
          if (res.error) throw new Error(res.error)
          encodingRef.current = res.encoding || 'utf-8'
          bomRef.current = !!res.bom
          const snap = getSnapshotRef.current?.()
          const restored = !!snap?.dirty && snap.buffer !== undefined
          const content = restored ? snap!.buffer! : res.content
          const parsed = Papa.parse<string[]>(content, {
            delimiter: '',
            skipEmptyLines: 'greedy'
          })
          if (parsed.errors.length && parsed.data.length === 0) {
            throw new Error(parsed.errors[0].message)
          }
          csvMetaRef.current = {
            delimiter: parsed.meta.delimiter || ',',
            newline: parsed.meta.linebreak || '\n',
            trailingNewline: /(?:\r\n|\n|\r)$/.test(content)
          }
          const built = buildSheet(fileName, parsed.data, null, false)
          if (!cancelled) {
            setSheets([built])
            dirtyRef.current = restored
            setDirty(restored)
          }
        } else {
          const res = await window.api.file.readBinary(fullPath)
          if (res.error || !res.data) throw new Error(res.error || 'Failed to read file')
          const workbook = await readXlsxFile(res.data)
          const parsed = workbook.map(s => buildSheet(s.sheet, s.data, s.data.length, true))
          if (!parsed.length) throw new Error('No sheets found')
          if (!cancelled) setSheets(parsed)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [fullPath, fileName, isCsv])

  useEffect(() => {
    if (!isCsv) return
    onRuntimeChangeRef.current?.({ dirty, save: () => { void handleSaveRef.current() } })
    return () => onRuntimeChangeRef.current?.(null)
  }, [dirty, isCsv])

  useEffect(() => {
    if (!tabId || !isCsv) return
    const cur = sheets[0]
    if (!cur) return
    onPushSnapshotRef.current?.({ buffer: dirty ? serializeRows(cur.rows) : undefined, dirty })
  }, [dirty, sheets, tabId, isCsv, serializeRows])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 's') return
      if (editingRef.current) return
      if (!containerRef.current?.offsetParent) return
      e.preventDefault()
      handleSaveRef.current()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const sheet = sheets[active]
  const header = sheet?.rows[0] ?? []
  const body = sheet ? sheet.rows.slice(1, MAX_ROWS + 1) : []
  const colCount = sheet?.colCount ?? 0
  const rowTotal = sheet ? sheet.rows.length : 0
  const footer = sheet
    ? [
        sheet.total !== null && sheet.truncated ? `${sheet.rows.length} / ${sheet.total} rows` : null,
        sheet.total === null && sheet.truncated ? `First ${MAX_ROWS} rows` : null,
        sheet.colTruncated ? `First ${MAX_COLS} columns` : null
      ].filter(Boolean).join(' · ')
    : ''

  useEffect(() => {
    if (sheets.length === 0) return
    onStatsRef.current?.(Math.max(0, rowTotal - 1), colCount)
  }, [sheets.length, rowTotal, colCount])

  const setInputNode = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
    if (el) el.focus({ preventScroll: true })
  }, [])

  const renderEditor = (r: number, c: number, value: string, bold = false) => {
    if (!editing || editing.r !== r || editing.c !== c) return null
    return (
      <>
        <span className="invisible px-2 py-1 whitespace-pre">{value || ' '}</span>
        <input
          ref={setInputNode}
          defaultValue={value}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitEdit()
            }
          }}
          className={`absolute inset-0 w-full border-0 bg-transparent px-2 outline-none font-mono text-xs text-ide-text${bold ? ' font-semibold' : ''}`}
          spellCheck={false}
        />
      </>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full animate-fade-in">
      <div className="h-8 px-3 flex items-center justify-between gap-2 bg-ide-sidebar border-b border-ide-border shrink-0">
        {headerLeading}
        <div className="flex items-center gap-2 shrink-0">
          {isCsv && dirty && <span className="text-[10px] text-ide-warning font-medium">● 未保存</span>}
          {sheets.length > 1 && (
            <select
              value={active}
              onChange={e => setActive(Number(e.target.value))}
              className="h-6 max-w-[180px] bg-ide-bg border border-ide-border rounded px-1.5 text-xs text-ide-text outline-none focus:border-ide-accent"
            >
              {sheets.map((s, i) => (
                <option key={`${s.name}-${i}`} value={i}>{s.name}</option>
              ))}
            </select>
          )}
          {onToggleEdit && (
            <button
              onClick={async () => {
                if (await handleSaveRef.current()) onToggleEdit()
              }}
              className="w-6 h-6 rounded flex items-center justify-center text-ide-text-muted hover:text-ide-text hover:bg-ide-hover transition-colors shrink-0"
              title="编辑 (Ctrl+L)"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-ide-bg">
        {loading && (
          <div className="flex items-center justify-center h-32 text-ide-text-muted text-xs">Loading…</div>
        )}
        {!loading && error && (
          <div className="p-6 text-xs text-ide-danger whitespace-pre-wrap">{error}</div>
        )}
        {!loading && !error && sheet && (
          <table className="border-collapse text-xs font-mono">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 w-12 px-2 py-1 bg-ide-sidebar border border-ide-border text-ide-text-muted font-normal text-right select-none" />
                {Array.from({ length: colCount }, (_, ci) => (
                  <th
                    key={ci}
                    onDoubleClick={() => startEdit(0, ci)}
                    className={`sticky top-0 z-20 ${editing && editing.r === 0 && editing.c === ci ? 'p-0' : 'px-2 py-1'} bg-ide-sidebar border border-ide-border text-ide-text font-semibold text-left whitespace-nowrap${isCsv ? ' cursor-text' : ''}`}
                  >
                    {renderEditor(0, ci, header[ci] ?? '', true) ?? (header[ci] || columnName(ci))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="hover:bg-ide-hover/25">
                  <td className="sticky left-0 z-10 w-12 px-2 py-1 bg-ide-bg border border-ide-border text-ide-text-muted font-normal text-right select-none tabular-nums">
                    {ri + 2}
                  </td>
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td
                      key={ci}
                      onDoubleClick={() => startEdit(ri + 1, ci)}
                      className={`${editing && editing.r === ri + 1 && editing.c === ci ? 'p-0 relative' : 'px-2 py-1'} border border-ide-border text-ide-text whitespace-pre${isCsv ? ' cursor-text' : ''}`}
                    >
                      {renderEditor(ri + 1, ci, row[ci] ?? '') ?? (row[ci] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && !error && sheet && body.length === 0 && (
          <div className="flex items-center justify-center h-24 text-ide-text-muted text-xs">Empty sheet</div>
        )}
      </div>

      {footer && (
        <div className="shrink-0 px-3 py-1 text-[10px] text-ide-text-muted bg-ide-sidebar border-t border-ide-border">
          {footer}
        </div>
      )}
    </div>
  )
})

export default SheetPreview
