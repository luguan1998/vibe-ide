import { describe, it } from 'node:test'
import assert from 'node:assert'

const EMPTY_SESSION = {
  ready: false, busy: false, messages: [],
  streaming: false, streamBuffer: '', thinkingBuffer: '', thinkingStartedAt: null, pendingPermission: null,
  slashCommands: [], model: '', contextPercent: null, name: '',
  fileChangesByTurn: [],
  worktreePath: undefined,
}

function makeUserMsg(sessionId, content) {
  return { sessionId, type: 'user', role: 'user', content, timestamp: Date.now() }
}

function makeAsstMsg(sessionId, content) {
  return { sessionId, type: 'assistant', role: 'assistant', content, timestamp: Date.now() }
}

function makeCommandUserMsg(sessionId, tag, inner) {
  return { sessionId, type: 'user', role: 'user', content: `<${tag}>${inner}</${tag}>`, timestamp: Date.now() }
}

const COMMAND_TAG_RE = /<(local-command-caveat|command-name|command-message|command-args|local-command-stdout|system-reminder)>[\\s\\S]*?<\\/(local-command-caveat|command-name|command-message|command-args|local-command-stdout|system-reminder)>/g

function isRealUserMessage(content) {
  return content.replace(COMMAND_TAG_RE, '').trim().length > 0
}

function countUserMsgs(messages) {
  return messages.filter(m => m.role === 'user' && m.content && m.type === 'user' && isRealUserMessage(m.content)).length
}

function findMessageIndexForUserMessage(messages, userMessageIndex) {
  let count = 0
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user' && m.content && m.type === 'user' && isRealUserMessage(m.content)) {
      if (count === userMessageIndex) return i
      count++
    }
  }
  return -1
}

function effectiveResumedCount(session) {
  return session.resumeSessionId ? (session.resumedUserMsgCount ?? Infinity) : undefined
}

function shouldShowPopover(session, userMessageIndex) {
  const c = effectiveResumedCount(session)
  return userMessageIndex > 0 && (c == null || userMessageIndex >= c)
}

describe('resume + revert flow', () => {

  it('1. non-resume: popover on all msgs (index>0)', () => {
    const sid = 's1'
    const s = { ...EMPTY_SESSION }
    s.messages = [
      makeUserMsg(sid, 'Q1'), makeAsstMsg(sid, 'A1'),
      makeUserMsg(sid, 'Q2'), makeAsstMsg(sid, 'A2'),
      makeUserMsg(sid, 'Q3'), makeAsstMsg(sid, 'A3'),
    ]
    assert.equal(countUserMsgs(s.messages), 3)
    assert.equal(shouldShowPopover(s, 0), false)
    assert.equal(shouldShowPopover(s, 1), true)
    assert.equal(shouldShowPopover(s, 2), true)
  })

  it('2. resume pre-first-send: no popover', () => {
    const sid = 's2'
    const s = { ...EMPTY_SESSION, resumeSessionId: 'r1' }
    s.messages = [
      makeUserMsg(sid, 'Q1'), makeAsstMsg(sid, 'A1'),
      makeUserMsg(sid, 'Q2'), makeAsstMsg(sid, 'A2'),
    ]
    assert.equal(countUserMsgs(s.messages), 2)
    assert.equal(shouldShowPopover(s, 0), false)
    assert.equal(shouldShowPopover(s, 1), false)
  })

  it('3. resume: first send snapshots, new msg shows popover', () => {
    const sid = 's3'
    let s = { ...EMPTY_SESSION, resumeSessionId: 'r2' }
    s.messages = [
      makeUserMsg(sid, 'Q1'), makeAsstMsg(sid, 'A1'),
      makeUserMsg(sid, 'Q2'), makeAsstMsg(sid, 'A2'),
    ]
    // --- handleSend ---
    const currentCount = countUserMsgs(s.messages) // = 2
    s = {
      ...s, busy: true,
      messages: [...s.messages, makeUserMsg(sid, 'New')],
      ...(s.resumeSessionId && s.resumedUserMsgCount == null
        ? { resumedUserMsgCount: currentCount } : {}),
    }
    assert.equal(s.resumedUserMsgCount, 2)
    assert.equal(countUserMsgs(s.messages), 3)
    assert.equal(shouldShowPopover(s, 0), false)
    assert.equal(shouldShowPopover(s, 1), false)
    assert.equal(shouldShowPopover(s, 2), true)
  })

  it('4. revert new msg: keeps truncatedMessages, resets count, all hidden', () => {
    const sid = 's4'
    let s = {
      ...EMPTY_SESSION,
      resumeSessionId: 'r3',
      resumedUserMsgCount: 2,
    }
    s.messages = [
      makeUserMsg(sid, 'Q1'), makeAsstMsg(sid, 'A1'),
      makeUserMsg(sid, 'Q2'), makeAsstMsg(sid, 'A2'),
      makeUserMsg(sid, 'New'), makeAsstMsg(sid, 'Ans'),
    ]
    assert.equal(countUserMsgs(s.messages), 3)

    // --- handleRevert(2) ---
    const targetIdx = findMessageIndexForUserMessage(s.messages, 2)
    const truncated = s.messages.slice(0, targetIdx)
    const truncatedFC = s.fileChangesByTurn.slice(0, 2)
    s = {
      ...s,
      messages: truncated,
      fileChangesByTurn: truncatedFC,
      busy: false,
      streaming: false, streamBuffer: '', thinkingBuffer: '', thinkingStartedAt: null,
      pendingPermission: null,
      resumedUserMsgCount: undefined,
    }
    assert.equal(countUserMsgs(s.messages), 2, '2 user msgs remain after truncation')
    assert.equal(s.resumedUserMsgCount, undefined)
    assert.equal(effectiveResumedCount(s), Infinity)
    assert.equal(shouldShowPopover(s, 0), false)
    assert.equal(shouldShowPopover(s, 1), false)

    // --- send another new msg after revert ---
    const c = countUserMsgs(s.messages) // = 2
    s = {
      ...s, busy: true,
      messages: [...s.messages, makeUserMsg(sid, 'Another')],
      ...(s.resumeSessionId && s.resumedUserMsgCount == null
        ? { resumedUserMsgCount: c } : {}),
    }
    assert.equal(s.resumedUserMsgCount, 2)
    assert.equal(countUserMsgs(s.messages), 3)
    assert.equal(shouldShowPopover(s, 0), false)
    assert.equal(shouldShowPopover(s, 1), false)
    assert.equal(shouldShowPopover(s, 2), true, 'new msg after revert shows popover')
  })

  it('5. subsequent sends do not overwrite snapshot', () => {
    const sid = 's5'
    let s = { ...EMPTY_SESSION, resumeSessionId: 'r4', resumedUserMsgCount: 3 }
    s.messages = [
      makeUserMsg(sid, 'H1'), makeAsstMsg(sid, 'A1'),
      makeUserMsg(sid, 'H2'), makeAsstMsg(sid, 'A2'),
      makeUserMsg(sid, 'H3'), makeAsstMsg(sid, 'A3'),
      makeUserMsg(sid, 'N1'), makeAsstMsg(sid, 'R1'),
    ]
    assert.equal(countUserMsgs(s.messages), 4)

    // send N2
    s = {
      ...s,
      messages: [...s.messages, makeUserMsg(sid, 'N2')],
      ...(s.resumeSessionId && s.resumedUserMsgCount == null
        ? { resumedUserMsgCount: countUserMsgs(s.messages) } : {}),
    }
    assert.equal(s.resumedUserMsgCount, 3, 'unchanged')
    assert.equal(shouldShowPopover(s, 3), true, 'N1')
    assert.equal(shouldShowPopover(s, 4), true, 'N2')
    assert.equal(shouldShowPopover(s, 2), false, 'H3')
  })

  it('6. revert after revert: reset count each time, re-snapshot on send', () => {
    const sid = 's6'
    let s = { ...EMPTY_SESSION, resumeSessionId: 'r5', resumedUserMsgCount: 2 }
    s.messages = [
      makeUserMsg(sid, 'H1'), makeAsstMsg(sid, 'A1'),
      makeUserMsg(sid, 'H2'), makeAsstMsg(sid, 'A2'),
      makeUserMsg(sid, 'N1'), makeAsstMsg(sid, 'R1'),
      makeUserMsg(sid, 'N2'), makeAsstMsg(sid, 'R2'),
    ]

    // revert N2 (index 3)
    const t3 = findMessageIndexForUserMessage(s.messages, 3)
    s = {
      ...s,
      messages: s.messages.slice(0, t3),
      fileChangesByTurn: s.fileChangesByTurn.slice(0, 3),
      pendingPermission: null,
      resumedUserMsgCount: undefined,
    }
    assert.equal(countUserMsgs(s.messages), 3)
    assert.equal(shouldShowPopover(s, 0), false)
    assert.equal(shouldShowPopover(s, 2), false, 'N1 hidden after revert (count reset)')
    assert.equal(shouldShowPopover(s, 1), false)

    // send new after first revert
    const c1 = countUserMsgs(s.messages) // = 3
    s = {
      ...s,
      messages: [...s.messages, makeUserMsg(sid, 'N3')],
      ...(s.resumeSessionId && s.resumedUserMsgCount == null ? { resumedUserMsgCount: c1 } : {}),
    }
    assert.equal(s.resumedUserMsgCount, 3)
    assert.equal(shouldShowPopover(s, 3), true, 'N3 shows popover')

    // revert N3 (index 3)
    const t4 = findMessageIndexForUserMessage(s.messages, 3)
    s = {
      ...s,
      messages: s.messages.slice(0, t4),
      fileChangesByTurn: s.fileChangesByTurn.slice(0, 3),
      pendingPermission: null,
      resumedUserMsgCount: undefined,
    }
    assert.equal(countUserMsgs(s.messages), 3, 'H1,H2,N1 remain')
    assert.equal(shouldShowPopover(s, 2), false, 'all hidden after revert')

    // send yet another new
    const c2 = countUserMsgs(s.messages) // = 3
    s = {
      ...s,
      messages: [...s.messages, makeUserMsg(sid, 'N4')],
      ...(s.resumeSessionId && s.resumedUserMsgCount == null ? { resumedUserMsgCount: c2 } : {}),
    }
    assert.equal(s.resumedUserMsgCount, 3)
    assert.equal(shouldShowPopover(s, 3), true, 'N4 shows popover')
  })

  it('7. model-switch hidden messages excluded from counting', () => {
    const sid = 's7'
    const s = { ...EMPTY_SESSION }
    // Simulate model switch injecting 3 hidden messages before real ones
    s.messages = [
      makeCommandUserMsg(sid, 'local-command-caveat', 'Caveat: ...'),
      makeCommandUserMsg(sid, 'command-name', '/model'),
      makeCommandUserMsg(sid, 'local-command-stdout', 'Set model to haiku'),
      makeUserMsg(sid, 'Q1'), makeAsstMsg(sid, 'A1'),
      makeUserMsg(sid, 'Q2'), makeAsstMsg(sid, 'A2'),
    ]
    assert.equal(countUserMsgs(s.messages), 2, 'only Q1 and Q2 count')
    assert.equal(shouldShowPopover(s, 0), false)
    assert.equal(shouldShowPopover(s, 1), true, 'Q2 shows popover (userMsgIdx=1)')

    // Revert at userMessageIndex=1 (Q2)
    const targetIdx = findMessageIndexForUserMessage(s.messages, 1)
    assert.ok(targetIdx > 0, 'found Q2 in messages')
    const truncated = s.messages.slice(0, targetIdx)
    assert.equal(countUserMsgs(truncated), 1, 'only Q1 remains after truncation')
  })
})

console.log('All tests passed!')
