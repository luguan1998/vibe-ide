import type { AiMessage, UserTurn } from '@shared/types'

// 真实用户输入：tool_result 回填消息也是 type:'user' 的 AiMessage（CLI 把工具结果写进
// user 行），但它们紧跟含 tool_use 的 assistant 之后，不得计入 userTurns/revert/fork 索引
// resume 历史由主进程 turnByLine 打 isRealUserTurn 标记，跨轮无 result 分隔时启发式不可信，标记优先
export function isRealUserInput(messages: AiMessage[], i: number): boolean {
  const m = messages[i]
  if (!m || m.role !== 'user' || m.type !== 'user' || !m.content) return false
  if (m.isRealUserTurn === true) return true
  return !(i > 0 && messages[i - 1].type === 'assistant')
}

export function findMessageIndexForUserMessage(messages: AiMessage[], userMessageIndex: number): number {
  let count = 0
  for (let i = 0; i < messages.length; i++) {
    if (isRealUserInput(messages, i)) {
      if (count === userMessageIndex) return i
      count++
    }
  }
  return -1
}

// 该 content 在真实用户输入中、index 之前出现的次数 = index 处消息的 occurrence（0-based）
export function countContentOccurrencesBefore(messages: AiMessage[], index: number, content: string): number {
  let occurrence = 0
  for (let i = 0; i < index; i++) {
    if (isRealUserInput(messages, i) && messages[i].content === content) occurrence++
  }
  return occurrence
}

// 渲染层气泡 ↔ 真实 JSONL 轮次的绑定。只是「按钮画在哪个气泡下」的显示配对：
// 回退点本身永远取自 userTurns（lineIdx），配不上的气泡不显示回退入口。
// 运行中插话只进 api-request-blob、不在转录里落 user 行，因此天然没有入口。
export interface RevertTurnRef {
  turnIdx: number
  lineIdx: number   // JSONL 行号；pi 没有报文轮次表时为 -1
  content: string
  isInternal: boolean
}

export function mapRealUserTurns(messages: AiMessage[], userTurns: UserTurn[], allowIndexFallback = false): Map<AiMessage, RevertTurnRef> {
  const map = new Map<AiMessage, RevertTurnRef>()
  // pi 没有 userTurns：退回渲染层顺序下标；claude 的 userTurns 未回时宁可不显示入口
  if (userTurns.length === 0) {
    if (!allowIndexFallback) return map
    let turnIdx = 0
    for (let i = 0; i < messages.length; i++) {
      if (!isRealUserInput(messages, i)) continue
      map.set(messages[i], { turnIdx: turnIdx++, lineIdx: -1, content: messages[i].content || '', isInternal: false })
    }
    return map
  }
  let cursor = 0
  for (let i = 0; i < messages.length; i++) {
    if (!isRealUserInput(messages, i)) continue
    const msg = messages[i]
    for (let k = cursor; k < userTurns.length; k++) {
      if (userTurns[k].content === msg.content) {
        map.set(msg, { turnIdx: k, lineIdx: userTurns[k].lineIdx, content: userTurns[k].content, isInternal: userTurns[k].isInternal })
        cursor = k + 1
        break
      }
    }
  }
  return map
}
