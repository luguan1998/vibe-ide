// 宠物窗口独立的 CSS 生效路径：与主窗口一样注入 snippets、应用 MD 字体偏好。
// 独立 renderer 不共享主窗口的 DOM style，需要自己维护一份。

export async function applySnippetsCss(): Promise<void> {
  try {
    const { css } = await window.api.snippets.load()
    let style = document.getElementById('custom-css') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'custom-css'
      document.head.appendChild(style)
    }
    style.textContent = css
  } catch { /* 加载失败不阻断 */ }
}

export function applyMdFont(): void {
  const root = document.documentElement
  try {
    const f = localStorage.getItem('vibe-ide-md-font')
    if (f) root.style.setProperty('--md-font-family', f)
    else root.style.removeProperty('--md-font-family')
    const s = localStorage.getItem('vibe-ide-md-font-size')
    if (s) root.style.setProperty('--md-font-size', s + 'px')
  } catch {}
}

// 主窗口 UI 字体（App.tsx 写到 --ide-font-family）；宠物气泡/按钮和 MD 字体 fallback 都用它
export function applyUiFont(): void {
  try {
    const f = localStorage.getItem('vibe-ide-font-family')
    if (f) document.documentElement.style.setProperty('--ide-font-family', f)
  } catch {}
}
