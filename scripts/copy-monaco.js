const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs')
const dest = path.join(__dirname, '..', 'out', 'renderer', 'monaco', 'vs')

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name)
    const d = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d)
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

copyDir(src, dest)
console.log('Monaco Editor files copied to out/renderer/monaco/vs')
