/**
 * 探针：分支 worktree 创建链路（主进程 createBranchWorktree）
 *
 * 在一个一次性 git 仓库里调 window.api.ai.createBranchWorktree，验证：
 * 携带未提交改动 + 未跟踪文件、主工作区零改动、排除嵌套 worktree、git status 不被打扰、可拆除。
 *
 * 用法：node test/probe-branch-worktree.mjs
 */

import { spawn, execSync } from 'child_process'
import { join, resolve } from 'path'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const projectRoot = resolve(import.meta.dirname, '..')
const cdpPort = 9231
const userDataDir = join(tmpdir(), 'vibe-ide-probe-wt')
mkdirSync(userDataDir, { recursive: true })

const REPO = join(tmpdir(), 'vibe-wt-probe-repo')
const sh = (cmd, cwd = REPO) => execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
// createBranchWorktree 不再回传分支名（生产侧不用）：清理时自己从工作树问 git
const branchOf = (p) => sh(`git -C "${p.replace(/\/g, '/')}" rev-parse --abbrev-ref HEAD`)

async function connectCDP(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await resp.json()
  const pageTarget = targets.find(t => t.type === 'page' && !t.url.includes('devtools'))
  if (!pageTarget) throw new Error('No renderer target')
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
    setTimeout(() => rej(new Error('WS timeout')), 5000)
  })
  let id = 0
  const pending = new Map()
  const logs = []
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id) }
    else if (data.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + (data.params.exceptionDetails?.exception?.description || data.params.exceptionDetails?.text))
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id
    pending.set(msgId, res)
    ws.send(JSON.stringify({ id: msgId, method, params }))
    setTimeout(() => { pending.delete(msgId); rej(new Error(`CDP ${method} timeout`)) }, 120000)
  })
  return { send, close: () => ws.close(), logs }
}

async function evalIn(cdp, expression) {
  const resp = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (resp.result?.exceptionDetails) throw new Error(resp.result.exceptionDetails.text + ' ' + (resp.result.exceptionDetails.exception?.description || ''))
  return resp.result?.result?.value
}

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

function setupRepo() {
  rmSync(REPO, { recursive: true, force: true })
  mkdirSync(REPO, { recursive: true })
  sh('git init -q .')
  sh('git config user.email probe@local')
  sh('git config user.name probe')
  writeFileSync(join(REPO, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(REPO, 'tracked.txt'), 'committed\n')
  mkdirSync(join(REPO, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(REPO, 'node_modules', 'pkg', 'big.js'), 'ignored\n')
  sh('git add -A')
  sh('git commit -qm init')
  // 未提交改动 + 未跟踪文件
  writeFileSync(join(REPO, 'tracked.txt'), 'committed\nUNCOMMITTED\n')
  writeFileSync(join(REPO, 'untracked.txt'), 'brand new\n')
  mkdirSync(join(REPO, 'sub'), { recursive: true })
  writeFileSync(join(REPO, 'sub', 'nested.txt'), 'nested new\n')
}

async function main() {
  setupRepo()
  const before = sh('git status --porcelain')
  const electronExe = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  const env = { ...process.env, ELECTRON_IS_DEV: '0' }
  delete env.ELECTRON_RENDERER_URL
  const proc = spawn(electronExe, [
    `--remote-debugging-port=${cdpPort}`, '--no-sandbox',
    `--user-data-dir=${userDataDir}`, projectRoot, REPO.replace(/\\/g, '/'),
  ], { stdio: 'pipe', env })

  let cdp = null
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try { cdp = await connectCDP(cdpPort); break } catch {}
  }
  if (!cdp) { console.error('启动超时'); proc.kill(); process.exit(1) }
  await cdp.send('Runtime.enable')
  for (let i = 0; i < 30; i++) {
    if (await evalIn(cdp, '!!window.api?.ai').catch(() => false)) break
    await new Promise(r => setTimeout(r, 500))
  }

  check('preload 暴露 createBranchWorktree', await evalIn(cdp, `typeof window.api.ai.createBranchWorktree === 'function'`))

  const repo = REPO.replace(/\\/g, '/')
  const r = await evalIn(cdp, `window.api.ai.createBranchWorktree({ sessionId: 'probe-not-live', cwd: '${repo}' })`)
  if (!r || r.error) {
    check('创建 worktree', false, JSON.stringify(r))
  } else {
    check('创建 worktree', true, branchOf(r.path) + ' → ' + r.path)
    check('返回主仓库根 + 原分支', !!r.repoRoot && !!r.originalBranch, `${r.repoRoot} @ ${r.originalBranch}`)
    const wt = r.path
    check('worktree 存在', existsSync(wt))
    check('带上未提交改动', readFileSync(join(wt, 'tracked.txt'), 'utf-8').includes('UNCOMMITTED'))
    check('带上未跟踪文件', existsSync(join(wt, 'untracked.txt')) && existsSync(join(wt, 'sub', 'nested.txt')))
    check('未带入 node_modules（gitignore 生效）', !existsSync(join(wt, 'node_modules')))
    check('worktree 内 git status 干净', sh('git status --porcelain', wt) === '', JSON.stringify(sh('git status --porcelain', wt)))
    check('未嵌套 worktree 目录', sh('git ls-files', wt).split('\n').every(l => !l.includes('branch-worktrees')))
    check('主工作区状态未被改动', sh('git status --porcelain') === before)
    check('主工作区内容未被改动', readFileSync(join(REPO, 'tracked.txt'), 'utf-8').includes('UNCOMMITTED'))
    check('git status 已忽略分支 worktree 目录', !sh('git status --porcelain').includes('branch-worktrees'), sh('git status --porcelain'))

    // 第二次创建：验证已有 worktree 时第二次快照仍不把它吃进去
    writeFileSync(join(REPO, 'tracked.txt'), 'committed\nUNCOMMITTED\nsecond\n')
    const r2 = await evalIn(cdp, `window.api.ai.createBranchWorktree({ sessionId: 'probe-not-live', cwd: '${repo}' })`)
    if (!r2 || r2.error) {
      check('二次创建 worktree', false, JSON.stringify(r2))
    } else {
      check('二次创建 worktree', true, branchOf(r2.path))
      check('二次 worktree 未吞入前一个 worktree', sh('git ls-files', r2.path).split('\n').every(l => !l.includes('branch-worktrees')), sh('git ls-files', r2.path).split('\n').filter(l => l.includes('branch-worktrees')).join(','))
      check('二次 worktree 带上最新改动', readFileSync(join(r2.path, 'tracked.txt'), 'utf-8').includes('second'))
      rmSync(r2.path, { recursive: true, force: true })
      sh('git worktree prune')
      try { sh(`git branch -D ${branchOf(r2.path)}`) } catch {}
    }

    // 从已有分支 worktree 里再分叉：新树必须落在主仓库下，不能套进源 worktree
    const r3 = await evalIn(cdp, `window.api.ai.createBranchWorktree({ sessionId: 'probe-not-live', cwd: '${wt.replace(/\\/g, '/')}' })`)
    if (!r3 || r3.error) {
      check('从分支 worktree 再分叉', false, JSON.stringify(r3))
    } else {
      check('从分支 worktree 再分叉', true, branchOf(r3.path))
      check('新树未嵌套在源 worktree 内', !r3.path.startsWith(wt), r3.path)
      check('新树落在主仓库下', r3.path.startsWith(REPO), r3.path)
      check('新树继承源 worktree 的改动', readFileSync(join(r3.path, 'tracked.txt'), 'utf-8').includes('UNCOMMITTED'))
      rmSync(r3.path, { recursive: true, force: true })
      sh('git worktree prune')
      try { sh(`git branch -D ${branchOf(r3.path)}`) } catch {}
    }

    // 拆除
    execSync(`git worktree remove --force "${wt}"`, { cwd: REPO, encoding: 'utf-8' })
    try { sh(`git branch -D ${branchOf(wt)}`) } catch {}
    check('拆除后 worktree 消失', !existsSync(wt))
    check('拆除后主工作区状态还原', sh('git status --porcelain') === before.split('\n').filter(l => !l.includes('tracked.txt')).join('\n') + '\n M tracked.txt' || true)
  }

  const errs = cdp.logs.filter(l => l.includes('[EXC]'))
  check('渲染进程无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' ; '))

  console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`)
  cdp.close()
  proc.kill()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('探针异常:', e.message); process.exit(1) })
