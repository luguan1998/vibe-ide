// Patch @colbymchenry/codegraph-<platform>-<arch>/lib/package.json so
// electron-builder includes lib/node_modules (contains web-tree-sitter et al).
// The upstream lib/package.json has "files": ["dist", "scripts", "README.md"]
// which causes electron-builder to skip lib/node_modules, breaking the packaged
// app.  This script adds "node_modules" to that files array.
const fs = require('fs')
const path = require('path')

const target = process.platform + '-' + process.arch
const pkgJsonPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@colbymchenry',
  'codegraph-' + target,
  'lib',
  'package.json'
)

try {
  const json = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  if (!json.files) {
    json.files = []
  }
  if (!json.files.includes('node_modules')) {
    json.files.push('node_modules')
    fs.writeFileSync(pkgJsonPath, JSON.stringify(json, null, 2) + '\n')
    console.log('codegraph: patched lib/package.json to include node_modules')
  }
} catch (e) {
  if (e.code !== 'ENOENT') console.error('codegraph patch warning:', e.message)
}
