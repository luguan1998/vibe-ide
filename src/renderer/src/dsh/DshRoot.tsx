import type { ReactNode } from 'react'

interface DshRootProps {
  renderSlot: (name: string, props: unknown) => ReactNode
}

export function DshRoot({ renderSlot }: DshRootProps) {
  return (
    <div className="relative w-full h-full flex overflow-hidden">
      <div className="dsh-root__sidebar">
        {renderSlot('sidebar', { collapsed: false, width: 280 })}
      </div>
      <div className="flex-1 min-w-0 min-h-0">
        {renderSlot('conversation', {})}
      </div>
    </div>
  )
}
