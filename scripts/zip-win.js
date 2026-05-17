// Zip dist/win-unpacked into a distributable archive
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')
const version = pkg.version

const unpackedDir = path.join(__dirname, '..', 'dist', 'win-unpacked')
const outputZip = path.join(__dirname, '..', 'dist', `Vibe-IDE-${version}-win-x64.zip`)

if (!fs.existsSync(unpackedDir)) {
  console.error('Error: dist/win-unpacked not found. Run electron-builder first.')
  process.exit(1)
}

// Remove old zip if exists
if (fs.existsSync(outputZip)) {
  fs.unlinkSync(outputZip)
}

console.log(`Packing Vibe-IDE-${version}-win-x64.zip ...`)
try {
  execSync(
    `powershell -Command "Compress-Archive -Path '${unpackedDir}' -DestinationPath '${outputZip}'"`,
    { stdio: 'inherit' }
  )
  console.log(`Done: ${outputZip}`)
} catch (e) {
  console.error('Zip failed:', e.message)
  process.exit(1)
}
