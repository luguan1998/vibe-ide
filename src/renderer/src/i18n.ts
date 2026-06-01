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
  'running': '正在运行',
  'Idle': '空闲',
  'Settings': '设置',
  'Theme': '主题',
  'Shell Type': '命令行类型',
  'Keyboard Shortcuts': '键盘快捷键',
  'Word Wrap': '自动换行',
  'Auto UTF-8': '自动切 UTF-8',
  'Polling Refresh Git/File': '轮询刷新 Git/File',
  'Other Options…': '其他选项…',
  'Auto-wrap long lines in diff/editor. Recommended: off': 'diff/edit 界面是否自动换行，建议关闭',
  'Run chcp 65001 on terminal start to set UTF-8 encoding': '终端开启默认进行 chcp 65001 转换',
  'Show LSP diagnostics in diff/editor. Recommended: off (basic highlighting is sufficient, this feature is incomplete)': 'diff/edit 界面显示 lsp 错误，建议关闭（基本语法提示已有，此功能不完善）',
  'Poll git and file tree every 6s. Recommended: off (only for network drives where file watching is unreliable)': '仅在网盘等远程场景无法监控文件变化的场景建议开启，建议关闭',
  'Show squiggles': '显示错误提示',
  'Force Inline Diff': '强制内联 Diff',
  'Force inline diff mode (revert button uses circular icon). Recommended: off (side-by-side reads better)': '强制使用内联 diff 模式（撤销按钮呈圆形）。建议关闭（side-by-side 更易读）',
  'New Terminal': '新建终端',
  'Recent Directories': '最近打开的目录',
  'No sessions yet': '暂无会话',
  'Close Session': '关闭会话',
  'Clone': '克隆',
  'Rename': '重命名',
  'Close': '关闭',
  'History': '历史',
  'No commands yet': '暂无命令',
  'Copy': '复制',
  'Auto Approve': '自动确认',
  'Auto Approve: ON': '自动确认：开',
  'Auto Approve: OFF': '自动确认：关',

  // SettingsPanel
  'Press keys...': '按按键...',
  'Reset to defaults': '重置为默认值',
  'Reset Defaults': '恢复默认',

  // Shortcut labels
  'Focus Search': '聚焦搜索',
  'Next Terminal': '下一个终端',
  'Previous Terminal': '上一个终端',
  'Font Size Increase': '字体放大',
  'Font Size Decrease': '字体缩小',
  'Panel Tab Right': '右侧标签右移',
  'Panel Tab Left': '右侧标签左移',
  'Focus Right Panel': '聚焦到右侧面板',
  'Focus Terminal': '聚焦到终端',
  'Terminal Newline': '终端内换行',
  'Terminal Page Down': '终端向下翻页',
  'Terminal Page Up': '终端向上翻页',
  'Command History': '命令历史',
  'Terminal Copy/Paste': '终端右键复制/粘贴',
  'Close Diff / Back': '关闭Diff/返回终端',

  // File Tree
  'File Tree Depth': '文件树深度',
  'Emoji Text': '会话图标',
  'Each session gets a random icon. One per line.': '每个 session 随机分配一个表情。每行一个。',
  'File Filter Rules': '文件过滤规则',
  'Skip directories matching these names. One per line.': '跳过匹配这些名称的目录。每行一个。',
  'Expand All': '全部展开',
  'Collapse All': '全部收缩',
  'Expand Panel': '展开面板',
  'Collapse Panel': '收缩面板',

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
  'Save': '保存',
  'Confirm': '确认',
  'Delete {fileName}?': '确定删除 {fileName}？',

  // GitTab - Stage/Unstage/Discard tooltips
  'Stage': '暂存',
  'Unstage': '取消暂存',
  'Discard': '撤销修改',
  'Discard All': '全部撤销',
  'Delete All': '全部删除',
  'Refresh': '刷新',

  // GitTab - Stage/Clear all
  'Stage All': '全部暂存',
  'Clear All': '全部取消',

  // GitTab - Confirm dialog
  'Discard changes to {fileName}? This cannot be undone.': '确定撤销对 {fileName} 的修改？此操作不可恢复。',
  'Discard all {count} changes? This cannot be undone.': '确定撤销全部 {count} 个文件的修改？此操作不可恢复。',
  'Delete all {count} untracked files?': '确定删除全部 {count} 个未跟踪文件？',

  // GitTab - Conflict dialog
  'Conflicts detected while merging {branch}': '合并 {branch} 时检测到冲突',
  'Abort': '放弃',
  'Keep Conflicts': '保留冲突',

  // GitTab - Conflict warning
  'Conflicted files in staged area. Please resolve conflicts before committing.': '暂存区存在冲突文件，请先解决冲突后再提交',

  // GitTab - Branch context menu
  'Merge Changes': '合并更改',
  'Delete Branch': '删除分支',

  // GitTab - Empty states & messages
  'No git repository found in this workspace': '当前工作目录未找到 Git 仓库',
  'No changes detected': '没有检测到更改',
  'No commits yet': '暂无提交',
  'No branches': '暂无分支',

  // GitTab - Commit area
  'Commit message...': '输入提交信息...',
  'Commit (Ctrl+Enter)': '提交 (Ctrl+Enter)',
  'Files ({count})': '文件 ({count})',

  // GitTab - File context menu
  'Open in File Panel': '在 File 面板中打开',
  'Open Containing Folder': '打开文件所在位置',

  // GitTab - Commit context menu
  'Copy Message': '复制提交信息',
  'Copy Hash': '复制哈希值',

  // GitTab - Section headers (keep English)

  'main': '主分支',
  'current': '当前分支',

  // SearchPanel
  'No active session': '无活动会话',
  'Search in project...': '在项目中搜索...',
  'No results found': '无搜索结果',
  'Type to search files by content': '输入关键字搜索文件内容',
  'truncated': '已截断',
  'matches': '条结果',

  // Encoding
  'Search encodings...': '搜索编码...',
  'Reopen With Encoding': '以编码重新打开',
  'Save With Encoding': '以编码保存',
  'active': '当前',
  'No matching encodings': '无匹配编码',
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
