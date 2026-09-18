import { loader } from '@monaco-editor/react'
import { registerMonacoThemes } from '@renderer/themes/monaco-themes'
import { registerJSXSupport } from '@renderer/languages/jsx-tokens'
import { registerPythonSupport } from '@renderer/languages/python-tokens'
import { registerShellSupport } from '@renderer/languages/shell-tokens'
import { registerGodotSupport } from '@renderer/languages/godot-tokens'

let monacoPromise: Promise<any> | null = null
let registered = false

// ts.worker 唯一创建路径是 registerProviders 注册的 adapter（DiagnosticsAdapter 默认开，
// model 一创建即自动触发 validate），且 registerProviders 只在首个 ts/js model 创建时执行一次。
// 此处先行全关 → 无任何 adapter 请求 worker → ts.worker 永不启动（编辑器本体高亮走 Monarch 主线程，不受影响）。
// 必须早于任何 ts/js model 创建；之后再调用不会重注册 provider，反而触发 worker 重建。
function disableTsLanguageServices(monaco: any): void {
  const off = {
    completionItems: false, hovers: false, documentSymbols: false, definitions: false,
    references: false, documentHighlights: false, rename: false, diagnostics: false,
    documentRangeFormattingEdits: false, signatureHelp: false, onTypeFormattingEdits: false,
    codeActions: false, inlayHints: false,
  }
  monaco.languages.typescript.typescriptDefaults.setModeConfiguration(off)
  monaco.languages.typescript.javascriptDefaults.setModeConfiguration(off)
}

export function getMonaco(): Promise<any> {
  if (!monacoPromise) {
    monacoPromise = loader.init().then(monaco => {
      if (!registered) {
        registered = true
        registerMonacoThemes(monaco)
        registerJSXSupport(monaco)
        registerPythonSupport(monaco)
        registerShellSupport(monaco)
        registerGodotSupport(monaco)
        disableTsLanguageServices(monaco)
      }
      return monaco
    })
  }
  return monacoPromise
}
