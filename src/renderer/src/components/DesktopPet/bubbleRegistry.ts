import type { ReactNode } from 'react'

export interface PetBubbleItem {
  id: string
  label: string
  badge?: ReactNode     // 左侧小圆标（如发送方式图标）
  onAction: () => void
  danger?: boolean
  disabled?: boolean
}

export interface PetBubbleSection {
  id: string
  title?: string
  items: PetBubbleItem[]
}
