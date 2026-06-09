import { loader } from '@monaco-editor/react'
import { registerMonacoThemes } from '@renderer/themes/monaco-themes'

let monacoPromise: Promise<any> | null = null

export function getMonaco(): Promise<any> {
  if (!monacoPromise) {
    monacoPromise = loader.init().then(monaco => {
      registerMonacoThemes(monaco)
      return monaco
    })
  }
  return monacoPromise
}
