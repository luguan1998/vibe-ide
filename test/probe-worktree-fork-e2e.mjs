/**
 * 探针：分叉到 worktree 的端到端链路（用真 CLI）
 *
 * 按生产路径走一遍：真 CLI 在临时仓库建会话 → 应用 IPC 建 worktree →
 * 应用 forkTurn IPC（sourceCwd=仓库 / targetCwd=worktree）→ 真 CLI 在 worktree 里 --resume →
 * sessionGraph 跨项目目录合并出分叉，worktree 分支另有起点节点（源轮次留在原路径）。
 *
 * 会在 ~/.claude/projects 下产生两条临时项目目录，结束前删除。
 * 用法：node test/probe-worktree-fork-e2e.mjs
 */

import { spawn, execSync } from 'child_process'
import { join, resolve } from 'path'
import { mkdirSync, rmSync, readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'

const projectRoot = resolve(import.meta.dirname, '..')
const cdpPort = 9235
const userDataDir = join(tmpdir(), 'vibe-ide-probe-e2e')
mkdirSync(userDataDir, { recursive: true })

const REPO = join(tmpdir(), 'vibe-e2e-repo')
const PROJECTS = 'C:/Users/luguan/.claude/projects'
const sh = (cmd, cwd = REPO) => execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

const created = []
function cleanup() {
  for (const p of created) { try { rmSync(p, { recursive: true, force: true }) } catch {} }
  try { rmSync(REPO, { recursive: true, force: true }) } catch {}
}

async function connectCDP(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await resp.json()
  const pageTarget = targets.find(t => t.type === 'page' && !t.url.includes('devtools'))
  if (!pageTarget) throw new Error('No renderer target')
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('WS timeout')), 5000) })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id) }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id
    pending.set(msgId, res)
    ws.send(JSON.stringify({ id: msgId, method, params }))
    setTimeout(() => { pending.delete(msgId); rej(new Error(`CDP ${method} timeout`)) }, 180000)
  })
  return { send, close: () => ws.close() }
}

async function evalIn(cdp, expression) {
  const resp = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (resp.result?.exceptionDetails) throw new Error(resp.result.exceptionDetails.text + ' ' + (resp.result.exceptionDetails.exception?.description || ''))
  return resp.result?.result?.value
}

// Windows 上 claude 是 npm 的 .cmd shim，execFile 解析不到，必须走 shell
function claude(args, cwd, timeout = 180000) {
  const cmd = ['claude', ...args.map(a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(' ')
  return execSync(cmd, { cwd, encoding: 'utf-8', timeout, stdio: 'pipe' })
}

function dirsNewerThan(ms) {
  return readdirSync(PROJECTS).filter(n => {
    try { return readdirSync(join(PROJECTS, n)).some(f => f.endsWith('.jsonl')) && statSync(join(PROJECTS, n)).mtimeMs > ms } catch { return false }
  })
}

async function main() {
  const startedAt = Date.now()
  rmSync(REPO, { recursive: true, force: true })
  mkdirSync(REPO, { recursive: true })
  sh('git init -q .')
  sh('git config user.email probe@local')
  sh('git config user.name probe')
  execSync('echo hello > a.txt', { cwd: REPO, shell: 'cmd.exe' })
  sh('git add -A')
  sh('git commit -qm init')

  console.log('→ 用真 CLI 在临时仓库建会话...')
  claude(['-p', 'say alpha', '--output-format', 'json'], REPO)
  const repoDirs = dirsNewerThan(startedAt)
  const repoDir = repoDirs.find(d => d.toLowerCase().includes('vibe-e2e-repo') && !d.toLowerCase().includes('branch-worktrees'))
  if (!repoDir) { check('CLI 在仓库目录建会话', false, repoDirs.join(',')); cleanup(); process.exit(1) }
  check('CLI 在仓库目录建会话', true, repoDir)
  created.push(join(PROJECTS, repoDir))
  const srcFile = readdirSync(join(PROJECTS, repoDir)).find(f => f.endsWith('.jsonl'))
  const srcId = srcFile.replace(/\.jsonl$/, '')
  const srcLines = readFileSync(join(PROJECTS, repoDir, srcFile), 'utf-8').split('\n').filter(Boolean)
  check('源会话有 user turn', srcLines.some(l => { try { const o = JSON.parse(l); return o.type === 'user' && typeof o.message?.content === 'string' && o.message.content.includes('alpha') } catch { return false } }))

  const electronExe = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  const env = { ...process.env, ELECTRON_IS_DEV: '0' }
  delete env.ELECTRON_RENDERER_URL
  const proc = spawn(electronExe, [`--remote-debugging-port=${cdpPort}`, '--no-sandbox', `--user-data-dir=${userDataDir}`, projectRoot, REPO.replace(/\\/g, '/')], { stdio: 'pipe', env })
  let cdp = null
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try { cdp = await connectCDP(cdpPort); break } catch {}
  }
  if (!cdp) { console.error('启动超时'); proc.kill(); cleanup(); process.exit(1) }
  await cdp.send('Runtime.enable')
  for (let i = 0; i < 30; i++) { if (await evalIn(cdp, '!!window.api?.ai').catch(() => false)) break; await new Promise(r => setTimeout(r, 500)) }

  const repo = REPO.replace(/\\/g, '/')
  const wt = await evalIn(cdp, `window.api.ai.createBranchWorktree({ sessionId: 'probe', cwd: '${repo}' })`)
  if (!wt || wt.error) { check('建 worktree', false, JSON.stringify(wt)); cdp.close(); proc.kill(); cleanup(); process.exit(1) }
  check('建 worktree', true, wt.path.split(/[\/]/).pop())
  const wtPath = wt.path.replace(/\\/g, '/')

  console.log('→ 按生产路径 forkTurn（sourceCwd=仓库, targetCwd=worktree）...')
  const forked = await evalIn(cdp, `window.api.ai.forkTurn({
    sessionId: 'probe', sourceClaudeSessionId: '${srcId}', cwd: '${repo}',
    sourceCwd: '${repo}', targetCwd: '${wtPath}',
    content: 'say alpha', occurrence: 0
  })`)
  if (!forked?.success) { check('forkTurn 到 worktree 项目目录', false, JSON.stringify(forked)); cdp.close(); proc.kill(); cleanup(); process.exit(1) }
  check('forkTurn 到 worktree 项目目录', true, forked.newClaudeSessionId.slice(0, 8))

  const wtDirs = dirsNewerThan(startedAt).filter(d => d.toLowerCase().includes('branch-worktrees'))
  const wtDir = wtDirs[0]
  if (!wtDir) { check('分叉文件落在 worktree 的项目目录', false, '未找到 worktree 项目目录'); }
  else {
    created.push(join(PROJECTS, wtDir))
    check('分叉文件落在 worktree 的项目目录', existsSync(join(PROJECTS, wtDir, `${forked.newClaudeSessionId}.jsonl`)), wtDir)
    check('源项目目录未被写入新文件', !existsSync(join(PROJECTS, repoDir, `${forked.newClaudeSessionId}.jsonl`)))
  }

  // 回归：分叉文件内部的 cwd 必须改写成 worktree，否则渲染层 resume 会信它把 CLI 拉回源目录
  if (wtDir) {
    const forkedLines = readFileSync(join(PROJECTS, wtDir, `${forked.newClaudeSessionId}.jsonl`), 'utf-8').split('\n').filter(Boolean)
    const cwds = forkedLines.map(l => { try { return JSON.parse(l).cwd } catch { return undefined } }).filter(Boolean)
    check('分叉文件内部 cwd 改写为 worktree', cwds.length > 0 && cwds.every(c => c === wtPath), cwds[0] || '(无)')
    const loaded = await evalIn(cdp, `window.api.ai.loadSessionMessages('${forked.newClaudeSessionId}', '${wtPath}', undefined)`)
    check('loadSessionMessages.actualCwd = worktree（resume 用它 spawn CLI）', loaded?.actualCwd === wtPath, String(loaded?.actualCwd))
    check('loadSessionMessages 能读到继承的轮次', (loaded?.messages || []).length > 0, `${(loaded?.messages || []).length} 条`)
  }

  console.log('→ 用真 CLI 在 worktree 里 resume 分叉会话（这是最关键的一步）...')
  let resumeOut = ''
  try {
    resumeOut = claude(['-p', '--resume', forked.newClaudeSessionId, 'say gamma', '--output-format', 'json'], wt.path)
  } catch (e) {
    resumeOut = String(e.stdout || e.message)
  }
  const resumed = !resumeOut.includes('No conversation found') && resumeOut.includes('"is_error":false')
  check('worktree 里 --resume 分叉会话成功', resumed, resumeOut.slice(0, 160).replace(/\n/g, ' '))
  if (resumed && wtDir) {
    const after = readFileSync(join(PROJECTS, wtDir, `${forked.newClaudeSessionId}.jsonl`), 'utf-8').split('\n').filter(Boolean)
    check('续聊内容写在 worktree 项目目录', after.length > srcLines.length, `${srcLines.length} → ${after.length} 行`)
  }

  console.log('→ sessionGraph 跨项目目录合并...')
  const g = await evalIn(cdp, `window.api.ai.sessionGraph('${srcId}', '${repo}')`)
  if (!g) check('跨目录建图', false, '返回 null')
  else {
    const titles = g.nodes.map(n => n.title)
    check('跨目录建图', true, `${g.nodes.length} 轮 / ${g.branches.length} 分支`)
    check('含源会话的轮次', titles.some(x => x.includes('alpha')), titles.join(' | '))
    check('含 worktree 分支的轮次', titles.some(x => x.includes('gamma')), titles.join(' | '))
    check('分支覆盖两个项目目录', new Set(g.branches.map(b => b.cwd)).size === 2, g.branches.map(b => b.cwd).join(' , '))
    check('worktree 分支被标注', g.branches.some(b => b.worktree === 'branch'), JSON.stringify(g.branches.map(b => b.worktree)))
    check('非 worktree 分支不误标', g.branches.some(b => b.worktree === null), JSON.stringify(g.branches.map(b => b.worktree)))
    const wtBranch = g.branches.find(b => b.worktree === 'branch')
    check('worktree 分支带 git 分支名', /^worktree-/.test(wtBranch?.branch || ''), String(wtBranch?.branch))
    // 分叉点：worktree 分支的第一个独占轮次挂在哪 —— alpha 是共享前缀，gamma 才是该分支独有的
    const alphaNode = g.nodes.find(n => n.title.includes('alpha'))
    check('worktree 分支有分叉点', wtBranch?.forkNodeId === alphaNode?.id, `fork=${wtBranch?.forkNodeId?.slice(0, 8)} alpha=${alphaNode?.id.slice(0, 8)}`)
    // 源分支没有独有轮次（它那条 alpha 被 fork 原样复制了）→ 分叉点退化为自己的 tip
    const plain = g.branches.find(b => b.worktree === null)
    check('无独有轮次时分叉点退化为 tip', plain?.forkNodeId === plain?.tipNodeId && !!plain?.forkNodeId, `fork=${plain?.forkNodeId?.slice(0, 8)} tip=${plain?.tipNodeId?.slice(0, 8)}`)
    const alpha = g.nodes.find(n => n.title.includes('alpha'))
    const kids = g.nodes.filter(n => n.parentId === alpha?.id)
    check('worktree 分支挂在源轮次下', kids.length >= 1, kids.map(k => k.title).join(' | '))

    // worktree 起点单独成节点：原路径那一轮留在原分支，worktree 的轮次改挂起点下，两个都在
    const wtStart = g.nodes.find(n => n.worktreeStart && n.branchIds.includes(forked.newClaudeSessionId))
    check('worktree 起点单独成节点', !!wtStart && /^worktree-/.test(wtStart.title), wtStart?.title)
    check('起点挂在分叉轮次下（原路径节点保留）', !!wtStart && wtStart.parentId === alpha?.id, `${wtStart?.parentId?.slice(0, 8)} vs ${alpha?.id.slice(0, 8)}`)
    const gammaNode = g.nodes.find(n => n.title.includes('gamma'))
    check('worktree 的轮次改挂到起点下', gammaNode?.parentId === wtStart?.id)
    check('原路径节点仍是源分支 tip', alpha?.tipBranchIds.includes(srcId), alpha?.tipBranchIds.join(','))
    check('起点副标题显示分支首轮', wtStart?.preview === 'say gamma', wtStart?.preview)
  }

  // 刚建完就看的形态：worktree 还没有自己的轮次 → 分支 tip 就是起点节点
  console.log('→ 新 worktree（还没发言）的起点节点...')
  const wt2 = await evalIn(cdp, `window.api.ai.createBranchWorktree({ sessionId: 'probe', cwd: '${repo}' })`)
  const wt2Path = (wt2?.path || '').replace(/\\/g, '/')
  const f2 = await evalIn(cdp, `window.api.ai.forkTurn({
    sessionId: 'probe', sourceClaudeSessionId: '${srcId}', cwd: '${repo}',
    sourceCwd: '${repo}', targetCwd: '${wt2Path}',
    content: 'say alpha', occurrence: 0
  })`)
  const wt2Dir = dirsNewerThan(startedAt).find(d => d.toLowerCase().includes('branch-worktrees') && !created.some(p => p.endsWith(d)))
  if (wt2Dir) created.push(join(PROJECTS, wt2Dir))
  const g2 = f2?.success ? await evalIn(cdp, `window.api.ai.sessionGraph('${srcId}', '${repo}')`) : null
  if (f2?.success && g2) {
    const s2 = g2.nodes.find(n => n.worktreeStart && n.branchIds.includes(f2.newClaudeSessionId))
    const b2 = g2.branches.find(b => b.claudeSessionId === f2.newClaudeSessionId)
    const alpha2 = g2.nodes.find(n => n.title.includes('alpha'))
    check('未发言的 worktree 分支 tip = 起点节点', !!s2 && b2?.tipNodeId === s2.id, String(b2?.tipNodeId).slice(0, 16))
    check('起点自带该分支的 tip 标记', !!s2?.tipBranchIds.includes(f2.newClaudeSessionId))
    check('原路径节点不再声明该分支 tip', !alpha2?.tipBranchIds.includes(f2.newClaudeSessionId), alpha2?.tipBranchIds.join(','))
    check('未发言分支的起点副标题显示目录', s2?.preview === wt2Path, s2?.preview)
    const s1b = g2.nodes.find(n => n.worktreeStart && n.branchIds.includes(forked.newClaudeSessionId))
    check('同 worktree 两条分支的起点可区分', !!s1b && !!s2 && s1b.preview !== s2.preview, `${s1b?.preview} | ${s2?.preview}`)
  } else {
    check('未发言的 worktree 分支 tip = 起点节点', false, JSON.stringify({ wt2, f2 }))
  }

  cdp.close()
  proc.kill()
  cleanup()
  console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('探针异常:', e.message); cleanup(); process.exit(1) })
