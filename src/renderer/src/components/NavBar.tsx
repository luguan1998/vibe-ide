import React from 'react'

interface BookmarkEntry {
  fullPath: string
  line: number
}

interface NavBarProps {
  entries: BookmarkEntry[]
  selectedIndex: number
  visible: boolean
  onSelect: (index: number) => void
  onClearAll?: () => void
}

const NavBar = React.memo(function NavBar({ entries, selectedIndex, visible, onSelect, onClearAll }: NavBarProps) {
  if (!visible || entries.length === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slide-up">
      <div className="relative flex items-center gap-0.5 rounded-lg border border-ide-border bg-ide-sidebar/95 px-4 py-2 shadow-2xl backdrop-blur-sm">
        {entries.map((entry, i) => {
          const name = `${entry.fullPath.replace(/^.*[/\\]/, '')}:${entry.line}`
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
        {onClearAll && (
          <button
            onClick={onClearAll}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ide-sidebar border border-ide-border flex items-center justify-center text-ide-text-muted hover:bg-ide-danger hover:text-white hover:border-ide-danger transition-colors"
            title="清除所有标记"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
})

export default NavBar
