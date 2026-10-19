import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileMatchPicker } from '../FileMatchPicker'
import { resolveAndOpenFile } from '../../utils/filePathOpen'

// 路径文本 → 打开文件：与终端共用 resolveAndOpenFile（读文件校验 + 裸名递归搜索），
// 多命中复用同一个选择器。AiTab 正文点击与工具卡片回形针共用本 hook。
export function useOpenPath(
  workspacePath: string | null,
  onOpenFile?: (fullPath: string, lineNumber?: number) => void
) {
  const [picker, setPicker] = useState<{ matches: string[]; lineNumber?: number } | null>(null)
  const onOpenFileRef = useRef(onOpenFile)
  onOpenFileRef.current = onOpenFile
  const workspacePathRef = useRef(workspacePath)
  workspacePathRef.current = workspacePath

  const openPath = useCallback((rawText: string) => {
    const cwd = workspacePathRef.current
    const open = onOpenFileRef.current
    if (!cwd || !open || !rawText) return
    resolveAndOpenFile(rawText, cwd, open, (matches, lineNumber) => setPicker({ matches, lineNumber }))
  }, [])

  // portal 的事件在 React 树上仍冒泡到宿主（如工具卡片根节点的展开/收起 handler），
  // 包一层吞掉，避免选择文件时顺带切换卡片展开态
  const pickerNode = picker
    ? createPortal(
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <FileMatchPicker
            matches={picker.matches}
            lineNumber={picker.lineNumber}
            cwd={workspacePath}
            onSelect={(fullPath, lineNumber) => onOpenFileRef.current?.(fullPath, lineNumber)}
            onClose={() => setPicker(null)}
          />
        </div>,
        document.body
      )
    : null

  return { openPath, pickerNode }
}
