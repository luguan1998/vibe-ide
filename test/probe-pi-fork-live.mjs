// 直接跑真实的 main 端 fork 实现（不经 Electron IPC）。
// 先生成 bundle（electron 用 stub 顶掉，模组本身不碰窗口）：
//   esbuild src/main/pi/fork.ts --bundle --platform=node --format=esm \
//     --alias:electron=./test/stub-electron.mjs --outfile=test/.tmp-fork-bundle.mjs
// 用法: node test/probe-pi-fork-live.mjs <sourceSessionId> <cwd> <content...>
import { forkPiSession } from './.tmp-fork-bundle.mjs'

const [, , sessionId, cwd, ...contentParts] = process.argv
const content = contentParts.join(' ')
if (!sessionId || !cwd) {
  console.error('usage: node test/probe-pi-fork-live.mjs <sessionId> <cwd> <content>')
  process.exit(1)
}

async function run(label, input) {
  const res = await forkPiSession({ sourceSessionId: sessionId, cwd, occurrence: 0, ...input })
  console.log(label, JSON.stringify(res))
  return res
}

// 1) through + 内容匹配到第 2 轮 → 应保留前两轮（非空，新会话）
await run('[through content-match]', { userTurnIndex: 99, mode: 'through', content: '你是谁' })
// 2) before + 内容匹配到第 2 轮 → 应保留到第 1 轮结束（= revert 语义）
await run('[before  content-match]', { userTurnIndex: 99, mode: 'before', content: '你是谁' })
// 3) before + 首轮 → 空分支（pi 不落盘）
await run('[before  first-turn ]', { userTurnIndex: 0, mode: 'before', content: '你好' })
// 4) 内容匹配不上 → 回落到 userTurnIndex
await run('[index fallback      ]', { userTurnIndex: 1, mode: 'through', content: '不存在的文本' })
// 5) 越界 index → 报错
await run('[out-of-range        ]', { userTurnIndex: 99, mode: 'through' })
