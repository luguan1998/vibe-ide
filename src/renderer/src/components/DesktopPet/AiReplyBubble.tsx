import React from 'react'
import { ChatMarkdown } from '../AiTab'

export const AiReplyBubble = React.memo(function AiReplyBubble({ text, above }: { text: string; above: boolean }) {
  if (!text.trim()) return null
  return (
    <div className={`desktop-pet__ai-reply${above ? ' desktop-pet__ai-reply--above' : ' desktop-pet__ai-reply--below'}`}>
      <ChatMarkdown text={text} workspacePath={null} />
    </div>
  )
})
