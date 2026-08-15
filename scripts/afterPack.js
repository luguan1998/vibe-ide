const fs = require('fs')
const path = require('path')
const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit')

const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])

function removeFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      removeFiles(fullPath, predicate)
    } else if (predicate(entry.name)) {
      fs.unlinkSync(fullPath)
    }
  }
}

function setExeMetadata(exePath) {
  const exeData = fs.readFileSync(exePath)
  const exe = NtExecutable.from(exeData)
  const res = NtExecutableResource.from(exe)

  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico')
  if (fs.existsSync(icoPath)) {
    const iconFile = Data.IconFile.from(fs.readFileSync(icoPath))
    Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconFile.icons.map(item => item.data))
  }

  const viList = Resource.VersionInfo.fromEntries(res.entries)
  if (viList.length > 0) {
    const vi = viList[0]
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      'CompanyName': 'Vibe IDE',
      'FileDescription': 'Vibe IDE',
      'ProductName': 'Vibe IDE',
      'InternalName': 'Vibe IDE',
      'OriginalFilename': 'Vibe IDE.exe',
    })
    vi.outputToResourceEntries(res.entries)
  }

  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
}

function patchExeDir(exeDir) {
  const exeFiles = fs.readdirSync(exeDir).filter(f => f.endsWith('.exe') && !f.endsWith('.exe.test'))
  for (const exeName of exeFiles) {
    setExeMetadata(path.join(exeDir, exeName))
  }
}

exports.default = async function (context) {
  const appDir = context.appOutDir

  // Windows-only: embed icon + PE metadata, copy context-menu bats
  if (process.platform === 'win32') {
    patchExeDir(appDir)

    // Copy context-menu register/unregister bats next to the exe so the
    // portable 7z build can run them (they locate the exe via %~dp0).
    for (const name of ['register-context-menu.bat', 'unregister-context-menu.bat']) {
      const src = path.join(__dirname, '..', 'build', name)
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(appDir, name))
    }
  }

  // Keep only en-US.pak + zh-CN.pak
  const localesDir = path.join(appDir, 'locales')
  if (fs.existsSync(localesDir)) {
    for (const file of fs.readdirSync(localesDir)) {
      if (!KEEP_LOCALES.has(file)) {
        fs.unlinkSync(path.join(localesDir, file))
      }
    }
  }

  // tesseract.js-core ships 4 WASM variants — only tesseract-core.* is needed
  const tessCoreDir = path.join(appDir, 'resources', 'app.asar.unpacked', 'node_modules', 'tesseract.js-core')
  if (fs.existsSync(tessCoreDir)) {
    for (const file of fs.readdirSync(tessCoreDir)) {
      if (
        file.startsWith('tesseract-core-simd') ||
        file.startsWith('tesseract-core-lstm') ||
        file === 'tesseract-core.asm.js'
      ) {
        fs.unlinkSync(path.join(tessCoreDir, file))
      }
    }
  }
}
