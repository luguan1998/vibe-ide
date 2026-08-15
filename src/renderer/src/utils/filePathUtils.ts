// Shared file path detection — used by both TerminalView link provider and
// AiTab markdown click handler to avoid duplicating detection logic.

// 支持的文件扩展名（可编辑）
const EDITABLE_EXTENSIONS = new Set([
  'txt', 'c', 'py', 'ts', 'tsx', 'js', 'jsx', 'md', 'json', 'html', 'htm',
  'css', 'yaml', 'yml', 'sh', 'bash', 'bat', 'cmd', 'sql', 'log', 'xml',
  'toml', 'ini', 'env', 'rs', 'go', 'java', 'cpp', 'h', 'hpp', 'cs', 'rb',
  'php', 'swift', 'kt', 'vue', 'svelte', 'scss', 'less', 'dockerfile',
  'gitignore', 'cfg', 'conf', 'makefile', 'r', 'm', 'scala', 'clj', 'lua',
  'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'vim', 'editorconfig', 'eslintrc',
  'prettierrc', 'lock', 'gradle', 'properties', 'ps1', 'vbs', 'wren'
])

// Windows 绝对路径: E:\path\file.txt 或 E:/path/file.txt (无空格，空格走引号路径)
// Unix 绝对路径: /home/user/file.ts
// 相对路径: src/file.ts 或 ./src/file.ts 或 ../src/file.ts
// 引号路径: "C:\path with spaces\file.ts" 或 '/home/user/file.ts'
// 支持行号: file.ts:10  支持行:列: file.ts:10:20
const WINDOWS_ABS_PATH = /[A-Za-z]:[\\\/][^\s:*?"<>|\r\n]+/
const UNIX_ABS_PATH = /\/[^\s:*?"<>|\r\n]+\.[a-zA-Z0-9]+/
const RELATIVE_PATH = /(?:\.{1,2}[\\\/]|[a-zA-Z0-9_])[a-zA-Z0-9_\-.\\\/]*[a-zA-Z0-9_\-.]+/
const QUOTED_PATH = /['"]([^'"\r\n]+?)['"]/
const LINE_NUMBER = /:\d+(?::\d+)?/

// 组合正则：匹配路径（可选带行号列号）
export const FILE_PATH_REGEX = new RegExp(
  `(?:${QUOTED_PATH.source}|${WINDOWS_ABS_PATH.source}|${UNIX_ABS_PATH.source}|${RELATIVE_PATH.source})(${LINE_NUMBER.source})?`,
  'g'
)

/**
 * 解析路径文本，提取文件路径和行号
 * @param pathText 原始路径文本（可能带引号、行号:10、行:列:10:20）
 * @param cwd 当前工作目录（用于相对路径）
 * @returns { fullPath, lineNumber } 或 null（如果无效）
 */
export function parseFilePath(pathText: string, cwd: string): { fullPath: string; lineNumber?: number } | null {
  // 提取行号（如果有）:10 或 :10:20（列号解析但不使用，仅防破坏匹配）
  let lineNumber: number | undefined
  let pathPart = pathText

  const lineMatch = pathText.match(/:(\d+)(?::(\d+))?$/)
  if (lineMatch) {
    lineNumber = parseInt(lineMatch[1], 10)
    pathPart = pathText.slice(0, pathText.length - lineMatch[0].length)
  }

  // 去除首尾引号（含中英文半全角：'' "" ＂＇ "" ''）
  pathPart = pathPart.replace(/^[''＇"'""]|[''＇"'""]$/g, '')

  // 剥离尾部标点（终端输出中常紧跟文件路径后，导致扩展名检测失败）
  // 覆盖半角: , ; : ! ? ) ] } > .  全角: 。 ， 、 ； ： ！ ？ ） ］ ｝ 》 〉 】 」 』
  pathPart = pathPart.replace(/[,;:!?\)\]\}>\.。，、；：！？）］｝》〉】」』]+$/g, '')

  // 检查扩展名是否支持
  const extMatch = pathPart.match(/\.(?:([a-zA-Z0-9]+)|([a-zA-Z0-9]+\.[a-zA-Z0-9]+))$/)
  if (!extMatch) return null

  const ext = extMatch[1] || extMatch[2]?.split('.').pop()?.toLowerCase()
  if (!ext || !EDITABLE_EXTENSIONS.has(ext.toLowerCase())) return null

  // 判断是绝对路径还是相对路径
  const isWinAbsolute = /^[A-Za-z]:[\\\/]/.test(pathPart)
  const isUnixAbsolute = /^\//.test(pathPart)

  let fullPath: string
  if (isWinAbsolute) {
    fullPath = pathPart
  } else if (isUnixAbsolute) {
    fullPath = pathPart
  } else if (cwd) {
    fullPath = cwd.replace(/\\/g, '/') + '/' + pathPart.replace(/\\/g, '/')
  } else {
    return null
  }

  // 统一路径分隔符（Windows 使用反斜杠）
  fullPath = fullPath.replace(/\//g, '\\')

  return { fullPath, lineNumber }
}

/**
 * 判断是否裸文件名（无目录分隔符、无盘符）
 */
export function isBareFilename(text: string): boolean {
  return !/[\\\/]/.test(text) && !/^[A-Za-z]:/.test(text)
}

/**
 * 相对路径 → 绝对路径（codegraph/grep 返回的相对路径统一转换）
 * 已是绝对路径（盘符或 / 开头）则原样返回
 */
export function resolveAbsPath(rel: string, cwd?: string): string {
  if (!cwd) return rel
  if (rel.startsWith('/') || /^[A-Za-z]:[\\\/]/.test(rel)) return rel
  const sep = cwd.includes('\\') ? '\\' : '/'
  return cwd + sep + rel.replace(/\//g, sep)
}
