/**
 * Lightweight i18n — Chinese / English only.
 *
 * Usage:
 *   const { t, lang, setLang } = useI18n()
 *   <span>{t('settings')}</span>
 *
 * Keys are the English strings; zh map provides Chinese equivalents.
 * New strings only need an English entry + a zh entry in ZH_MAP.
 */

import React, { createContext, useContext, useState, useCallback } from 'react'

export type Lang = 'en' | 'zh'

// ── translation maps ───────────────────────────────────────────────

const ZH_MAP: Record<string, string> = {
  // SessionPanel
  'Agent running': 'Agent 正在运行',
  'Idle': '空闲',
  'Settings': '设置',
  'Theme': '主题',
  'Term Type': '终端类型',
  'Keyboard Shortcuts': '键盘快捷键',
  'Word Wrap': '自动换行',
  'Show squiggles': '显示错误提示',
  'New Terminal': '新建终端',
  'No sessions yet': '暂无会话',
  'Close Session': '关闭会话',
  'Clone': '克隆',
  'Rename': '重命名',
  'Close': '关闭',
  'History': '历史',
  'No commands yet': '暂无命令',
  'Copy': '复制',

  // SettingsPanel
  'Press keys...': '按按键...',
  'Reset to defaults': '重置为默认值',

  // Shortcut labels
  'Focus Search': '聚焦搜索',
  'Next Terminal': '下一个终端',
  'Previous Terminal': '上一个终端',
  'Font Size Increase': '字体放大',
  'Font Size Decrease': '字体缩小',
  'Panel Tab Right': '右侧标签右移',
  'Panel Tab Left': '右侧标签左移',
  'Terminal Newline': '终端内换行',
  'Terminal Copy/Paste': '终端右键复制/粘贴',
  'Close Diff / Back': '关闭Diff/返回终端',

  // File Tree
  'File Tree Depth': '文件树深度',

  // RightPanel Aux
  'Launch Terminal': '启动终端',
  'Please select a workspace first': '请先选择工作目录',
  'Commands': 'Commands',

  // FileTab
  'New File': '新建文件',
  'New Folder': '新建文件夹',
  'Open in Explorer': '打开文件所在位置',
  'Delete': '删除',
  'Folder name': '文件夹名称',
  'File name': '文件名称',
  'Empty directory': '空目录',
  'No workspace': '无工作目录',
  'Cancel': '取消',
  'Confirm': '确认',
  'Delete {fileName}?': '确定删除 {fileName}？',
}

// ── context ────────────────────────────────────────────────────────

interface I18nCtx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nCtx>({
  lang: 'zh',
  setLang: () => {},
  t: (k: string) => k,
})

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const v = localStorage.getItem('vibe-ide-lang')
      return v === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  })

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem('vibe-ide-lang', l) } catch {}
  }, [])

  const t = useCallback(
    (key: string) => {
      if (lang === 'en') return key
      return ZH_MAP[key] || key
    },
    [lang],
  )

  return React.createElement(I18nContext.Provider, { value: { lang, setLang, t } }, children)
}

export function useI18n() {
  return useContext(I18nContext)
}
