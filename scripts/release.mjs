import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const noAi = argv.includes('--no-ai')
const kind = argv.find(a => ['patch', 'minor', 'major', 'current'].includes(a)) || 'patch'

const C = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`
}

function fail(msg) {
  console.error(C.red(`✖ ${msg}`))
  process.exit(1)
}

function git(argvList, opts = {}) {
  return execFileSync('git', argvList, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 64 << 20, ...opts }).trim()
}

function bump(version, type) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (type === 'major') return `${major + 1}.0.0`
  if (type === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function parseTag(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag)
  return m ? m.slice(1).map(Number) : null
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

function remoteTags() {
  try {
    return new Set(
      git(['ls-remote', '--tags', 'origin'])
        .split('\n')
        .map(l => l.split('refs/tags/')[1])
        .filter(Boolean)
        .map(t => t.replace(/\^\{\}$/, ''))
    )
  } catch {
    fail('读取远端 tag 失败（git ls-remote）')
  }
}

function pickPrevTag(nextVersion, remote) {
  const next = parseTag(nextVersion)
  const byVersion = new Map()
  for (const raw of git(['tag', '--list']).split('\n')) {
    const tag = raw.trim()
    if (!tag) continue
    const v = parseTag(tag)
    if (!v || cmp(v, next) >= 0) continue
    const key = v.join('.')
    const cur = byVersion.get(key)
    if (!cur || (remote.has(tag) && !remote.has(cur))) byVersion.set(key, tag)
  }
  const versions = [...byVersion.keys()].sort((a, b) => cmp(parseTag(a), parseTag(b)))
  const published = versions.filter(k => remote.has(byVersion.get(k)))
  const keys = published.length ? published : versions
  if (!keys.length) return null
  return byVersion.get(keys[keys.length - 1])
}

function tagBody(tag) {
  if (!tag) return ''
  try {
    if (git(['cat-file', '-t', tag]) !== 'tag') return ''
    return git(['tag', '-l', '--format=%(contents)', tag])
  } catch {
    return ''
  }
}

function groupFallback(commitList) {
  const buckets = new Map()
  for (const line of commitList.filter(Boolean)) {
    const m = /^(\S+) (.*)$/.exec(line)
    if (!m) continue
    const [, hash, subject] = m
    const t = /^(feat|fix|perf|chore|uiux|docs|refactor|style|test)\b/i.exec(subject)
    const key = t ? t[1].toLowerCase() : 'other'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(`- ${subject}（\`${hash}\`）`)
  }
  return ['feat', 'fix', 'perf', 'uiux', 'refactor', 'style', 'chore', 'docs', 'test', 'other']
    .filter(k => buckets.has(k))
    .map(k => `## ${k}\n${buckets.get(k).join('\n')}`)
    .join('\n\n')
}

function buildPrompt({ from, to, commits, stat, sample }) {
  return [
    '你是 Vibe IDE（Electron + React 桌面 IDE）的发布日志撰写者。根据下面的 git 信息写一份中文 release notes。',
    '所有需要的信息都已经在下面的提示里，**不要调用任何工具、不要读文件、不要执行命令**，直接输出结果。',
    '',
    `版本：${from || '首个版本'} → ${to}`,
    '',
    '## 风格要求',
    '- 第一行标题：`# A → B 修改总结`（A 是上个版本号，没有就写「首个版本」）',
    '- 标题下写一行「时间跨度：YYYY-MM-DD ~ MM-DD，共 N 个提交」',
    '- 正文按主题拆成若干个 `## 中文主题` 小节，每节 1-4 条要点',
    '- 要点格式：`- **改了什么**（`hash`）：为什么 / 影响`，hash 用 7-8 位短 hash',
    '- 重点修复的加小节标题后缀「（重点修复）」',
    '- 零散的 uiux / chore / 样式微调合并成一条，不要逐条罗列',
    '- 结尾加一段加粗的「主线脉络」总结这一轮的主线',
    '- 只依据给出的提交写，不要编造；中文',
    '',
    '## 输出格式（严格遵守）',
    '只输出下面两行标记之间的内容，标记之外的任何文字都不要：',
    '<<<NOTES>>>',
    '<你的 release notes markdown，不要代码块围栏>',
    '<<<END>>>',
    '',
    sample ? `## 上一版正文（照这个风格写）\n${sample}` : '',
    '## 提交列表（hash 日期 主题 + 文件变更）',
    commits,
    '',
    '## 改动统计',
    stat
  ]
    .filter(Boolean)
    .join('\n')
}

function extractNotes(text) {
  const s = text.trim()
  const marked = /<<<NOTES>>>([\s\S]*?)<<<END>>>/.exec(s)
  const body = (marked ? marked[1] : s).trim()
  const m = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(body)
  return (m ? m[1] : body).trim()
}

const TOOL_CALL = /<\/?tool_call|<arg_value>|<closing>|<think>/i

function aiNotes(prompt) {
  const out = execSync('claude -p --output-format text --no-session-persistence', {
    input: prompt,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: tmpdir(),
    maxBuffer: 16 << 20,
    timeout: 10 * 60 * 1000
  })
  const notes = extractNotes(out)
  if (TOOL_CALL.test(notes)) throw new Error('模型尝试调用工具（输出含 tool_call 片段），重试或加 --no-ai')
  if (!notes.startsWith('#')) throw new Error('输出不像 release notes（缺少一级标题）')
  return notes
}

if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('请在 main 分支上发布')
if (!dryRun && git(['status', '--porcelain'])) fail('工作区不干净，先提交或 stash')

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const currentVersion = pkg.version
const nextVersion = kind === 'current' ? currentVersion : bump(currentVersion, kind)
const tag = `v${nextVersion}`

const remote = remoteTags()
if (remote.has(tag)) {
  if (dryRun) console.warn(C.yellow(`! 远端已存在 tag ${tag}（正式发布会拒绝），dry-run 继续`))
  else fail(`远端已存在 tag ${tag}，请换一个版本号`)
}

const prev = pickPrevTag(nextVersion, remote)
if (prev && !remote.has(prev)) {
  console.warn(C.yellow(`! 上一版 tag ${prev} 不在远端，那一版没发出去；本次日志会把它之后的提交全算进来`))
}

const range = prev ? `${prev}..HEAD` : 'HEAD'
const commits = git(['log', range, '--format=%h %ad %s', '--date=short', '--name-status'])
const stat = git(['diff', '--stat', prev || EMPTY_TREE, 'HEAD'])
const sample = tagBody(prev)
const commitList = git(['log', range, '--format=%h %s']).split('\n').filter(Boolean)
const commitCount = commitList.length

console.log(C.dim(`prev=${prev || '(none)'} next=${nextVersion} commits=${commitCount}`))

let notes = ''
if (!noAi) {
  console.log(C.dim('调用 claude 生成更新日志…'))
  try {
    notes = aiNotes(buildPrompt({ from: prev ? prev.replace(/^v/, '') : '', to: nextVersion, commits, stat, sample }))
  } catch (e) {
    console.error(C.red(`✖ claude 生成失败：${e.message}`))
    console.error(C.dim('  可加 --no-ai 退化为提交清单'))
    process.exit(1)
  }
}
if (!notes) {
  notes = `# ${prev ? prev.replace(/^v/, '') + ' → ' : ''}${nextVersion} 修改总结\n\n${groupFallback(commitList)}`
}
if (!notes.trim()) fail('生成的日志为空')

if (dryRun) {
  console.log(`\n${notes}\n`)
  console.log(C.dim('--dry-run：未修改任何文件'))
  process.exit(0)
}

if (kind !== 'current') {
  execSync(`npm version ${kind} --no-git-tag-version`, { stdio: 'inherit' })
}

const notesFile = join(git(['rev-parse', '--absolute-git-dir']), 'vibe-release-notes.md')
writeFileSync(notesFile, `${notes}\n`)

if (git(['tag', '--list', tag])) {
  console.log(C.yellow(`! 本地已有未发布的 tag ${tag}，替换`))
  git(['tag', '-d', tag])
}

if (kind !== 'current') git(['commit', '-am', nextVersion])
git(['tag', '-a', tag, '-F', notesFile, '--cleanup=verbatim'])
git(['push', 'origin', 'HEAD'])
git(['push', 'origin', tag])

const repo = git(['remote', 'get-url', 'origin']).replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
console.log(C.green(`✔ 已推送 ${tag}，CI 构建中`))
console.log(C.cyan(`${repo}/actions`))
console.log(C.cyan(`${repo}/releases/tag/${tag}`))
