// 探针：pi 网状对话图构建（真实会话文件，含 fork 产物）
// 先生成 bundle：
//   esbuild src/main/pi/tree.ts --bundle --platform=node --format=esm \
//     --alias:electron=./test/stub-electron.mjs --outfile=test/.tmp-tree-bundle.mjs
// 用法: node test/probe-pi-graph.mjs <piSessionId> [cwd]
import { buildPiSessionGraph } from './.tmp-tree-bundle.mjs'

const [sessionId, cwd] = process.argv.slice(2)
if (!sessionId) { console.error('usage: node test/probe-pi-graph.mjs <piSessionId> [cwd]'); process.exit(1) }

const graph = await buildPiSessionGraph(sessionId, cwd)
if (!graph) { console.log('graph = null'); process.exit(1) }

console.log('rootId:', graph.rootId, '| active:', graph.activeClaudeSessionId.slice(0, 8))
console.log('nodes =', graph.nodes.length, '| branches =', graph.branches.length)
console.log('\nbranches:')
for (const b of graph.branches) {
  console.log(`  ${b.claudeSessionId.slice(0, 8)} turns=${b.turnCount} tip=${(b.tipNodeId || '').slice(0, 8)} forkFrom=${b.forkNodeId ? b.forkNodeId.slice(0, 8) : 'null'} cwd=${b.cwd}`)
}
console.log('\nnodes:')
for (const n of graph.nodes) {
  console.log(`  ${n.id.slice(0, 8)} d=${n.depth} parent=${n.parentId ? n.parentId.slice(0, 8) : 'null'} active=${n.active ? 'Y' : 'n'} branches=[${n.branchIds.map((x) => x.slice(0, 6)).join(',')}] tips=[${n.tipBranchIds.map((x) => x.slice(0, 6)).join(',')}] tool=${n.toolCallCount} | ${n.title}`)
}

const roots = graph.nodes.filter((n) => !n.parentId)
console.log('\nsanity:')
console.log('  root nodes:', roots.length, roots.map((r) => r.id.slice(0, 8)).join(','))
console.log('  rootId is a node:', graph.nodes.some((n) => n.id === graph.rootId))
console.log('  active nodes:', graph.nodes.filter((n) => n.active).length)
console.log('  dangling parents:', graph.nodes.filter((n) => n.parentId && !graph.nodes.some((m) => m.id === n.parentId)).length)
console.log('  fork payload sample:', JSON.stringify(graph.nodes.find((n) => n.fork)?.fork)?.slice(0, 200))
