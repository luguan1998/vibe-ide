const fs = require('fs')
const path = require('path')

const helper = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
if (process.platform !== 'win32' && fs.existsSync(helper)) {
  fs.chmodSync(helper, 0o755)
}
