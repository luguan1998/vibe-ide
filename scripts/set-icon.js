const fs = require('fs')
const path = require('path')
const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit')

const distDir = path.join(__dirname, '..', 'dist', 'win-unpacked')

const exeFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.exe'))
if (exeFiles.length === 0) {
  console.error('No exe found in dist/win-unpacked')
  process.exit(1)
}

const icoPath = path.join(__dirname, '..', 'build', 'icon.ico')
const iconFile = Data.IconFile.from(fs.readFileSync(icoPath))
const iconData = iconFile.icons.map(item => item.data)

for (const exeName of exeFiles) {
  const exePath = path.join(distDir, exeName)
  console.log('Setting icon for:', exeName)

  const exeData = fs.readFileSync(exePath)
  const exe = NtExecutable.from(exeData)
  const res = NtExecutableResource.from(exe)

  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconData)
  res.outputResource(exe)

  const newExe = Buffer.from(exe.generate())
  fs.writeFileSync(exePath, newExe)
}

console.log('Icon set successfully')
