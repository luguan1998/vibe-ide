import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { PetManifest, PetListResult } from '@shared/types'
import { PetSprite } from './PetSprite'
import { injectPetKeyframes } from './keyframes'
import { resolveStateName, type PetActiveState } from './stateMap'
import { loadKeypadItems } from '../VibeProgramer'
import { getExtraBubbleSections, onPetBubblesChanged, type PetBubbleItem, type PetBubbleSection } from './bubbleRegistry'
import { getPetScale, getPetVisible, getPetPos, setPetPos, onPetPrefsChanged } from './petSettings'

export function DesktopPet({ activeState }: { activeState: PetActiveState }) {
  const [manifest, setManifest] = useState<PetManifest | null>(null)
  const [pos, setPos] = useState(() => getPetPos())
  const [scale, setScale] = useState(() => getPetScale())
  const [visible, setVisible] = useState(() => getPetVisible())
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupAbove, setPopupAbove] = useState(true)
  const [keypadItems, setKeypadItems] = useState<ReturnType<typeof loadKeypadItems>>([])
  const [, setExtraTick] = useState(0)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number; moved: boolean } | null>(null)

  // 加载 active manifest + 订阅 PET_CHANGED（设置里切换/删除后热重载）
  useEffect(() => {
    let cancelled = false
    const reload = async () => {
      const r: PetListResult = await window.api.pet.list()
      if (cancelled) return
      setManifest(r.pets.find(p => p.id === r.activeId) ?? r.pets[0] ?? null)
    }
    reload()
    const handler = () => { reload() }
    window.api.pet.onChanged(handler)
    return () => { cancelled = true; window.api.pet.removeChangedListener(handler) }
  }, [])

  // manifest 变化时注入对应 keyframes（照抄 petSprites.ts 的运行时 <style> 注入）
  useEffect(() => {
    if (manifest) injectPetKeyframes(manifest)
  }, [manifest])

  // 订阅本地偏好变化（缩放/可见性/重置位置）
  useEffect(() => onPetPrefsChanged(() => {
    setScale(getPetScale())
    setVisible(getPetVisible())
    setPos(getPetPos())
  }), [])

  // 订阅气泡拓展注册表变化
  useEffect(() => onPetBubblesChanged(() => setExtraTick(v => v + 1)), [])

  const sendLine = useCallback((text: string) => {
    ;(window as any).__vibeSendLine?.(text)
  }, [])

  // 拖拽：左键按下 → 移动改 left/top → 松开持久；未移动则视为点击开气泡
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top, moved: false }
    try { el.setPointerCapture(e.pointerId) } catch {}
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      d.moved = true
      setPopupOpen(false)
    }
    if (!d.moved) return
    const left = Math.max(0, Math.min(window.innerWidth - 8, d.origLeft + dx))
    const top = Math.max(0, Math.min(window.innerHeight - 8, d.origTop + dy))
    setPos({ left, top })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
    if (d && !d.moved) {
      setKeypadItems(loadKeypadItems())
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setPopupAbove(rect.top > 240)
      setPopupOpen(v => !v)
    } else if (d && d.moved) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setPetPos({ left: rect.left, top: rect.top })
    }
  }, [])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setKeypadItems(loadKeypadItems())
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPopupAbove(rect.top > 240)
    setPopupOpen(true)
  }, [])

  // 气泡面板打开时：点面板外关闭（面板与宠物都在 wrapperRef 内，DOM 包含判定）
  useEffect(() => {
    if (!popupOpen) return
    const onDown = (ev: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(ev.target as Node)) setPopupOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popupOpen])

  if (!manifest || !visible) return null

  const stateName = resolveStateName(activeState)
  const wrapperStyle: React.CSSProperties = pos ? { left: pos.left, top: pos.top } : { right: 8, bottom: 8 }

  // 组装气泡 section：速发键 → 拓展注册表（宠物选择/删除/打开文件夹已移至设置→外观）
  const keypadSection: PetBubbleSection = {
    id: 'keypad',
    items: keypadItems.map(k => ({ id: k.code, label: k.text, badge: k.key, onAction: () => sendLine(k.text) }))
  }
  const sections: PetBubbleSection[] = [keypadSection, ...getExtraBubbleSections()]

  const onItemClick = (it: PetBubbleItem) => {
    if (it.disabled) return
    it.onAction()
    setPopupOpen(false)
  }

  return (
    <div className="desktop-pet__wrapper" ref={wrapperRef} style={wrapperStyle}>
      <div
        className="desktop-pet__hitarea"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
      >
        <PetSprite manifest={manifest} stateName={stateName} scale={scale} />
      </div>
      {popupOpen && (
        <div className={`desktop-pet__bubbles${popupAbove ? ' desktop-pet__bubbles--above' : ' desktop-pet__bubbles--below'}`}>
          {sections.map(sec => (
            <div className="desktop-pet__bubble-section" key={sec.id}>
              {sec.items.map(it => (
                <button
                  key={it.id}
                  className={`desktop-pet__bubble${it.danger ? ' desktop-pet__bubble--danger' : ''}`}
                  disabled={it.disabled}
                  title={it.label}
                  onClick={() => onItemClick(it)}
                >
                  {it.badge && <span className="desktop-pet__bubble-num">{it.badge}</span>}
                  <span className="desktop-pet__bubble-text">{it.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
