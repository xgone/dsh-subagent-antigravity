import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANTIGRAVITY_PERMISSION_MODES,
  DEFAULT_ANTIGRAVITY_PERMISSION_MODE,
  buildArgv,
  classifyResult,
  encodeUserEvent,
  failureDiagnostic,
  NdjsonEventFeed,
  parseEventLine,
  permissionModeArgs,
} from '../src/antigravity.js'

test('permission mode flags match the documented agy contract', () => {
  assert.deepEqual(permissionModeArgs('default'), ['--sandbox'])
  assert.deepEqual(permissionModeArgs('accept-edits'), ['--mode=accept-edits', '--sandbox'])
  assert.deepEqual(permissionModeArgs('auto'), ['--mode=auto', '--sandbox'])
  assert.deepEqual(permissionModeArgs('dangerously-skip-permissions'), ['--dangerously-skip-permissions'])
  assert.throws(() => permissionModeArgs('nope'), /unknown permissionMode/)
  assert.equal(DEFAULT_ANTIGRAVITY_PERMISSION_MODE, 'accept-edits')
  assert.deepEqual([...ANTIGRAVITY_PERMISSION_MODES], ['default', 'accept-edits', 'auto', 'dangerously-skip-permissions'])
})

test('buildArgv always requests stream-json on both sides and appends overrides', () => {
  assert.deepEqual(buildArgv('/usr/bin/agy', { permissionMode: 'accept-edits' }), [
    '/usr/bin/agy', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--disable-slash-commands', '--mode=accept-edits', '--sandbox',
  ])
  assert.deepEqual(
    buildArgv('agy', { permissionMode: 'default', model: 'gemini-4-neon-high', effort: 'high', agent: 'reviewer' }),
    ['agy', '--input-format', 'stream-json', '--output-format', 'stream-json', '--disable-slash-commands', '--sandbox',
      '--model', 'gemini-4-neon-high', '--effort', 'high', '--agent', 'reviewer'],
  )
  assert.throws(() => buildArgv('', { permissionMode: 'default' }), /executable path/)
})

test('encodeUserEvent produces exactly one newline-delimited user message', () => {
  const line = encodeUserEvent([{ type: 'text', text: 'hello' }])
  assert.equal(line.at(-1), '\n')
  const parsed = JSON.parse(line)
  assert.deepEqual(parsed, { event: 'user', message: { content: [{ type: 'text', text: 'hello' }] } })
  // exactly one line
  assert.equal(line.split('\n').filter(Boolean).length, 1)
})

test('parseEventLine tolerates noise and rejects non-event JSON', () => {
  assert.equal(parseEventLine(''), undefined)
  assert.equal(parseEventLine('   '), undefined)
  assert.equal(parseEventLine('not json'), undefined)
  assert.equal(parseEventLine('[]'), undefined)
  assert.equal(parseEventLine('{"foo":1}'), undefined)
  assert.deepEqual(parseEventLine('{"event":"init","init":{}}'), { event: 'init', init: {} })
})

test('classifyResult maps every documented terminal status', () => {
  assert.deepEqual(classifyResult({ status: 'SUCCESS', response: 'answer' }),
    { stopReason: 'completed', text: 'answer', status: 'SUCCESS' })
  assert.deepEqual(classifyResult({ status: 'SUCCESS', response: '   ' }),
    { stopReason: 'error', category: 'invalid-result', status: 'SUCCESS' })
  assert.deepEqual(classifyResult({ status: 'CANCELED' }), { stopReason: 'aborted', status: 'CANCELED' })
  assert.deepEqual(classifyResult({ status: 'INTERRUPTED' }), { stopReason: 'aborted', status: 'INTERRUPTED' })
  assert.deepEqual(classifyResult({ status: 'INVALID' }),
    { stopReason: 'error', category: 'invalid-result', status: 'INVALID' })
  assert.deepEqual(classifyResult({ status: 'ERROR', error: 'boom' }),
    { stopReason: 'error', category: 'product-error', status: 'ERROR' })
  assert.deepEqual(classifyResult({ status: 'WAITING' }), { stopReason: 'error', category: 'unknown', status: 'WAITING' })
  assert.deepEqual(classifyResult({ status: 'RUNNING' }), { stopReason: 'error', category: 'unknown', status: 'RUNNING' })
  assert.deepEqual(classifyResult({}), { stopReason: 'error', category: 'invalid-result', status: 'missing' })
  assert.deepEqual(classifyResult({ status: 'WEIRD /Users/alice/private.txt token=abc123' }),
    { stopReason: 'error', category: 'unknown', status: 'unknown' })
})

test('failureDiagnostic carries only fixed safe facts', () => {
  const text = failureDiagnostic({ stage: 'run', category: 'product-error', status: 'ERROR', outcome: { exitCode: 1, signal: null } })
  assert.equal(text, 'Product subagent failure (product: Antigravity; stage: run; category: product-error; status: ERROR; exit code: 1)')
  // Defensive boundary also sanitizes a status if a caller bypasses the classifier.
  const untrusted = failureDiagnostic({
    stage: 'run', category: 'unknown', status: 'ERROR /Users/alice/private.txt token=abc123',
  })
  assert.ok(!text.includes('boom'))
  assert.ok(!untrusted.includes('/Users/alice'))
  assert.ok(!untrusted.includes('abc123'))
  assert.match(untrusted, /status: unknown/)
})

test('NdjsonEventFeed handles chunk boundaries, result/init access, agentText and eof', async () => {
  const feed = new NdjsonEventFeed()
  const initLine = JSON.stringify({ event: 'init', init: { cwd: '/w', permission_mode: 'accept-edits' } }) + '\n'
  const stepLine = JSON.stringify({ event: 'step_update', step_update: { state: 'DONE', step_type: 'agent_response', text_delta: 'hel' } }) + '\n'
  const stepLine2 = JSON.stringify({ event: 'step_update', step_update: { state: 'DONE', step_type: 'agent_response', text_delta: 'lo' } }) + '\n'
  const resultLine = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'hello\n' } }) + '\n'

  // Feed in awkward slices spanning line boundaries.
  const all = initLine + stepLine + stepLine2 + resultLine
  for (let i = 0; i < all.length; i += 7) feed.feed(all.slice(i, i + 7))

  assert.deepEqual(await feed.waitFor('init'), { event: 'init', init: { cwd: '/w', permission_mode: 'accept-edits' } })
  assert.deepEqual(await feed.waitFor('result'), { event: 'result', result: { status: 'SUCCESS', response: 'hello\n' } })
  assert.equal(feed.agentText, 'hello')
  assert.equal(feed.result.response, 'hello\n')
  assert.equal(feed.init.cwd, '/w')
  // Unknown event resolves eof only after end.
  const eofWaiter = feed.waitFor('never')
  feed.end()
  assert.deepEqual(await eofWaiter, { event: 'eof' })
  assert.deepEqual(await feed.waitFor('never'), { event: 'eof' })
})

test('NdjsonEventFeed preserves ACTIVE response deltas when result.response is missing', () => {
  const feed = new NdjsonEventFeed()
  feed.feed(JSON.stringify({ event: 'step_update', step_update: {
    step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'intermediate',
  } }) + '\n')
  feed.feed(JSON.stringify({ event: 'step_update', step_update: {
    step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'partial ',
  } }) + '\n')
  feed.feed(JSON.stringify({ event: 'step_update', step_update: {
    step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'answer',
  } }) + '\n')
  feed.feed(JSON.stringify({ event: 'step_update', step_update: {
    step_index: 4, state: 'DONE', step_type: 'agent_response', text_delta: ' finalized',
  } }) + '\n')
  assert.equal(feed.agentText, 'partial answer finalized')
})

test('NdjsonEventFeed flushes a trailing unterminated result line on end', async () => {
  const feed = new NdjsonEventFeed()
  const waiter = feed.waitFor('result')
  feed.feed(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'x' } }))
  feed.end()
  assert.deepEqual(await waiter, { event: 'result', result: { status: 'SUCCESS', response: 'x' } })
})

test('NdjsonEventFeed preserves UTF-8 characters split across Buffer chunks', async () => {
  const feed = new NdjsonEventFeed()
  const payload = Buffer.from(JSON.stringify({
    event: 'result', result: { status: 'SUCCESS', response: 'A😀B' },
  }) + '\n', 'utf8')
  const emoji = Buffer.from('😀', 'utf8')
  const split = payload.indexOf(emoji) + 2 // cut inside the four-byte sequence
  feed.feed(payload.subarray(0, split))
  feed.feed(payload.subarray(split))
  const event = await feed.waitFor('result')
  assert.equal(event.result.response, 'A😀B')
})
