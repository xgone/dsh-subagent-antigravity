import test from 'node:test'
import assert from 'node:assert/strict'
import { antigravityStatusProjection } from '../src/status-projection.js'

const header = { id: 'parent-session' }

function event(type, seq, data, time = seq) {
  return { type, seq, time, data }
}

test('status projection marks only a started Antigravity child active and clears it on settlement', () => {
  let state = antigravityStatusProjection.init(header, 0)
  state = antigravityStatusProjection.apply(state, event('tool/call', 0, {
    turn: 1,
    step: 1,
    callId: 'agy-call-1',
    name: 'subagent_antigravity',
    arguments: '{}',
  }))
  assert.deepEqual(antigravityStatusProjection.wire.view(state), { count: 0 })

  state = antigravityStatusProjection.apply(state, event('tool/result', 1, {
    turn: 1,
    step: 1,
    message: {
      role: 'tool',
      toolCallId: 'agy-call-1',
      source: { kind: 'tool', callId: 'agy-call-1' },
      content: [{ type: 'text', text: 'started subagent child-1' }],
    },
  }))
  assert.deepEqual(antigravityStatusProjection.wire.view(state), { count: 1 })
  assert.deepEqual(state.activeRuns, [{ id: 'child-1', startedAt: 1 }])

  state = antigravityStatusProjection.apply(state, event('user/message', 2, {
    role: 'user',
    source: { kind: 'subagent-settled', senderSessionId: 'child-1' },
    content: [{ type: 'text', text: 'finished' }],
  }))
  assert.deepEqual(antigravityStatusProjection.wire.view(state), { count: 0 })
  assert.deepEqual(state.activeRuns, [])
})

test('status projection ignores other tool calls, failed starts, and unrelated settlements', () => {
  let state = antigravityStatusProjection.init(header, 0)
  state = antigravityStatusProjection.apply(state, event('tool/call', 0, {
    turn: 1, step: 1, callId: 'other-call', name: 'search', arguments: '{}',
  }))
  state = antigravityStatusProjection.apply(state, event('tool/result', 1, {
    turn: 1, step: 1,
    message: {
      role: 'tool', toolCallId: 'other-call', source: { kind: 'tool', callId: 'other-call' },
      content: [{ type: 'text', text: 'started subagent child-other' }],
    },
  }))
  state = antigravityStatusProjection.apply(state, event('user/message', 2, {
    role: 'user', source: { kind: 'subagent-settled', senderSessionId: 'child-other' },
    content: [{ type: 'text', text: 'finished' }],
  }))
  assert.deepEqual(antigravityStatusProjection.wire.view(state), { count: 0 })

  state = antigravityStatusProjection.apply(state, event('tool/call', 3, {
    turn: 2, step: 1, callId: 'agy-call-2', name: 'subagent_antigravity', arguments: '{}',
  }))
  state = antigravityStatusProjection.apply(state, event('tool/result', 4, {
    turn: 2, step: 1,
    message: {
      role: 'tool', toolCallId: 'agy-call-2', source: { kind: 'tool', callId: 'agy-call-2' },
      content: [{ type: 'text', text: 'failed before startup' }],
    },
  }))
  assert.deepEqual(antigravityStatusProjection.wire.view(state), { count: 0 })
  assert.deepEqual(state.pendingCallIds, [])
})
