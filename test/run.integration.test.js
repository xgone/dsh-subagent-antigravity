import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { startAntigravityRun, textTask } from '../src/run.js'

/**
 * Build a fake managed-process handle that speaks the stream-json protocol.
 * `respond(line, ctx)` receives one parsed stdin message and drives the fake
 * CLI by pushing NDJSON events to stdout.
 */
function makeFakeChild(respond) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let resolveDone
  let doneResolved = false
  const done = new Promise((resolve) => { resolveDone = resolve })
  const settle = (outcome) => {
    if (doneResolved) return
    doneResolved = true
    resolveDone(outcome)
  }
  const emit = (event) => { stdout.write(`${JSON.stringify(event)}\n`) }
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const lines = chunk.toString('utf8').split('\n').filter((line) => line.trim().length > 0)
      for (const line of lines) {
        respond(JSON.parse(line), { emit, settle, end: () => { stdout.end() } })
      }
      callback()
    },
  })
  return {
    stdin,
    stdout,
    stderr,
    collected: {},
    done,
    terminate() { settle({ exitCode: null, signal: 'SIGTERM' }) },
    async waitForExit() { return true },
  }
}

function makeSpec(respond, overrides = {}) {
  return {
    cwd: '/tmp',
    permissionMode: 'accept-edits',
    env: {},
    disposeGraceMs: 1000,
    command: 'agy',
    async resolveExecutable() { return '/fake/agy' },
    spawn() { return makeFakeChild(respond) },
    ...overrides,
  }
}

function makeRequest(text = 'hi') {
  return {
    cwd: '/tmp',
    prompt: [{ type: 'text', text }],
    signal: new AbortController().signal,
  }
}

test('textTask accepts only non-empty text blocks and preserves them', () => {
  assert.deepEqual(textTask([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]),
    [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])
  assert.throws(() => textTask([]), /only text blocks/)
  assert.throws(() => textTask([{ type: 'image', text: 'x' }]), /only text blocks/)
  assert.throws(() => textTask([{ type: 'text', text: '   ' }]), /must not be empty/)
})

test('successful run publishes after init and returns the result response', async () => {
  const spec = makeSpec((message, { emit }) => {
    assert.equal(message.event, 'user')
    // async so it behaves like a real pipe
    setImmediate(() => {
      emit({ event: 'init', init: { cwd: '/tmp', permission_mode: 'accept-edits' } })
      emit({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'hel' } })
      emit({ event: 'step_update', step_update: { state: 'DONE', step_type: 'agent_response', text_delta: 'lo' } })
      emit({ event: 'result', result: { status: 'SUCCESS', response: 'hello\n' } })
    })
  })
  const run = await startAntigravityRun(makeRequest(), spec)
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  assert.deepEqual(result.output, [{ type: 'text', text: 'hello\n' }])
  await run.dispose()
})

test('product ERROR status settles as stopReason error with a safe diagnostic', async () => {
  const spec = makeSpec((_message, { emit }) => {
    setImmediate(() => {
      emit({ event: 'init', init: { cwd: '/tmp' } })
      emit({ event: 'result', result: { status: 'ERROR', response: '', error: 'secret /home/user path' } })
    })
  })
  const run = await startAntigravityRun(makeRequest(), spec)
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.match(result.diagnostic, /product: Antigravity/)
  assert.match(result.diagnostic, /category: product-error/)
  assert.ok(!result.diagnostic.includes('secret'), 'diagnostic must not leak product error text')
  await run.dispose()
})

test('malformed product status cannot inject paths or credentials into the diagnostic', async () => {
  const spec = makeSpec((_message, { emit }) => {
    setImmediate(() => {
      emit({ event: 'init', init: { cwd: '/tmp' } })
      emit({ event: 'result', result: {
        status: 'ERROR /Users/alice/private.txt token=abc123',
        response: '',
      } })
    })
  })
  const run = await startAntigravityRun(makeRequest(), spec)
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.match(result.diagnostic, /category: unknown/)
  assert.match(result.diagnostic, /status: unknown/)
  assert.ok(!result.diagnostic.includes('/Users/alice'))
  assert.ok(!result.diagnostic.includes('abc123'))
  await run.dispose()
})

test('SUCCESS with blank response keeps streamed assistant text as partial error output', async () => {
  const spec = makeSpec((_message, { emit }) => {
    setImmediate(() => {
      emit({ event: 'init', init: { cwd: '/tmp' } })
      emit({ event: 'step_update', step_update: {
        step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Partial review ',
      } })
      emit({ event: 'step_update', step_update: {
        step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'findings',
      } })
      emit({ event: 'result', result: { status: 'SUCCESS', response: '   ' } })
    })
  })
  const run = await startAntigravityRun(makeRequest(), spec)
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.match(result.diagnostic, /category: invalid-result/)
  assert.deepEqual(result.output, [{ type: 'text', text: 'Partial review findings' }])
  await run.dispose()
})

test('a result before init fails startup instead of publishing a dead run', async () => {
  const spec = makeSpec((_message, { emit }) => {
    setImmediate(() => {
      emit({ event: 'result', result: { status: 'ERROR', response: '', error: 'auth required' } })
    })
  })
  await assert.rejects(
    () => startAntigravityRun(makeRequest(), spec),
    (error) => {
      assert.match(error.message, /Product subagent failure/)
      assert.match(error.message, /category: product-error/)
      return true
    },
  )
})

test('local cancellation aborts a published run', async () => {
  const controller = new AbortController()
  const request = { ...makeRequest(), signal: controller.signal }
  const spec = makeSpec((_message, { emit }) => {
    setImmediate(() => { emit({ event: 'init', init: { cwd: '/tmp' } }) })
  })
  const run = await startAntigravityRun(request, spec)
  controller.abort()
  const result = await run.result
  assert.equal(result.stopReason, 'aborted')
  await run.dispose()
})

test('missing executable fails startup with a safe failure', async () => {
  const spec = makeSpec(() => {}, {
    async resolveExecutable() { throw new Error('not found: agy') },
  })
  await assert.rejects(
    () => startAntigravityRun(makeRequest(), spec),
    /Product subagent failure .*stage: initialize/,
  )
})

test('dispose is idempotent and settles without throwing', async () => {
  const spec = makeSpec((_message, { emit }) => {
    setImmediate(() => {
      emit({ event: 'init', init: { cwd: '/tmp' } })
      emit({ event: 'result', result: { status: 'SUCCESS', response: 'ok' } })
    })
  })
  const run = await startAntigravityRun(makeRequest(), spec)
  assert.equal((await run.result).stopReason, 'completed')
  await run.dispose()
  await run.dispose() // second dispose reuses the memoized teardown
})
