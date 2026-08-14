import type { ReactNode } from 'react'

interface DshRootProps {
  renderSlot: (name: string, props: unknown) => ReactNode
}

export function DshRoot({ renderSlot }: DshRootProps) {
  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">
      <div className="absolute top-2 right-3 z-10">
        {renderSlot('sidebar.settings', { wide: false })}
      </div>
      {renderSlot('conversation', {})}
    </div>
  )
}
