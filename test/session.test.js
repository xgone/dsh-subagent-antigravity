import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { StreamJsonChildSession } from '../src/session.js'

const INIT = { event: 'init', conversation_id: 'conv-1', init: { cwd: '/tmp', permission_mode: 'default', tools: [] } }

/**
 * Build a fake managed-process handle that speaks the CLI stream-json protocol.
 * `onUser(message, ctx)` drives the fake CLI after one stdin user line arrives.
 */
function makeFakeChild({ onUser, init = INIT } = {}) {
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
  const ctx = {
    emit: (event) => { stdout.write(`${JSON.stringify(event)}\n`) },
    settle,
    end: () => { stdout.end() },
  }
  let initEmitted = false
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n').filter(line => line.trim() !== '')) {
        const message = JSON.parse(line)
        // The real CLI reports `init` once, when the first turn is submitted.
        if (!initEmitted) {
          initEmitted = true
          if (init !== undefined) ctx.emit(init)
        }
        if (onUser !== undefined) setImmediate(() => onUser(message, ctx))
      }
      callback()
    },
  })
  stdin.on('finish', () => {
    stdout.end()
    settle({ exitCode: 0, signal: null })
  })
  return {
    stdin,
    stdout,
    stderr,
    done,
    terminate() { settle({ exitCode: null, signal: 'SIGTERM' }) },
    async waitForExit(signal) {
      if (signal === undefined) {
        await done
        return true
      }
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error('exit wait timed out'))
        signal.addEventListener('abort', onAbort, { once: true })
        done.then(() => {
          signal.removeEventListener('abort', onAbort)
          resolve(true)
        })
      })
    },
  }
}

function makeTable(initial = {}) {
  const records = new Map(Object.entries(initial))
  return {
    records,
    get(key) { return records.get(key) },
    async put(key, value) { records.set(key, value) },
    async update(key, transform) {
      const next = transform(records.get(key))
      records.set(key, next)
      return next
    },
  }
}

function makeSession(options = {}) {
  const children = []
  const spawns = []
  const table = makeTable(options.records ?? {})
  const resolvedExecutables = []
  const ctx = {
    subprocess: {
      async resolveExecutable(command, env, signal) {
        resolvedExecutables.push({ command, env, signal })
        return command.startsWith('/') ? command : `/fake/${command}`
      },
      spawn(spec) {
        spawns.push(spec)
        const child = makeFakeChild(options)
        children.push(child)
        return child
      },
    },
  }
  const agent = { session: { id: options.sessionId ?? 'child-1', header: { cwd: '/workspace' } }, ctx: { effect: () => () => {} } }
  const config = {
    command: 'agy',
    permissionMode: 'default',
    env: {},
    disposeGraceMs: 1000,
    disposeEofGraceMs: 500,
    ...options.config,
  }
  const session = new StreamJsonChildSession(ctx, agent, config, { table: () => table })
  return { session, spawns, table, children, resolvedExecutables }
}

async function nextEvent(session, signal) {
  const next = await session.events.next(signal)
  assert.equal(next.done, false)
  return next.value
}

test('open spawns the stream-json CLI without waiting for a handshake', async () => {
  const { session, spawns } = makeSession()
  await session.open()
  assert.deepEqual(spawns[0].argv, [
    '/fake/agy', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--disable-slash-commands', '--sandbox',
  ])
  assert.equal(spawns[0].cwd, '/workspace')
  assert.deepEqual(spawns[0].stdio, { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  // The CLI reports its conversation id only with the first turn's `init`.
  assert.equal(session.conversationId, undefined)
  await session.dispose()
})

test('open rejects a CLI that exits before it accepts a turn', async () => {
  const { session } = makeSession({ init: undefined })
  const failing = session
  failing.ctx.subprocess.spawn = () => {
    const child = makeFakeChild({})
    setImmediate(() => child.terminate())
    return child
  }
  await assert.rejects(() => failing.open(), /exited before it accepted a turn/)
})

test('the first turn persists the native conversation id for later resumption', async () => {
  const { session, table } = makeSession({
    onUser: (_message, { emit }) => {
      emit({ event: 'result', result: { status: 'SUCCESS', response: 'ok' } })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'work' })
  await nextEvent(session)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(table.get('child-1').conversationId, 'conv-1')
  assert.equal(table.get('child-1').promptInFlight, false)
  await session.dispose()
})

test('a live Config permission accessor is resolved when the CLI is spawned', async () => {
  const { session, spawns } = makeSession({ config: { permissionMode: { get: () => 'accept-edits' } } })
  await session.open()
  assert.deepEqual(spawns[0].argv.slice(-2), ['--mode=accept-edits', '--sandbox'])
  await session.dispose()
})

test('live Config accessors reach the spawn as current values', async () => {
  const { session, spawns, resolvedExecutables } = makeSession({
    config: {
      command: { get: () => '/opt/agy/bin/agy' },
      model: { get: () => 'gemini-4-neon-high' },
      effort: { get: () => 'high' },
      agent: { get: () => 'reviewer' },
      env: { get: () => ({ AGY_CUSTOM: '1' }) },
      permissionMode: { get: () => 'dangerously-skip-permissions' },
      disposeGraceMs: { get: () => 500 },
      disposeEofGraceMs: { get: () => 500 },
    },
  })
  await session.open()
  assert.deepEqual(resolvedExecutables[0], {
    command: '/opt/agy/bin/agy',
    env: { AGY_CUSTOM: '1' },
    signal: undefined,
  })
  assert.equal(spawns[0].argv[0], '/opt/agy/bin/agy')
  assert.deepEqual(spawns[0].env, { AGY_CUSTOM: '1' })
  const argv = spawns[0].argv
  assert.equal(argv.includes('--dangerously-skip-permissions'), true)
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 4), [
    '--model', 'gemini-4-neon-high', '--effort', 'high',
  ])
  assert.deepEqual(argv.slice(argv.indexOf('--agent'), argv.indexOf('--agent') + 2), ['--agent', 'reviewer'])
  await session.dispose()
})

test('a persisted child reopens the same conversation instead of replaying the task', async () => {
  const { session, spawns } = makeSession({
    records: { 'child-1': { conversationId: 'conv-existing', lastDshMessageId: 'msg-1', promptInFlight: false } },
  })
  await session.open()
  assert.equal(spawns[0].argv.at(-2), '--conversation')
  assert.equal(spawns[0].argv.at(-1), 'conv-existing')
  assert.equal(session.lastPromptMessageId, 'msg-1')
  await session.dispose()
})

test('an interrupted child turn can reopen with --conversation, rejects replaying the interrupted id, and accepts a new message', async () => {
  const { session, spawns } = makeSession({
    records: { 'child-1': { conversationId: 'conv-x', lastDshMessageId: 'msg-1', promptInFlight: true } },
    onUser: (_message, { emit }) => {
      emit({ event: 'result', result: { status: 'SUCCESS', response: 'continued' } })
    },
  })
  await session.open()
  assert.equal(spawns.length, 1)
  assert.deepEqual(spawns[0].argv.slice(-2), ['--conversation', 'conv-x'])
  await assert.rejects(() => session.startPrompt({ id: 'msg-1', text: 'replay' }), /cannot safely replay/)
  await session.startPrompt({ id: 'msg-2', text: 'continue' })
  const end = await nextEvent(session)
  assert.equal(end.kind, 'prompt-end')
  assert.equal(end.response, 'continued')
  assert.deepEqual(end.finish, { kind: 'stop' })
  await session.dispose()
})

test('assistant deltas stream in order and the result settles the turn with usage', async () => {
  const { session } = makeSession({
    onUser: (message, { emit }) => {
      assert.equal(message.event, 'user')
      emit({ event: 'step_update', step_update: { step_index: 0, state: 'DONE', step_type: 'user_input' } })
      emit({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'hel' } })
      emit({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'lo' } })
      emit({
        event: 'step_update',
        step_update: {
          step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '\n',
          usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 4, total_tokens: 12 },
        },
      })
      emit({ event: 'result', result: { status: 'SUCCESS', response: 'hello\n', usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 4, total_tokens: 12 } } })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'say hello' })
  assert.deepEqual(await nextEvent(session), { kind: 'assistant-text', text: 'hel' })
  assert.deepEqual(await nextEvent(session), { kind: 'assistant-text', text: 'lo' })
  assert.deepEqual(await nextEvent(session), { kind: 'assistant-text', text: '\n' })
  const end = await nextEvent(session)
  assert.equal(end.kind, 'prompt-end')
  assert.equal(end.status, 'SUCCESS')
  assert.equal(end.response, 'hello\n')
  assert.deepEqual(end.finish, { kind: 'stop' })
  assert.deepEqual(end.usage, { inputTokens: 6, outputTokens: 2, totalTokens: 12, cacheReadTokens: 4 })
  assert.equal(session.promptActive, false)
  await session.dispose()
})

test('a native tool step becomes a progress row whose terminal state the proxy can await', async () => {
  let child
  const { session } = makeSession({
    onUser: (_message, ctx) => {
      child = ctx
      ctx.emit({
        event: 'step_update',
        step_update: {
          step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'printf hello-tool' } },
        },
      })
      setImmediate(() => ctx.emit({
        event: 'step_update',
        step_update: {
          step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'printf hello-tool' }, output: 'hello-tool' },
        },
      }))
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'run it' })
  const row = await nextEvent(session)
  assert.equal(row.kind, 'tool-call')
  assert.equal(row.call.callId, 's2')
  assert.equal(row.call.kind, 'execute')
  assert.equal(row.call.title, 'printf hello-tool')
  assert.equal(row.call.status, 'in_progress')
  const settled = await session.waitForToolCall('s2')
  assert.equal(settled.status, 'completed')
  assert.equal(settled.output, 'hello-tool')
  assert.ok(child !== undefined)
  await session.dispose()
})

test('a tool error settles the row as failed with the product message', async () => {
  const { session } = makeSession({
    onUser: (_message, { emit }) => {
      emit({
        event: 'step_update',
        step_update: {
          step_index: 3, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'rm -rf /' } },
        },
      })
      emit({
        event: 'step_update',
        step_update: {
          step_index: 3, state: 'ERROR', step_type: 'tool', tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'rm -rf /' }, error: { type: 'TOOL_ERROR', message: 'user denied permission' } },
        },
      })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'delete everything' })
  await nextEvent(session)
  const settled = await session.waitForToolCall('s3')
  assert.equal(settled.status, 'failed')
  assert.equal(settled.error, 'user denied permission')
  await session.dispose()
})

test('a turn that ends with a live tool row fails that row instead of hanging', async () => {
  const { session } = makeSession({
    onUser: (_message, { emit }) => {
      emit({
        event: 'step_update',
        step_update: {
          step_index: 4, state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file',
          tool_info: { name: 'read_file', parameters: { Path: '/tmp/a.txt' } },
        },
      })
      emit({ event: 'step_update', step_update: { step_index: 5, state: 'DONE', step_type: 'agent_response', text_delta: 'done' } })
      emit({ event: 'result', result: { status: 'ERROR', response: '' } })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'read it' })
  assert.equal((await nextEvent(session)).kind, 'tool-call')
  assert.deepEqual(await nextEvent(session), { kind: 'assistant-text', text: 'done' })
  const end = await nextEvent(session)
  assert.equal(end.kind, 'prompt-end')
  assert.equal(end.finish.kind, 'error')
  const settled = await session.waitForToolCall('s4')
  assert.equal(settled.status, 'failed')
  await session.dispose()
})

test('prompt bookkeeping marks a child turn in flight until the CLI result arrives', async () => {
  const { session, table } = makeSession({
    onUser: (_message, { emit }) => {
      setImmediate(() => emit({ event: 'result', result: { status: 'SUCCESS', response: 'ok' } }))
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-7', text: 'work' })
  assert.equal(table.get('child-1').promptInFlight, true)
  assert.equal(table.get('child-1').lastDshMessageId, 'msg-7')
  await nextEvent(session)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(table.get('child-1').promptInFlight, false)
  await session.dispose()
})

test('cancellation disposes the process and settles pending tool rows', async () => {
  const { session } = makeSession({
    onUser: (_message, { emit }) => {
      emit({
        event: 'step_update',
        step_update: {
          step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'sleep 100' } },
        },
      })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'sleep' })
  assert.equal((await nextEvent(session)).kind, 'tool-call')
  const pending = session.waitForToolCall('s1')
  await session.cancelPrompt()
  const settled = await pending
  assert.equal(settled.status, 'failed')
  assert.equal(session.disposed, true)
  await session.dispose()
  assert.equal(session.process.stdin.writableEnded, true)
})

test('handleResult leaves promptEndConsumed false until the consumer marks it', async () => {
  const { session } = makeSession({
    onUser: (_message, { emit }) => {
      emit({ event: 'result', result: { status: 'SUCCESS', response: 'done' } })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'work' })
  const end = await nextEvent(session)
  assert.equal(end.kind, 'prompt-end')
  assert.equal(session.promptActive, false)
  assert.equal(session.promptEndConsumed, false)
  session.markPromptEndConsumed()
  assert.equal(session.promptEndConsumed, true)
  await session.dispose()
})

test('cancelled turn resets promptInFlight, resumes with --conversation on a new session, blocks msg-1 replay and allows msg-2', async () => {
  const sharedTable = makeTable()
  const spawns = []
  const makeCtx = (onUser) => ({
    subprocess: {
      async resolveExecutable(command) { return `/fake/${command}` },
      spawn(spec) {
        spawns.push(spec)
        return makeFakeChild({ onUser })
      },
    },
  })
  const agent = { session: { id: 'child-cancel', header: { cwd: '/workspace' } }, ctx: { effect: () => () => {} } }
  const config = {
    command: 'agy',
    permissionMode: 'default',
    env: {},
    disposeGraceMs: 1000,
    disposeEofGraceMs: 500,
  }

  const first = new StreamJsonChildSession(makeCtx(() => {}), agent, config, { table: () => sharedTable })
  await first.open()
  await first.startPrompt({ id: 'msg-1', text: 'slow task' })
  // Wait for `init` emitted on first stdin write to be processed.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sharedTable.get('child-cancel').promptInFlight, true)
  assert.equal(sharedTable.get('child-cancel').conversationId, 'conv-1')
  assert.equal(sharedTable.get('child-cancel').lastDshMessageId, 'msg-1')

  await first.cancelPrompt()
  assert.equal(sharedTable.get('child-cancel').promptInFlight, false)
  assert.equal(sharedTable.get('child-cancel').conversationId, 'conv-1')
  assert.equal(sharedTable.get('child-cancel').lastDshMessageId, 'msg-1')

  const second = new StreamJsonChildSession(makeCtx((_message, { emit }) => {
    emit({ event: 'result', result: { status: 'SUCCESS', response: 'recovered' } })
  }), agent, config, { table: () => sharedTable })
  await second.open()
  assert.deepEqual(spawns[1].argv.slice(-2), ['--conversation', 'conv-1'])
  await assert.rejects(() => second.startPrompt({ id: 'msg-1', text: 'replay' }), /cannot safely replay/)
  await second.startPrompt({ id: 'msg-2', text: 'next task' })
  const end = await nextEvent(second)
  assert.equal(end.kind, 'prompt-end')
  assert.equal(end.response, 'recovered')
  assert.deepEqual(end.finish, { kind: 'stop' })
  await second.dispose()
})

test('waitForToolCall rejects on abort and awaits process disposal quiescence', async () => {
  let exitFinished = false
  const table = makeTable()
  const ctx = {
    subprocess: {
      async resolveExecutable(command) { return `/fake/${command}` },
      spawn() {
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        let resolveDone
        const done = new Promise((resolve) => { resolveDone = resolve })
        const stdin = new Writable({
          write(chunk, _encoding, callback) {
            for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
              JSON.parse(line)
              stdout.write(`${JSON.stringify(INIT)}\n`)
              stdout.write(`${JSON.stringify({
                event: 'step_update',
                step_update: {
                  step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command',
                  tool_info: { name: 'run_command', parameters: { CommandLine: 'sleep 100' } },
                },
              })}\n`)
            }
            callback()
          },
        })
        stdin.on('finish', () => {
          setTimeout(() => {
            exitFinished = true
            stdout.end()
            resolveDone({ exitCode: 0, signal: null })
          }, 25)
        })
        return {
          stdin,
          stdout,
          stderr,
          done,
          terminate() {
            exitFinished = true
            resolveDone({ exitCode: null, signal: 'SIGTERM' })
          },
          async waitForExit() {
            await done
            return true
          },
        }
      },
    },
  }
  const agent = { session: { id: 'child-abort', header: { cwd: '/workspace' } }, ctx: { effect: () => () => {} } }
  const session = new StreamJsonChildSession(ctx, agent, {
    command: 'agy',
    permissionMode: 'default',
    env: {},
    disposeGraceMs: 1000,
    disposeEofGraceMs: 500,
  }, { table: () => table })

  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'run long tool' })
  assert.equal((await nextEvent(session)).kind, 'tool-call')

  const controller = new AbortController()
  const waiting = session.waitForToolCall('s1', controller.signal)
  controller.abort(new Error('user aborted tool'))
  await assert.rejects(() => waiting, /user aborted tool/)
  assert.equal(session.disposed, true)
  assert.equal(exitFinished, true)
})

test('waitForToolCall rejects when signal is already aborted even if tool already settled', async () => {
  const { session } = makeSession({
    onUser: (_message, { emit }) => {
      emit({
        event: 'step_update',
        step_update: {
          step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file',
          tool_info: { name: 'read_file', parameters: { Path: '/tmp/a' } },
        },
      })
      emit({
        event: 'step_update',
        step_update: {
          step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'read_file',
          tool_info: { name: 'read_file', parameters: { Path: '/tmp/a' }, output: 'ok' },
        },
      })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'read' })
  assert.equal((await nextEvent(session)).kind, 'tool-call')
  await new Promise(resolve => setImmediate(resolve))
  const controller = new AbortController()
  controller.abort(new Error('already aborted'))
  await assert.rejects(() => session.waitForToolCall('s1', controller.signal), /already aborted/)
  assert.equal(session.disposed, true)
})

test('idle CLI exit sets exited flag without enqueuing a poison process-exit event', async () => {
  const { session, children } = makeSession({
    onUser: (_message, { emit }) => {
      emit({ event: 'result', result: { status: 'SUCCESS', response: 'done' } })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'work' })
  const end = await nextEvent(session)
  assert.equal(end.kind, 'prompt-end')
  assert.equal(session.exited, false)

  children[0].terminate()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(session.exited, true)
  assert.equal(session.events.items.length, 0)
  await session.dispose()
})

test('blank SUCCESS result with no assistant text maps to an error finish reason', async () => {
  const { session } = makeSession({
    onUser: (_message, { emit }) => {
      emit({ event: 'result', result: { status: 'SUCCESS', response: '   ' } })
    },
  })
  await session.open()
  await session.startPrompt({ id: 'msg-1', text: 'empty' })
  const end = await nextEvent(session)
  assert.equal(end.kind, 'prompt-end')
  assert.equal(end.finish.kind, 'error')
  assert.equal(end.finish.failure.code, 'AGY_INVALID')
  await session.dispose()
})

test('open forwards signal to resolveExecutable and clamps invalid or excessive grace values', async () => {
  const controller = new AbortController()
  const { session, spawns, resolvedExecutables } = makeSession({
    config: {
      disposeGraceMs: MAX_TIMER_DELAY_MS + 5000,
      disposeEofGraceMs: MAX_TIMER_DELAY_MS + 5000,
    },
  })
  await session.open(controller.signal)
  assert.equal(resolvedExecutables[0].signal, controller.signal)
  assert.equal(spawns[0].graceMs, MAX_TIMER_DELAY_MS)
  await session.dispose()

  const fallback = makeSession({
    config: {
      disposeGraceMs: 0,
      disposeEofGraceMs: -10,
    },
  })
  await fallback.session.open()
  assert.equal(fallback.spawns[0].graceMs, 3000)
  await fallback.session.dispose()
})