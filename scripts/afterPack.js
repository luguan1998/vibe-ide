const fs = require('fs')
const path = require('path')

// Keep only these Electron locales
const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])

exports.default = async function (context) {
  const appDir = context.appOutDir

  // Trim Electron locales
  const localesDir = path.join(appDir, 'locales')
  if (fs.existsSync(localesDir)) {
    for (const file of fs.readdirSync(localesDir)) {
      if (!KEEP_LOCALES.has(file)) {
        fs.unlinkSync(path.join(localesDir, file))
      }
    }
  }
}
