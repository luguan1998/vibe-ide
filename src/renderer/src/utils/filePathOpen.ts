import { parseFilePath, isBareFilename } from './filePathUtils'
import { loadFilterRules } from './fileFilter'

/**
 * 解析路径文本并尝试打开文件
 * - 先用 parseFilePath 解析
 * - 直接读文件，成功则跳转
 * - 若失败且原始文本是裸文件名，递归搜索 cwd 子目录
 * - 搜索唯一匹配则跳转，否则静默失败
 */
export async function resolveAndOpenFile(
  rawText: string,
  cwd: string,
  onOpenFile: (fullPath: string, lineNumber?: number) => void,
  onMultipleMatches?: (matches: string[], lineNumber?: number) => void
): Promise<boolean> {
  const parsed = parseFilePath(rawText, cwd)
  if (!parsed) return false

  // 尝试直接读文件验证路径存在
  try {
    const result = await window.api.file.read(parsed.fullPath)
    if (!result.error) {
      onOpenFile(parsed.fullPath, parsed.lineNumber)
      return true
    }
    // 文件存在但不可读（超大/二进制）→ 仍打开，DiffViewer 会展示 Force Open 按钮
    if (result.error.startsWith('File too large') || result.error === 'Cannot display binary file') {
      onOpenFile(parsed.fullPath, parsed.lineNumber)
      return true
    }
  } catch {
    // 读失败，继续尝试搜索
  }

  // 直接路径不存在 → 检查是否为裸文件名，递归搜索
  // 从 parseFilePath 已清理的 fullPath 中提取文件名，避免 rawText 尾部标点干扰搜索
  const cleanFileName = parsed.fullPath.split(/[\\\/]/).pop() || ''

  if (isBareFilename(cleanFileName) && cwd) {
    try {
      const findResult = await window.api.file.find(cwd, cleanFileName, loadFilterRules())
      if (findResult.matches) {
        if (findResult.matches.length === 1) {
          onOpenFile(findResult.matches[0], parsed.lineNumber)
          return true
        }
        if (findResult.matches.length >= 2) {
          onMultipleMatches?.(findResult.matches, parsed.lineNumber)
          return true
        }
      }
    } catch {
      // find 不可用（例如 preload 未更新），静默失败
    }
  }

  return false
}
