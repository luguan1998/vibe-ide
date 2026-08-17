/** Product-wide, versioned internal-testing notice. */

import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WelcomeNoticeState, WelcomeNoticeStore } from './welcome-store.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import css from './WelcomeNotice.module.css'

/** Registration-side dependencies of {@link WelcomeNotice}. */
export interface WelcomeNoticeInjected {
  hooks: {
    /** Durable or process-local acknowledgement state. */
    welcome: SnapshotStore<WelcomeNoticeState>
  }
  /** Welcome acknowledgement controller. */
  controller: WelcomeNoticeStore
  /** Onboarding copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
export type WelcomeNoticeProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<WelcomeNoticeInjected>

/**
 * Render the current notice until its exact copy version is acknowledged.
 * @param props - settings-shell owner state and welcome dependencies.
 * @returns the welcome modal or null while the step decides not to show.
 */
export function WelcomeNotice(props: WelcomeNoticeProps): ReactNode {
  // IDE 嵌入（Vibe）时不展示 harness 内测声明 onboarding：OnboardingModal 会
  // inert #root 冻结整个 IDE 窗口，且 host persistence ack 失败时弹窗消不掉、持续
  // 冻结。IDE 用户非 harness 开发者，无需此声明。harness 独立产品（apps/web）未
  // 设 __VIBE_DSH_EMBEDDED__，照常弹。
  if ((globalThis as { __VIBE_DSH_EMBEDDED__?: boolean }).__VIBE_DSH_EMBEDDED__) return null
  const { complete, controller, useWelcome, t } = props
  const state = useWelcome(snapshot => snapshot)
  const finished = useRef(false)
  const finish = useCallback((): void => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (state.acknowledged) finish()
  }, [finish, state.acknowledged])

  if (state.status === 'idle' || state.status === 'loading' || state.acknowledged) return null

  const acknowledge = async (): Promise<void> => {
    if (await controller.acknowledge()) finish()
  }
  const paragraphs = t('welcomeBody').split('\n\n')

  return (
    <OnboardingModal title={t('welcomeTitle')} focusTitle>
      <div className={css.copy}>
        {paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {state.error === null ? null : <p className={css.error} role="alert">{t('welcomeError')}</p>}
      <div className={css.actions}>
        <Button
          variant="primary"
          className={css.primary}
          disabled={state.status === 'saving'}
          onClick={() => { void acknowledge() }}
        >
          {t('welcomeContinue')}
        </Button>
      </div>
    </OnboardingModal>
  )
}
