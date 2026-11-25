import React from 'react'
import { PlainMarkdown } from '../AiTab/markdownShared'

export const AiReplyBubble = React.memo(function AiReplyBubble({ text, align = 'center' }: { text: string; align?: 'center' | 'left' | 'right' }) {
  if (!text.trim()) return null
  return (
    <div className={`desktop-pet__ai-reply${align !== 'center' ? ` desktop-pet__ai-reply--${align}` : ''}`}>
      <div className="desktop-pet__ai-reply-scroll">
        <PlainMarkdown text={text} />
      </div>
    </div>
  )
})
