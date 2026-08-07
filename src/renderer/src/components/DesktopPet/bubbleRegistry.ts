// 桌面宠物气泡面板的拓展注册表。
// 默认 section（速发键 keypad、管理 manage）由 DesktopPet 内部装配；
// 其它模块可通过 registerPetBubbleSection 注入额外 section（如游戏/工具速入口）。

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

const extraSections: PetBubbleSection[] = []
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(l => l())
}

export function registerPetBubbleSection(section: PetBubbleSection): () => void {
  extraSections.push(section)
  notify()
  return () => {
    const i = extraSections.indexOf(section)
    if (i >= 0) {
      extraSections.splice(i, 1)
      notify()
    }
  }
}

export function getExtraBubbleSections(): PetBubbleSection[] {
  return extraSections
}

export function onPetBubblesChanged(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
