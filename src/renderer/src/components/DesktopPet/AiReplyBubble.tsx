import React from 'react'
import { ChatMarkdown } from '../AiTab'

export const AiReplyBubble = React.memo(function AiReplyBubble({ text, align = 'center' }: { text: string; align?: 'center' | 'left' | 'right' }) {
  if (!text.trim()) return null
  return (
    <div className={`desktop-pet__ai-reply${align !== 'center' ? ` desktop-pet__ai-reply--${align}` : ''}`}>
      <ChatMarkdown text={text} workspacePath={null} />
    </div>
  )
})
