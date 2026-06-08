// After electron-builder finishes, copy the platform deps (web-tree-sitter etc)
// into the unpacked codegraph bundle's lib/node_modules/ directory.
// The CLI uses ESM imports which ignore NODE_PATH, so the deps must be
// physically present under lib/ for the import resolver to find them.
const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '..', 'dist', 'win-unpacked')
const resourcesDir = path.join(distDir, 'resources')

// Find the unpacked codegraph platform bundle (nested layout)
const platformBundle = path.join(
  resourcesDir,
  'app.asar.unpacked',
  'node_modules',
  '@colbymchenry',
  'codegraph',
  'node_modules',
  '@colbymchenry',
  'codegraph-win32-x64'
)

const platformDeps = path.join(resourcesDir, 'codegraph-platform-deps')

if (!fs.existsSync(platformBundle)) {
  console.error('fix-codegraph-deps: platform bundle not found at', platformBundle)
  process.exit(1)
}
if (!fs.existsSync(platformDeps)) {
  console.error('fix-codegraph-deps: platform deps not found at', platformDeps)
  process.exit(1)
}

const targetDir = path.join(platformBundle, 'lib', 'node_modules')

// Copy deps into lib/node_modules/ (merge, not overwrite existing)
fs.mkdirSync(targetDir, { recursive: true })

for (const entry of fs.readdirSync(platformDeps)) {
  const src = path.join(platformDeps, entry)
  const dest = path.join(targetDir, entry)
  if (!fs.existsSync(dest)) {
    fs.cpSync(src, dest, { recursive: true })
    console.log('  copied', entry)
  }
}

console.log('fix-codegraph-deps: platform deps restored to lib/node_modules/')