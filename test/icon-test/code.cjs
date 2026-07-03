const fs = require('fs')
const path = require('path')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function joinDir(base, ...parts) {
  return path.join(base, ...parts)
}

function walk(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, list)
    else list.push(full)
  }
  return list
}

module.exports = { readJson, joinDir, walk }
