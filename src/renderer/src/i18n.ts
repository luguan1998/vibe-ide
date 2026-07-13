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

// English overrides — keys whose English value differs from the key string itself
// (e.g. 'prompt.explain' → full English sentence)
const EN_MAP: Record<string, string> = {
  'prompt.explain': 'Explain the architecture and key components of this codebase. Identify the main modules, how they interact, and the overall design patterns used. Be concise and focus on the most important structural insights.',

  'prompt.tests': 'Write comprehensive unit tests for the main module. Cover edge cases, error paths, and typical usage scenarios. Use the existing test framework and patterns in the project. Ensure tests are isolated and deterministic.',
  'prompt.refactor': 'Identify code that could benefit from refactoring for readability, maintainability, or performance. Suggest concrete changes with clear rationale. Preserve existing behavior — no functional changes. Focus on the highest-impact improvements first.',
}

const ZH_MAP: Record<string, string> = {
  // SessionPanel
  'running': '正在运行',
  'Idle': '空闲',
  'Settings': '设置',
  'Theme': '主题',
  'Shell Type': '命令行类型',
  'Keyboard Shortcuts': '键盘快捷键',
  'Claude Code GUI Command': 'AI 命令行程序',
  'CLI Configuration': '命令行配置',
  'Word Wrap': '自动换行',
  'Auto UTF-8': '自动切 UTF-8',
  'CodeGraph': '代码图谱',
  'Code symbol indexing for smart search. Disable to free ~170MB main process memory.': '代码符号索引，用于智能搜索。关闭可释放主进程约 170MB 内存。',
  'Polling Refresh Git/File': '轮询刷新 Git/File',
  'Other Options…': '其他选项…',
  'Auto-wrap long lines in diff/editor. Recommended: off': 'diff/edit 界面是否自动换行，建议关闭',
  'Run chcp 65001 on terminal start to set UTF-8 encoding': '终端开启默认进行 chcp 65001 转换',
  'Poll git and file tree every 6s. Recommended: off (only for network drives where file watching is unreliable)': '仅在网盘等远程场景无法监控文件变化的场景建议开启，建议关闭',
  'Recent Files Panel': '最近文件栏',
  'Show recently opened files at the bottom of the session panel': '在会话栏底部显示最近打开的文件',
  'Outline': '大纲',
  'Show code outline over the session panel when viewing a file. Disable to keep the session list visible.': '查看文件时在会话栏上方显示代码大纲。关闭可保持会话列表可见。',
  'Force Inline Diff': '强制内联 Diff',
  'Force inline diff mode (revert button uses circular icon). Recommended: off (side-by-side reads better)': '强制使用内联 diff 模式（撤销按钮呈圆形）。建议关闭（side-by-side 更易读）',
  'New Terminal': '新建终端',
  'New Terminal in this folder': '在此文件夹新建终端',
  'Recent Directories': '最近打开的目录',
  'No sessions yet': '暂无会话',
  'Close Session': '关闭会话',
  'Clone': '克隆',
  'Rename': '重命名',
  'Close': '关闭',
  'Annotation': '批注',
  'Copy annotations': '复制批注',
  'Copied': '已复制',
  'Copied to clipboard': '已复制到剪贴板',
  'Switch to GUI Mode': '切换到 GUI 模式',
  'Switch to Terminal Mode': '切换到终端模式',
  'History': '历史',
  'No commands yet': '暂无命令',
  'Cut': '剪切',
  'Save to command': '记录到命令',
  'Copy': '复制',
  'Paste': '粘贴',
  'Move': '移动',
  'Auto Approve': '自动确认',
  'Auto Approve: ON': '自动确认：开',
  'Auto Approve: OFF': '自动确认：关',
  'Clear Screen': '清屏',

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
  'Panel Tab 1': '右侧选项卡1',
  'Panel Tab 2': '右侧选项卡2',
  'Panel Tab 3': '右侧选项卡3',
  'Panel Tab 4': '右侧选项卡4',
  'Panel Tab 5': '右侧选项卡5',
  'Focus Right Panel': '聚焦到右侧面板',
  'Focus Terminal': '聚焦到终端',
  'Terminal Newline': '终端内换行',
  'Terminal Page Down': '终端向下翻页',
  'Terminal Page Up': '终端向上翻页',
  'Command History': '命令历史',
  'Terminal Copy/Paste': '终端右键复制/粘贴',
  'Close Diff / Back': '关闭Diff/返回终端',
  'Navigate Back': '导航后退',
  'Navigate Forward': '导航前进',
  'Open Code Graph Search': '打开代码图搜索',
  'Open Draft Plan': '打开 vibe programer',
  'Search Terminal': '终端内搜索',
  'Jump to Previous Prompt': '跳到上条命令',
  'Jump to Next Prompt': '跳到下条命令',
  'Toggle Preview / Edit': '切换预览/编辑',
  'Clone Current Session': '克隆当前会话',
  'Feather Pen (Brush Mode)': '羽毛笔（画笔模式）',

  // File Tree
  'File Tree Depth': '文件树深度',
  'Emoji Text': '会话图标',
  'Each session gets a random icon. One per line.': '每个 session 随机分配一个表情。每行一个。',
  'Click any emoji in the sidebar to cycle.': '点击侧边栏的图标可循环切换。',
  'Folder Icons (per cwd)': '目录图标（按目录分配）',
  'Session Icons': '会话图标（按会话分配）',
  'One per line': '每行一个',
  'No emojis': '无表情',
  'Click to cycle emoji': '点击切换图标',
  'File Filter Rules': '文件过滤规则',
  'Skip directories matching these names. One per line.': '跳过匹配这些名称的目录。每行一个。',
  'Expand All': '全部展开',
  'Collapse All': '全部收缩',
  'Expand Panel': '展开面板',
  'Collapse Panel': '收缩面板',
  'Expand': '展开',
  'Collapse': '收缩',

  // RightPanel Aux
  'Launch Terminal': '启动终端',
  'Please select a workspace first': '请先选择工作目录',
  'Commands': 'Commands',

  // FileTab
  'New File': '新建文件',
  'New Folder': '新建文件夹',
  'Open in Explorer': '打开文件所在位置',
  'Compare with Current': '放入左侧比较',
  'Delete': '删除',
  'Folder name': '文件夹名称',
  'File name': '文件名称',
  'Empty directory': '空目录',
  'No workspace': '无工作目录',
  'Cancel': '取消',
  'Save': '保存',
  'Confirm': '确认',
  'Delete {fileName}?': '确定删除 {fileName}？',
  'Recently': '最近',
  'Recently Opened': '最近打开的文件',
  'Remove': '移除',

  // GitTab - Stage/Unstage/Discard tooltips
  'Stage': '暂存',
  'Unstage': '取消暂存',
  'Discard': '撤销修改',
  'Discard All': '全部撤销',
  'Delete All': '全部删除',
  'Refresh': '刷新',
  'Capsule Tabs': '胶囊选项卡',
  'Use capsule-style tab bar instead of icon buttons.': '使用胶囊风格选项卡替代方形图标按钮。',
  'Group Sessions by Folder': '按目录分组',
  'Group sessions by their working directory. Off = flat list with cwd under each item.': '按工作目录分组显示会话。关闭则平铺，每条下方显示目录。',
  'UI Style': 'UI 样式',
  'CSS Snippets': 'CSS 片段',
  'Open CSS Config': '打开 CSS 配置',
  'Reload CSS': '重新加载 CSS',
  'Terminal Font Size': '终端字体大小',
  'Editor Font Size': '编辑器字体大小',
  'Diff Split Ratio': 'Diff 左右占比',
  'Left/right ratio of the diff editor. Smaller = narrower left (original). Side-by-side only.': 'Diff 编辑器左右占比。越小则左侧（原文）越窄。仅并排模式生效。',
  'Recommended': '推荐',
  'Session Font': '会话字体',
  'UI Font': '界面字体',
  'Terminal Font': '终端字体',

  // GitTab - Stage/Clear all
  'Stage All': '全部暂存',
  'Clear All': '全部取消',

  // GitTab - Confirm dialog
  'Discard changes to {fileName}? This cannot be undone.': '确定撤销对 {fileName} 的修改？此操作不可恢复。',
  'Discard all {count} changes? This cannot be undone.': '确定撤销全部 {count} 个文件的修改？此操作不可恢复。',
  'Delete all {count} untracked files?': '确定删除全部 {count} 个未跟踪文件？',
  'Drop stash': '丢弃暂存',
  'Drop the latest stash? This cannot be undone.': '确定丢弃最近一条 stash？此操作不可恢复。',

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
  'Load more commits': '加载更多提交',
  'No branches': '暂无分支',

  // GitTab - Commit area
  'Commit message...': '输入提交信息...',
  'Commit (Ctrl+Enter)': '提交 (Ctrl+Enter)',
  'Amend: fold {count} staged file(s) into last commit and rewrite message': 'Amend：将 {count} 个暂存文件并入上次提交并改写提交信息',
  'Amend: fold {count} staged file(s) into last commit, keep original message': 'Amend：将 {count} 个暂存文件并入上次提交，保留原提交信息',
  'Amend: rewrite last commit message only': 'Amend：仅改写上次提交的提交信息',
  'Nothing to amend (no staged changes and no new message)': '无可 amend（无暂存改动且无新提交信息）',
  'Nothing to amend (no commits yet)': '无可 amend（暂无提交）',
  'Files ({count})': '文件 ({count})',
  'Diffs skipped': '文件过多，已跳过内容展示',
  'Diff not loaded (commit too large)': '文件数目过多，跳过具体内容展示',
  'more files': '更多文件',

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
  'Replace with...': '替换为...',
  'Replace All': '全部替换',
  'Confirm Replace': '确认替换',
  'Replace': '替换',
  'matches in': '条结果，分布在',
  'files': '个文件',
  'files.': '个文件中。',
  'Replaced {n} occurrences in {m} files': '在 {m} 个文件中替换了 {n} 处',
  'Exclude from replace': '排除此文件',
  'from': '来自',
  'total': '总计',
  'Sort by extension': '按后缀排序',

  // Custom Commands
  'Custom Command': '自定义命令',
  'Command Name': '命令名称',
  'Command': '命令',
  'Edit Custom Command': '编辑自定义命令',
  'New Custom Command': '新建自定义命令',
  'Enter command name': '输入命令名称',
  'Enter command to execute': '输入要执行的命令',
  'Execute': '执行',
  'No custom commands': '暂无自定义命令',
  'Simple': '简单执行',
  'Init Session': '初始化会话',
  'Pipe': '管道',

  // Encoding
  'Search encodings...': '搜索编码...',
  'Reopen With Encoding': '以编码重新打开',
  'Save With Encoding': '以编码保存',
  'active': '当前',
  'No matching encodings': '无匹配编码',

  // DiffViewer
  'Force Open': '强行打开',
  'Open Call Graph': '查看调用图',
  'View Line History': '查看这行修改记录',
  'Line History ({file}:{line})': '行修改记录 ({file}:{line})',
  'No line history': '无行修改记录',
  'Revert': '回退',
  'Revert this line': '回退此行',

  // CodeGraphSearch
  'Initializing CodeGraph...': '正在初始化代码图...',
  'Cancel Init': '取消初始化',
  'Slow? Add folders like {ex1}, {ex2}, {ex3} to your {gitignore} to skip indexing them.': '速度慢？将 {ex1}、{ex2}、{ex3} 等文件夹加入 {gitignore} 可跳过索引。',
  'Not initialized — click Init': '未初始化 — 点击 Init',
  'Indexing...': '正在索引...',
  'Loading...': '加载中...',
  'No outline': '无大纲',
  'Search symbols...': '搜索符号...',
  'Search symbols... (Enter to jump, Esc to close)': '搜索符号...（回车跳转，Esc 关闭）',
  'No symbols found': '未找到符号',
  'symbols': '个符号',
  'edges': '条边',
  'filters': '个过滤',
  'Recent': '最近',
  'Init': '初始化',
  'Install': '安装',
  'Installing...': '安装中...',
  'Done': '完成',
  'OCR Image to Text': '图片OCR转文字',
  'Drag image or Ctrl+V to extract text from images and paste into terminal': '拖入图片或 Ctrl+V 将图片文字识别并粘贴到终端',
  'Force DOM Renderer': '强制 DOM 渲染',
  'Disable WebGL terminal renderer, fall back to DOM/canvas. Restart terminal session to take effect.': '禁用 WebGL 终端渲染，回退到 DOM/canvas 渲染, 更稳定但cpu占用高。需重启终端 session 生效',
  'Configure MCP': '配置 MCP',
  'Configure CodeGraph MCP for agents': '配置 CodeGraph MCP for Agent',
  'Exclude folders': '排除文件夹',
  // AI Tab
  'Ask AI to help with your code...': '让 AI 帮你写代码...',
  'Type a message...': '输入消息，Shift+Enter 换行...',
  'Initializing...': '初始化中...',
  'Approve': '批准',
  'Deny': '拒绝',
  'AI wants permission to run:': 'AI 请求权限运行:',
  'Focus AI Chat': '聚焦 AI 聊天',
  'Connecting...': '连接中...',
  'Streaming...': '生成中...',
  'Explain this codebase': '解释代码库',

  'Write tests': '编写测试',
  'Web Search': '联网调研',
  'Diagnose Bug': '定位bug',
  'Grill My Requirements': '拷问我需求',
  'Refactor': '重构',

  // AI Prompt templates (full prompts sent to Claude)
  'prompt.explain': '请解释这个代码库的架构和核心组件。识别主要模块、它们的交互方式以及所使用的设计模式。请简洁明了，聚焦于最重要的结构性洞察。',

  'prompt.tests': '为主要模块编写全面的单元测试。覆盖边界情况、错误路径和典型使用场景。使用项目中已有的测试框架和模式。确保测试独立且确定性可重复。',
  'prompt.refactor': '识别可以重构以提升可读性、可维护性或性能的代码。提出具体的改动建议并说明理由。保持现有行为不变——不做功能性变更。优先关注影响最大的改进。',
  // AI Permission Modes
  'Session History': '会话历史',
  'New Session': '新建会话',
  'Copy Conversation': '拷贝对话',
  'Show All': '全部展示',
  'Hide Tools': '隐藏工具',
  'Hide Tools & Think': '隐藏工具和思考',
  'Plan': '计划',
  'Edit': '编辑',
  'Bypass': '绕过',
  'Copy install command': '复制安装命令',
  // AI Result status
  'Aborted': '已中止',
  'Max tokens reached': '已达到最大 token 数',
  'Execution failed': '执行失败',
  'Agent': '智能体',
  // AI AskUserQuestion card
  'AI has a question': 'AI 有一个问题',
  'Submit': '提交',
  'multi-select': '可多选',
  // AI ExitPlanMode card
  'Plan Ready': '计划已就绪',
  'Hold {key} + click to annotate': '按住 {key} 点击可批注',
  'Click to restore pet': '点击恢复宠物',
  'Write annotation, Enter to confirm...': '输入批注，Enter 确认...',
  'Clear & Execute': '新会话执行',
  'Clear & Execute Tooltip': '以全新会话、干净上下文执行修改',
  'Switch Model': '切换执行模型',
  'Send Feedback': '发送反馈',
  'Feedback for revision (optional)': '修改建议（可选）',
  // AI Todo list
  'Tasks': '任务列表',
  // AI Revert/Fork popover
  'Revert conversation & code': '回退对话和代码',
  'Revert conversation only': '仅回退对话',
  'Fork to new session': 'fork 到新会话',
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
      if (lang === 'en') return EN_MAP[key] || key
      return ZH_MAP[key] || EN_MAP[key] || key
    },
    [lang],
  )

  return React.createElement(I18nContext.Provider, { value: { lang, setLang, t } }, children)
}

export function useI18n() {
  return useContext(I18nContext)
}
