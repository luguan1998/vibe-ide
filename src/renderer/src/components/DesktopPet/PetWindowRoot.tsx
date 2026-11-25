import { useEffect, useMemo, useRef, useState } from 'react'
import type { PetWinState } from '@shared/types'
import { DesktopPet, type PetWindowBridge } from './index'
import { applyPetPrefs } from './petSettings'
import { useTheme } from '../../themes'
import { applySnippetsCss } from '../../petWindowCss'
import { ADD_ANNOTATION_EVENT, BTW_REPLY_EVENT } from '../vibeEvents'

export function PetWindowRoot() {
  const [state, setState] = useState<PetWinState | null>(null)
  const { setTheme } = useTheme()
  const nextIntentId = useRef(1)
  const pendingIntents = useRef(new Map<number, (result: string) => void>())

  useEffect(() => {
    const handler = window.api.petWin.onState((next) => {
      applyPetPrefs(next.prefs)
      setTheme(next.themeId)
      setState(next)
    })
    window.api.petWin.ready()
    return () => window.api.petWin.removeStateListener(handler)
  }, [setTheme])

  useEffect(() => {
    const handler = window.api.petWin.onEvent((evt) => {
      if (evt.type === 'btwReply') {
        window.dispatchEvent(new CustomEvent(BTW_REPLY_EVENT, { detail: evt.detail }))
      } else if (evt.type === 'annotation') {
        window.dispatchEvent(new CustomEvent(ADD_ANNOTATION_EVENT, { detail: evt.detail }))
      } else if (evt.type === 'refreshCss') {
        void applySnippetsCss()
      }
    })
    return () => window.api.petWin.removeEventListener(handler)
  }, [])

  // 主题 id 是已有的持久变量：主窗口切换主题时同步刷新宠物窗口
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'vibe-ide-theme' && e.newValue) setTheme(e.newValue)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [setTheme])

  useEffect(() => {
    const handler = window.api.petWin.onIntentReply(({ id, result }) => {
      const resolve = pendingIntents.current.get(id)
      if (!resolve) return
      pendingIntents.current.delete(id)
      resolve(result)
    })
    return () => window.api.petWin.removeIntentReplyListener(handler)
  }, [])

  const bridge = useMemo<PetWindowBridge>(() => ({
    sendLine(text) {
      window.api.petWin.sendIntent({ id: nextIntentId.current++, type: 'sendLine', text })
    },
    sendLineTo(sessionId, text) {
      window.api.petWin.sendIntent({ id: nextIntentId.current++, type: 'sendLineTo', sessionId, text })
    },
    getInput() {
      const id = nextIntentId.current++
      return new Promise<string>((resolve) => {
        pendingIntents.current.set(id, resolve)
        window.api.petWin.sendIntent({ id, type: 'getInput' })
      })
    }
  }), [])

  if (!state) return null
  return (
    <DesktopPet
      logicalState={state.logicalState}
      activeSessionId={state.activeSessionId}
      activeSessionCwd={state.activeSessionCwd}
      sessions={state.sessions}
      ai={state.ai}
      aiConfigDir={state.aiConfigDir}
      bridge={bridge}
    />
  )
}
