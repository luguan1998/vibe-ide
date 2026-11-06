import React from 'react'
import { X } from 'lucide-react'
import { ChatMarkdown } from '../AiTab'

export const AiReplyBubble = React.memo(function AiReplyBubble({ text, align = 'center', closable, onClose }: { text: string; align?: 'center' | 'left' | 'right'; closable?: boolean; onClose?: () => void }) {
  if (!text.trim()) return null
  return (
    <div className={`desktop-pet__ai-reply${align !== 'center' ? ` desktop-pet__ai-reply--${align}` : ''}${closable ? ' desktop-pet__ai-reply--with-close' : ''}`}>
      {closable && (
        <div className="desktop-pet__ai-reply-head">
          <button className="desktop-pet__ai-reply-close" onClick={onClose} title="关闭">
            <X size={10} />
          </button>
        </div>
      )}
      <div className="desktop-pet__ai-reply-scroll">
        <ChatMarkdown text={text} workspacePath={null} />
      </div>
    </div>
  )
})
