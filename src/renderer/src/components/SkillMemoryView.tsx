import { useState, type ReactNode } from 'react'
import { Sparkles, Brain } from 'lucide-react'
import { useI18n } from '../i18n'
import SkillView from './SkillView'
import MemoryView from './MemoryView'

interface SkillMemoryViewProps {
  workspacePath: string | null
  onOpenFile: (fullPath: string) => void
  onPreviewFile?: (fullPath: string) => void
  onBack: () => void
}

export default function SkillMemoryView({ workspacePath, onOpenFile, onPreviewFile, onBack }: SkillMemoryViewProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'skills' | 'memory'>('skills')

  const tabButton = (id: 'skills' | 'memory', icon: ReactNode, label: string) => {
    const active = tab === id
    return (
      <button
        onClick={() => setTab(id)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${active ? 'bg-ide-accent/15 text-ide-accent' : 'text-ide-text-muted hover:text-ide-text'}`}
      >
        {icon}
        <span>{label}</span>
      </button>
    )
  }

  const tabs = (
    <div className="flex items-center shrink-0 rounded-lg bg-ide-hover p-0.5">
      {tabButton('skills', <Sparkles size={12} />, t('Skills'))}
      {tabButton('memory', <Brain size={12} />, t('Memory'))}
    </div>
  )

  const commonProps = { workspacePath, onOpenFile, onPreviewFile, onBack, tabs }

  return (
    <div className="flex-1 min-h-0 flex flex-col outline-none focus:outline-none">
      <div style={{ display: tab === 'skills' ? 'flex' : 'none' }} className="flex-1 min-h-0 flex flex-col">
        <SkillView {...commonProps} />
      </div>
      <div style={{ display: tab === 'memory' ? 'flex' : 'none' }} className="flex-1 min-h-0 flex flex-col">
        <MemoryView {...commonProps} />
      </div>
    </div>
  )
}
