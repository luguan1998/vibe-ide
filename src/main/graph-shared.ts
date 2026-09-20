import type { AiGraphNode, AiGraphBranch } from '../shared/types'

// 网状对话图的后处理：claude（ai-tree）与 pi（pi/tree）两种后端产出同一套
// AiGraphNode/AiGraphBranch，节点去重合并之后的收尾算法共用这一份。

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export function normPath(p: string): string {
  const r = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? r.toLowerCase() : r
}

export function assignDepths(nodes: AiGraphNode[]): void {
  const children = new Map<string | null, AiGraphNode[]>()
  for (const n of nodes) {
    const list = children.get(n.parentId) ?? []
    list.push(n)
    children.set(n.parentId, list)
  }
  const stack = [...(children.get(null) ?? [])].map(n => ({ n, d: 0 }))
  while (stack.length) {
    const { n, d } = stack.pop()!
    n.depth = d
    for (const c of children.get(n.id) ?? []) stack.push({ n: c, d: d + 1 })
  }
}

// 某分支第一个「只属于自己」的轮次（沿链 depth 最小者即入口）。
// 返回的是基于传入 nodes 的快照查询函数：claude 侧插 worktree 起点节点会改动 nodes，
// 分叉点必须按插入前的图算，所以调用方先取快照再反复查。
export function exclusiveFirstOf(nodes: AiGraphNode[]): (branchId: string) => AiGraphNode | null {
  const exclusiveOf = new Map<string, AiGraphNode[]>()
  for (const n of nodes) {
    if (n.branchIds.length !== 1) continue
    const list = exclusiveOf.get(n.branchIds[0]) ?? []
    list.push(n)
    exclusiveOf.set(n.branchIds[0], list)
  }
  return (branchId: string) => {
    const list = exclusiveOf.get(branchId) ?? []
    return list.length > 0 ? list.reduce((a, c) => (c.depth < a.depth ? c : a)) : null
  }
}

// 分叉点 = 该分支第一个独占轮次的父节点；还没长出独占轮次（刚分叉就停手）时退化为 tip
export function assignForkPoints(nodes: AiGraphNode[], branches: AiGraphBranch[]): void {
  const firstOf = exclusiveFirstOf(nodes)
  for (const b of branches) {
    const first = firstOf(b.claudeSessionId)
    b.forkNodeId = first ? first.parentId : b.tipNodeId
  }
}
