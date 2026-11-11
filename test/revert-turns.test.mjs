import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// 回退链路的核心不变量：
//   1. 回退/分叉目标只由 JSONL 轮次的 lineIdx 决定，气泡只负责显示配对
//   2. 配不上的气泡没有回退入口（运行中插话不在转录里落 user 行）
//   3. 主进程只按 lineIdx + content 校验截断，快照过期返回 stale，绝不猜下标
// 直接加载真实源码（esbuild 打包），不复制实现。
const root = resolve(import.meta.dirname, '..')
const outDir = join(root, 'test', '.tmp')
let truncateJsonlAtUserMessage
let turns

const CWD = 'C:\\fake\\workspace'
const SESSION = 'revert-test-session'

before(async () => {
  mkdirSync(outDir, { recursive: true })
  // ai.ts 里有 require('fs') 的同步调用，ESM bundle 下 require 不存在会被 catch 吞掉，
  // 这里打成 CJS
  await build({
    entryPoints: [join(root, 'src/main/ai-revert.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { electron: join(root, 'test/stub-electron.mjs') },
    outfile: join(outDir, 'ai-revert.cjs'),
    logLevel: 'silent',
  })
  await build({
    entryPoints: [join(root, 'src/renderer/src/components/AiTab/revertTurns.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(outDir, 'revert-turns.mjs'),
    logLevel: 'silent',
  })
  const requireCjs = createRequire(import.meta.url)
  ;({ truncateJsonlAtUserMessage } = requireCjs(join(outDir, 'ai-revert.cjs')))
  turns = await import(pathToFileURL(join(outDir, 'revert-turns.mjs')).href)
})

after(() => {
  rmSync(join(root, 'test', '.tmp', 'data'), { recursive: true, force: true })
})

// 本地发送/历史真实轮都会带 isRealUserTurn 标记（dispatchMessage / turnByLine）
function user(content, extra = {}) {
  return { sessionId: 's', type: 'user', role: 'user', content, timestamp: 1, isRealUserTurn: true, ...extra }
}
function assistant(content = 'ok') {
  return { sessionId: 's', type: 'assistant', role: 'assistant', content, timestamp: 2 }
}
function turn(lineIdx, content, isInternal = false) {
  return { lineIdx, content, isInternal }
}

describe('mapRealUserTurns（显示配对，不是回退目标）', () => {
  it('配不上的插话气泡没有入口，后续真实气泡仍对位', () => {
    const A = user('a'), B = user('b-interject'), C = user('c')
    const messages = [A, assistant(), B, assistant(), C]
    const userTurns = [turn(0, 'a'), turn(6, 'c')]
    const map = turns.mapRealUserTurns(messages, userTurns)
    assert.equal(map.get(A)?.turnIdx, 0)
    assert.equal(map.get(A)?.lineIdx, 0)
    assert.equal(map.get(B), undefined)
    assert.equal(map.get(C)?.turnIdx, 1)
    assert.equal(map.get(C)?.lineIdx, 6)
  })

  it('claude 的 userTurns 未回时不退化成渲染层下标', () => {
    const messages = [user('a'), assistant(), user('b')]
    assert.equal(turns.mapRealUserTurns(messages, []).size, 0)
  })

  it('pi 允许渲染层下标兜底（lineIdx = -1）', () => {
    const messages = [user('a'), assistant(), user('b')]
    const map = turns.mapRealUserTurns(messages, [], true)
    assert.equal(map.get(messages[0])?.turnIdx, 0)
    assert.equal(map.get(messages[0])?.lineIdx, -1)
    assert.equal(map.get(messages[2])?.turnIdx, 1)
  })

  it('重复内容按顺序各配各的轮次', () => {
    const a1 = user('same'), a2 = user('same')
    const messages = [a1, assistant(), a2]
    const userTurns = [turn(0, 'same'), turn(5, 'same')]
    const map = turns.mapRealUserTurns(messages, userTurns)
    assert.equal(map.get(a1)?.turnIdx, 0)
    assert.equal(map.get(a2)?.turnIdx, 1)
  })

  it('tool_result 回填（前一条是 assistant）不算真实输入', () => {
    const a = user('a')
    const toolResult = user('tool output', { isRealUserTurn: false })
    const messages = [a, assistant(), toolResult]
    const map = turns.mapRealUserTurns(messages, [turn(0, 'a')])
    assert.equal(map.get(a)?.turnIdx, 0)
    assert.equal(map.get(toolResult), undefined)
  })

  it('历史标记 isRealUserTurn 优先于启发式', () => {
    const marked = user('history', { isRealUserTurn: true })
    const messages = [assistant(), marked]
    assert.equal(turns.isRealUserInput(messages, 1), true)
  })
})

describe('truncateJsonlAtUserMessage（目标只认 lineIdx）', () => {
  function makeFixture() {
    const dataRoot = join(root, 'test', '.tmp', 'data')
    const norm = CWD.replace(/[^a-zA-Z0-9]/g, '-')
    const proj = join(dataRoot, 'projects', norm)
    mkdirSync(proj, { recursive: true })
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first' } }),                       // 0
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }), // 1
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'second' } }),                      // 2
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'res' }] } }), // 3
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }), // 4
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'interject' }),             // 5
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'answer' }, isMeta: true }),        // 6
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'third' } }),                       // 7
    ]
    writeFileSync(join(proj, `${SESSION}.jsonl`), lines.join('\n') + '\n')
    return { dataRoot, lines }
  }

  it('回退到中间轮：截断到该 user 行之前（辅助行/中断标记不进轮次）', async () => {
    const { dataRoot, lines } = makeFixture()
    const r = await truncateJsonlAtUserMessage(SESSION, CWD, 2, false, dataRoot, 'second')
    assert.deepEqual(r.truncated, lines.slice(0, 2))
  })

  it('回退到第一轮：整文件清空', async () => {
    const { dataRoot } = makeFixture()
    const r = await truncateJsonlAtUserMessage(SESSION, CWD, 0, false, dataRoot, 'first')
    assert.deepEqual(r.truncated, [])
  })

  it('分叉保留整轮：截到下一个 user 轮之前', async () => {
    const { dataRoot, lines } = makeFixture()
    const r = await truncateJsonlAtUserMessage(SESSION, CWD, 2, true, dataRoot, 'second')
    assert.deepEqual(r.truncated, lines.slice(0, 7))
  })

  it('content 对不上返回 stale，不猜下标', async () => {
    const { dataRoot } = makeFixture()
    const r = await truncateJsonlAtUserMessage(SESSION, CWD, 2, false, dataRoot, 'WRONG')
    assert.equal(r.stale, true)
    assert.match(r.error, /not found or changed/)
  })

  it('lineIdx 不在任何轮次上返回 stale', async () => {
    const { dataRoot } = makeFixture()
    const r = await truncateJsonlAtUserMessage(SESSION, CWD, 5, false, dataRoot, 'third')
    assert.equal(r.stale, true)
  })
})
