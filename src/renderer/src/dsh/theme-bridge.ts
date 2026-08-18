import type { Context } from '@deepseek-ai/cordis'
import type { ThemeRuntime, ThemeSnapshot, ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/src/client/index.ts'

const TOKEN_MAP: ReadonlyArray<[string, string]> = [
  ['--dsw-alias-bg-base', '--ide-bg'],
  ['--dsw-alias-bg-layer-1', '--ide-panel'],
  ['--dsw-alias-bg-layer-2', '--ide-hover'],
  ['--dsw-alias-bg-overlay', '--ide-panel'],
  ['--dsw-alias-bg-module-platform', '--ide-panel'],
  ['--dsw-alias-border-l1', '--ide-border'],
  ['--dsw-alias-border-l2', '--ide-active'],
  ['--dsw-alias-border-l2-darkmode-thin', '--ide-border'],
  ['--dsw-alias-border-l3', '--ide-border'],
  ['--dsw-alias-border-l4', '--ide-active'],
  ['--dsw-alias-line-secondary', '--ide-border'],
  ['--dsw-alias-separator-primary', '--ide-border'],
  ['--dsw-alias-brand-primary', '--ide-accent'],
  ['--dsw-alias-brand-primary-invert', '--ide-bg'],
  ['--dsw-alias-button-contrast-fill', '--ide-text'],
  ['--dsw-alias-button-ghost-active-fill', '--ide-hover'],
  ['--dsw-alias-button-ghost-active-border', '--ide-active'],
  ['--dsw-alias-button-primary-fill', '--ide-accent'],
  ['--dsw-alias-button-primary-hover', '--ide-accent-hover'],
  ['--dsw-alias-button-tool-bar-fill', '--ide-hover'],
  ['--dsw-alias-button-tool-bar-hover', '--ide-active'],
  ['--dsw-alias-interactive-bg-active', '--ide-active'],
  ['--dsw-alias-label-primary', '--ide-text'],
  ['--dsw-alias-label-primary-bluish', '--ide-text'],
  ['--dsw-alias-label-primary-dimmed', '--ide-text-muted'],
  ['--dsw-alias-label-primary-foreground', '--ide-bg'],
  ['--dsw-alias-label-primary-inverted', '--ide-bg'],
  ['--dsw-alias-label-secondary', '--ide-text-muted'],
  ['--dsw-alias-label-tertiary', '--ide-text-muted'],
  ['--dsw-alias-label-caption', '--ide-text-muted'],
  ['--dsw-alias-label-dimmed', '--ide-text-muted'],
  ['--dsw-alias-state-business-primary', '--ide-accent'],
  ['--dsw-alias-state-business-tertiary', '--ide-accent'],
  ['--dsw-alias-state-error-primary', '--ide-danger'],
  ['--dsw-alias-state-success-primary', '--ide-success'],
  ['--dsw-alias-state-warn-primary', '--ide-warning'],
  ['--dsw-alias-state-warn-secondary', '--ide-warning'],
  ['--dsw-alias-state-warn-tertiary', '--ide-warning'],
  ['--dsw-alias-state-warn-label', '--ide-warning'],
  ['--dsw-alias-button-floating-fill', '--ide-panel'],
  ['--dsw-alias-button-floating-hover', '--ide-hover'],
  ['--dsw-alias-button-info-fill', '--ide-accent'],
  ['--dsw-alias-button-info-hover', '--ide-accent'],
  ['--dsw-alias-interactive-bg-hover', '--ide-hover'],
  ['--dsw-alias-interactive-bg-hover-solid', '--ide-hover'],
  ['--dsw-alias-interactive-bg-hover-danger', '--ide-hover'],
  ['--dsw-alias-markdown-code-block', '--ide-hover'],
  ['--dsw-alias-markdown-code-block-banner', '--ide-hover'],
  ['--dsw-alias-markdown-citation', '--ide-hover'],
  ['--dsw-alias-scrollbar-bg-l2', '--ide-active'],
  ['--dsw-alias-scrollbar-hover-l2', '--ide-text-muted'],
  ['--dsw-specific-bubble', '--ide-panel'],
  ['--dsw-specific-input-major', '--ide-panel'],
  ['--dsw-specific-menu', '--ide-panel'],
  ['--dsw-specific-selector', '--ide-hover'],
  ['--dsw-specific-sidebar-fill', '--ide-sidebar'],
  ['--dsw-specific-tip', '--ide-hover'],
]

function toCssColor(value: string): string {
  const parts = value.trim().split(/\s+/).map(Number)
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return `rgb(${parts.join(', ')})`
  }
  return value.trim()
}

// font shorthand 里含空格的单字体名必须加引号，多字体栈（逗号分隔）原样透传
function quoteFamily(family: string): string {
  const t = family.trim()
  if (t.includes(',') || /^['"]/.test(t)) return t
  return t.includes(' ') ? `'${t}'` : t
}

function isDark(value: string): boolean {
  const parts = value.trim().split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return true
  const [r, g, b] = parts
  return 0.299 * r + 0.587 * g + 0.114 * b < 128
}

export function applyDshTheme(ctx: Context): () => void {
  const theme = ctx.get('theme') as unknown as ThemeRuntime
  const body = document.body

  // ui-layout 的 ThemePresenter 未挂载，这里补上它的 DOM 写入职责：
  // 把合成后的 token 快照写为 body 内联 CSS 变量（否则 override 只存在快照里，样式表看不到）
  let appliedTokens: string[] = []
  const present = (snapshot: ThemeSnapshot): void => {
    for (const name of appliedTokens) body.style.removeProperty(name)
    appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      appliedTokens.push(name)
    }
  }
  const off = ctx.on('theme/change', present)
  // apply() 经 rAF 调度：MO 微任务里 getComputedStyle 对自定义属性返回上一次重算的旧值
  //（慢一拍 → dsh 落后一个主题）。rAF 在 style recalc 后执行，computed 才是最新值；
  // 必须读 computed 而非内联 style，才能拿到 snippet 在 :root 用 !important 叠加的覆盖色。
  let rafId: number | null = null
  const apply = (): void => {
    rafId = null
    const cs = getComputedStyle(document.documentElement)
    const tokens: ThemeTokenOverrides = {}
    for (const [dsw, ide] of TOKEN_MAP) {
      const value = cs.getPropertyValue(ide).trim()
      if (!value) continue
      const color = toCssColor(value)
      tokens[dsw] = { light: color, dark: color }
    }
    // 未映射的 dsh token 走调色板默认值：浅色 Vibe 主题切浅色调色板，保持对比度
    const dark = isDark(cs.getPropertyValue('--ide-bg').trim())
    if (dark) body.setAttribute('data-ds-dark-theme', '')
    else body.removeAttribute('data-ds-dark-theme')
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    // dsh 全局 UI 字体跟随 Vibe 设置（--dsw-font-family 定义在 :root，body 内联才能覆盖）。
    // markdown 内部字体由 globals.css 的 .dsh-view [class*="markdown"] 对齐规则负责，无需在此注入
    const ideFont = cs.getPropertyValue('--ide-font-family').trim()
    if (ideFont) body.style.setProperty('--dsw-font-family', quoteFamily(ideFont))
    // 同步 emit theme/change → present() 立即把 token 写到 body
    theme.overrideTokens('vibe-ide', tokens)
  }
  const schedule = (): void => {
    if (rafId !== null) return
    rafId = requestAnimationFrame(apply)
  }
  apply()
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId)
    observer.disconnect()
    off()
  }
}
