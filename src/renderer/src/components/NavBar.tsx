import React from 'react'

interface CursorHistoryEntry {
  fullPath: string
  line: number
  column: number
}

interface NavBarProps {
  entries: CursorHistoryEntry[]
  selectedIndex: number
  visible: boolean
  onSelect: (index: number) => void
}

const NavBar = React.memo(function NavBar({ entries, selectedIndex, visible, onSelect }: NavBarProps) {
  if (!visible || entries.length === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slide-up">
      <div className="flex items-center gap-0.5 rounded-lg border border-ide-border bg-ide-sidebar/95 px-4 py-2 shadow-2xl backdrop-blur-sm">
        {entries.map((entry, i) => {
          const name = entry.fullPath.replace(/^.*[/\\]/, '')
          const isSelected = i === selectedIndex
          return (
            <React.Fragment key={`${entry.fullPath}:${i}`}>
              {i > 0 && (
                <span className="mx-0.5 text-[10px] text-ide-text-muted/25 select-none">|</span>
              )}
              <span
                className={`px-2 py-1 rounded text-xs whitespace-nowrap transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-ide-accent text-white'
                    : 'text-ide-text-muted hover:bg-ide-accent/20'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(i)
                }}
              >
                {name}
              </span>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
})

export default NavBar
