import { loader } from '@monaco-editor/react'
import { registerMonacoThemes } from '@renderer/themes/monaco-themes'
import { registerJSXSupport } from '@renderer/languages/jsx-tokens'
import { registerPythonSupport } from '@renderer/languages/python-tokens'
import { registerShellSupport } from '@renderer/languages/shell-tokens'
import { registerGodotSupport } from '@renderer/languages/godot-tokens'

let monacoPromise: Promise<any> | null = null
let registered = false

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
      }
      return monaco
    })
  }
  return monacoPromise
}
