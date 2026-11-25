import React, { useMemo } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cleanMessageContent } from '../../utils/aiConversationFormatter'

// singleTilde:false 防 "4~7 xx 7~8" 这类范围写法被误配成删除线；del 直通彻底不渲染删除线
export const GFM_PLUGINS: [[typeof remarkGfm, { singleTilde: boolean }]] = [[remarkGfm, { singleTilde: false }]]
export const DelPassthrough = ({ children }: { children?: ReactNode }) => <>{children}</>

const PLAIN_COMPONENTS = { del: DelPassthrough }

export const PlainMarkdown = React.memo(function PlainMarkdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`ai-tab__markdown md-preview ${className}`}>
      <ReactMarkdown remarkPlugins={GFM_PLUGINS} components={PLAIN_COMPONENTS}>
        {cleanMessageContent(text)}
      </ReactMarkdown>
    </div>
  )
})
