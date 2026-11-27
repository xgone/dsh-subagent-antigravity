import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import {
  AntigravityStreamLlmAdapter,
  callResultText,
  extractDshUserMessage,
  stripDshReturnGuidance,
} from '../src/adapter.js'
import { STREAM_MODEL, STREAM_PROVIDER } from '../src/stream-json.js'
import { createAgyProgressTool } from '../src/progress-tool.js'

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function fakeState(queue) {
  return {
    disposed: false,
    promptActive: true,
    promptEndConsumed: false,
    lastPromptMessageId: 'user-1',
    cancelled: false,
    events: {
      async next(signal) {
        if (queue.length > 0) return { done: false, value: queue.shift() }
        if (signal?.aborted) throw signal.reason
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    },
    markPromptEndConsumed() { this.promptEndConsumed = true },
    async cancelPrompt() { this.cancelled = true; this.disposed = true },
    async dispose() { this.disposed = true },
  }
}

function userMessage(text, id = 'user-1') {
  return { id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
}

test('child route advertises the CLI provider and one native model', async () => {
  const adapter = new AntigravityStreamLlmAdapter({}, {})
  assert.deepEqual(adapter.providerInfo(STREAM_PROVIDER), { id: STREAM_PROVIDER, name: 'Antigravity CLI' })
  const models = await adapter.listModels(STREAM_PROVIDER)
  assert.equal(models.length, 1)
  assert.equal(models[0].id, STREAM_MODEL)
  assert.deepEqual(models[0].inputModalities, ['text'])
})

test('assistant text and one native tool step become child-session stream blocks', async () => {
  const agent = { id: 'child-1', session: { id: 'child-1' } }
  const ctx = { agents: { get: id => id === agent.id ? agent : undefined } }
  const adapter = new AntigravityStreamLlmAdapter(ctx, {})
  const queue = [
    { kind: 'assistant-text', text: 'Checking the workspace. ' },
    {
      kind: 'tool-call',
      call: { callId: 's2', title: 'printf hello', kind: 'execute', rawInput: { CommandLine: 'printf hello' }, status: 'in_progress' },
    },
  ]
  adapter.sessions.set(agent.id, fakeState(queue))
  const chunks = await collect(adapter.stream({
    provider: STREAM_PROVIDER,
    model: STREAM_MODEL,
    sessionId: agent.id,
    messages: [userMessage('Inspect the workspace.')],
  }))
  assert.deepEqual(chunks.map(chunk => chunk.type), [
    'block-start', 'text-delta', 'block-end',
    'block-start', 'tool-call-delta', 'block-end', 'finish',
  ])
  assert.equal(chunks[4].name, 'agy_progress')
  assert.deepEqual(JSON.parse(chunks[4].argumentsDelta), {
    callId: 's2',
    title: 'printf hello',
    kind: 'execute',
    rawInputText: '{"CommandLine":"printf hello"}',
  })
  assert.deepEqual(chunks.at(-1).reason, { kind: 'tool-calls' })
})

test('a terminal turn closes the text block, reports usage and maps the finish reason', async () => {
  const agent = { id: 'child-2', session: { id: 'child-2' } }
  const ctx = { agents: { get: id => id === agent.id ? agent : undefined } }
  const adapter = new AntigravityStreamLlmAdapter(ctx, {})
  const queue = [
    { kind: 'assistant-text', text: 'all ' },
    { kind: 'assistant-text', text: 'done' },
    {
      kind: 'prompt-end',
      status: 'SUCCESS',
      response: 'all done',
      usage: { inputTokens: 5, outputTokens: 2 },
      finish: { kind: 'stop' },
    },
  ]
  const state = fakeState(queue)
  adapter.sessions.set(agent.id, state)
  const chunks = await collect(adapter.stream({
    sessionId: agent.id,
    messages: [userMessage('finish it')],
  }))
  assert.deepEqual(chunks.map(chunk => chunk.type), [
    'block-start', 'text-delta', 'text-delta', 'block-end', 'usage', 'finish',
  ])
  assert.deepEqual(chunks[3].block, { type: 'text', text: 'all done' })
  assert.deepEqual(chunks[4].usage, { inputTokens: 5, outputTokens: 2 })
  assert.deepEqual(chunks[5].reason, { kind: 'stop' })
  assert.equal(state.promptEndConsumed, true)
  assert.equal(state.disposed, false)
})

test('a resumed conversation replays the terminal response as its only assistant text', async () => {
  const agent = { id: 'child-3', session: { id: 'child-3' } }
  const ctx = { agents: { get: id => id === agent.id ? agent : undefined } }
  const adapter = new AntigravityStreamLlmAdapter(ctx, {})
  adapter.sessions.set(agent.id, fakeState([
    { kind: 'prompt-end', status: 'SUCCESS', response: 'replayed answer', finish: { kind: 'stop' } },
  ]))
  const chunks = await collect(adapter.stream({
    sessionId: agent.id,
    messages: [userMessage('resume')],
  }))
  assert.deepEqual(chunks.map(chunk => chunk.type), ['block-start', 'text-delta', 'block-end', 'finish'])
  assert.equal(chunks[1].text, 'replayed answer')
  assert.deepEqual(chunks[2].block, { type: 'text', text: 'replayed answer' })
})

test('an already completed child turn fails fast instead of replaying the prompt', async () => {
  const agent = { id: 'child-4', session: { id: 'child-4' } }
  const ctx = { agents: { get: id => id === agent.id ? agent : undefined } }
  const adapter = new AntigravityStreamLlmAdapter(ctx, {})
  const state = fakeState([])
  state.promptActive = false
  state.promptEndConsumed = true
  state.markPromptEndConsumed = () => {}
  adapter.sessions.set(agent.id, state)
  await assert.rejects(() => collect(adapter.stream({
    sessionId: agent.id,
    messages: [userMessage('again', 'user-1')],
  })), /already completed or failed/)
  assert.equal(state.cancelled, true)
})

test('stream cancellation disposes the CLI child and reports the abort', async () => {
  const agent = { id: 'child-5', session: { id: 'child-5' } }
  const ctx = { agents: { get: id => id === agent.id ? agent : undefined } }
  const adapter = new AntigravityStreamLlmAdapter(ctx, {})
  const state = fakeState([{ kind: 'assistant-text', text: 'working' }])
  adapter.sessions.set(agent.id, state)
  const controller = new AbortController()
  const stream = adapter.stream({
    sessionId: agent.id,
    signal: controller.signal,
    messages: [userMessage('work')],
  })
  assert.equal((await stream.next()).value.type, 'block-start')
  controller.abort(new Error('cancelled by test'))
  assert.equal((await stream.next()).value.type, 'text-delta')
  await assert.rejects(() => stream.next(), /cancelled by test/)
  assert.equal(state.cancelled, true)
})

test('DSH continuation guidance is stripped before the task reaches the CLI', () => {
  const prompt = 'Run pwd and return the result.\nYour parent agent id is "session-parent". Before you finish, send your result to that agent with send_message({ agent_id: "session-parent", message: "<self-contained result>" }). The parent shares your workspace.'
  assert.equal(stripDshReturnGuidance(prompt), 'Run pwd and return the result.')
  assert.equal(stripDshReturnGuidance('No DSH guidance here.'), 'No DSH guidance here.')
})

test('only user-authored and relayed tasks are forwarded to the CLI', () => {
  const task = { id: 'task-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Run pwd.' }] }
  const time = { id: 'time-1', role: 'user', source: { kind: 'time-context', form: 'snapshot' }, content: [{ type: 'text', text: 'Time sampled at 12:00.' }] }
  assert.deepEqual(extractDshUserMessage([task, time]), { id: 'task-1', text: 'Run pwd.' })
  const relay = { id: 'relay-1', role: 'user', source: { kind: 'agent-message', form: 'relay' }, content: [{ type: 'text', text: 'Check the change.' }] }
  assert.deepEqual(extractDshUserMessage([task, relay]), { id: 'relay-1', text: 'Check the change.' })
  const emptyId = { id: '', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }
  assert.deepEqual(extractDshUserMessage([emptyId]), { id: 'user-0-5', text: 'Hello' })
  assert.equal(extractDshUserMessage([{ id: 'x', role: 'assistant', content: [] }]), undefined)
})

test('the progress proxy records the completed CLI tool without executing it again', async () => {
  const adapter = {
    async waitForToolCall(sessionId, callId) {
      assert.equal(sessionId, 'child-6')
      assert.equal(callId, 's2')
      return {
        title: 'printf hello',
        status: 'completed',
        output: 'Command exited with code 0.\n\nCommand output:\nhello-tool',
        durationSeconds: 1.3,
        rawInput: { CommandLine: 'printf hello' },
      }
    },
  }
  const tool = createAgyProgressTool(adapter)
  const args = { callId: 's2', title: 'printf hello', kind: 'execute', rawInputText: '{"CommandLine":"printf hello"}' }
  const value = await tool.execute(args, { agent: { session: { id: 'child-6' } }, signal: new AbortController().signal })
  assert.equal(value.callId, 's2')
  assert.equal(value.status, 'completed')
  assert.equal(value.exitCode, 0)
  assert.equal(value.durationSeconds, 1.3)
  assert.match(value.outputText, /hello-tool/u)
  assert.deepEqual(tool.output.presentationMeta(args, value), {
    kind: 'execute',
    status: 'completed',
    exitCode: 0,
    durationSeconds: 1.3,
  })
  assert.deepEqual(tool.presentCall(args), { card: 'terminal', title: 'printf hello' })
  assert.deepEqual(tool.presentResult(args, { content: [{ type: 'text', text: value.outputText }] }), {
    card: 'terminal', title: 'printf hello', output: value.outputText,
  })
  assert.deepEqual(tool.output.render(args, value), [{ type: 'text', text: value.outputText }])
  assert.equal(callResultText({ status: 'failed', error: 'denied' }), 'denied')
  assert.equal(callResultText({ status: 'completed' }), 'Antigravity tool completed.')
})

test('progress proxy projects failure status and full path, and skips exitCode for non-execute tools', async () => {
  const adapter = {
    async waitForToolCall(_sessionId, callId) {
      if (callId === 's-fail') {
        return {
          title: 'rm -rf /',
          kind: 'execute',
          status: 'failed',
          error: 'user denied permission',
          rawInput: { CommandLine: 'rm -rf /' },
        }
      }
      return {
        title: 'read_file /workspace/notes.txt',
        kind: 'read',
        status: 'completed',
        output: 'log line: Command exited with code 2.',
        rawInput: { Path: '/workspace/notes.txt', Content: 'x'.repeat(5000) },
      }
    },
  }
  const tool = createAgyProgressTool(adapter)
  const failArgs = { callId: 's-fail', title: 'rm -rf /', kind: 'execute', rawInputText: '{}' }
  const failVal = await tool.execute(failArgs, { agent: { session: { id: 'c1' } }, signal: new AbortController().signal })
  assert.equal(failVal.status, 'failed')
  assert.deepEqual(tool.output.presentationMeta(failArgs, failVal), {
    kind: 'execute',
    status: 'failed',
  })

  const readArgs = { callId: 's-read', title: 'read_file /workspace/notes.txt', kind: 'read', rawInputText: '{"Path":"/workspace/notes.txt","Content":"truncated…' }
  const readVal = await tool.execute(readArgs, { agent: { session: { id: 'c1' } }, signal: new AbortController().signal })
  assert.equal(readVal.exitCode, undefined)
  assert.equal(readVal.path, '/workspace/notes.txt')
  assert.deepEqual(tool.output.presentationMeta(readArgs, readVal), {
    kind: 'read',
    status: 'completed',
    path: '/workspace/notes.txt',
  })
})

function makeFakeStreamChild(onUser) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let resolveDone
  let settled = false
  const done = new Promise(resolve => { resolveDone = resolve })
  const settle = (outcome) => {
    if (settled) return
    settled = true
    resolveDone(outcome)
  }
  const emit = (event) => { stdout.write(`${JSON.stringify(event)}\n`) }
  let initSent = false
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString('utf8').split('\n').filter(l => l.trim() !== '')) {
        const message = JSON.parse(line)
        if (!initSent) {
          initSent = true
          emit({ event: 'init', conversation_id: 'conv-live', init: { cwd: '/workspace', tools: [] } })
        }
        onUser(message, { emit, settle })
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
    async waitForExit() { await done; return true },
  }
}

test('real session + adapter delivers final reply when result arrives before the second stream() call', async () => {
  const records = new Map()
  const sessionDomain = {
    table: () => ({
      get: k => records.get(k),
      put: async (k, v) => { records.set(k, v) },
    }),
  }
  const agent = { id: 'child-e2e', session: { id: 'child-e2e', header: { cwd: '/workspace' } }, ctx: { effect: () => () => {} } }
  const ctx = {
    agents: { get: id => id === agent.id ? agent : undefined },
    subprocess: {
      async resolveExecutable(command) { return `/fake/${command}` },
      spawn() {
        return makeFakeStreamChild((_message, { emit }) => {
          // Tool starts, completes, assistant replies, and result arrives all before stream() is called a second time.
          emit({
            event: 'step_update',
            step_update: {
              step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command',
              tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hi' } },
            },
          })
          emit({
            event: 'step_update',
            step_update: {
              step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'run_command',
              tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hi' }, output: 'Command exited with code 0.\nhi' },
            },
          })
          emit({ event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'All set.' } })
          emit({ event: 'result', result: { status: 'SUCCESS', response: 'All set.' } })
        })
      },
    },
  }
  const config = { command: 'agy', permissionMode: 'default', env: {}, disposeGraceMs: 1000, disposeEofGraceMs: 500 }
  const adapter = new AntigravityStreamLlmAdapter(ctx, config, sessionDomain)
  const tool = createAgyProgressTool(adapter)

  const step1 = await collect(adapter.stream({
    sessionId: agent.id,
    messages: [userMessage('run echo', 'msg-1')],
  }))
  assert.deepEqual(step1.at(-1).reason, { kind: 'tool-calls' })
  const toolArgs = JSON.parse(step1.find(c => c.type === 'tool-call-delta').argumentsDelta)
  const toolResult = await tool.execute(toolArgs, { agent, signal: new AbortController().signal })
  assert.equal(toolResult.status, 'completed')
  assert.equal(toolResult.exitCode, 0)

  // Allow any pending microtasks so `result` has definitely been handled before step 2.
  await new Promise(resolve => setImmediate(resolve))

  const step2 = await collect(adapter.stream({
    sessionId: agent.id,
    messages: [userMessage('run echo', 'msg-1')],
  }))
  assert.deepEqual(step2.at(-1).reason, { kind: 'stop' })
  assert.equal(step2.find(c => c.type === 'block-end').block.text, 'All set.')

  // Replaying the same completed turn now fails closed.
  await assert.rejects(() => collect(adapter.stream({
    sessionId: agent.id,
    messages: [userMessage('run echo', 'msg-1')],
  })), /already completed or failed/)
  await adapter.disposeAll()
})

test('idle CLI process exit after turn 1 triggers automatic respawn with --conversation on turn 2', async () => {
  const records = new Map()
  const sessionDomain = {
    table: () => ({
      get: k => records.get(k),
      put: async (k, v) => { records.set(k, v) },
    }),
  }
  const spawns = []
  const children = []
  let turn = 0
  const agent = { id: 'child-respawn', session: { id: 'child-respawn', header: { cwd: '/workspace' } }, ctx: { effect: () => () => {} } }
  const ctx = {
    agents: { get: id => id === agent.id ? agent : undefined },
    subprocess: {
      async resolveExecutable(command) { return `/fake/${command}` },
      spawn(spec) {
        spawns.push(spec)
        const child = makeFakeStreamChild((_message, { emit }) => {
          turn += 1
          emit({ event: 'result', result: { status: 'SUCCESS', response: `reply-${turn}` } })
        })
        children.push(child)
        return child
      },
    },
  }
  const config = { command: 'agy', permissionMode: 'default', env: {}, disposeGraceMs: 1000, disposeEofGraceMs: 500 }
  const adapter = new AntigravityStreamLlmAdapter(ctx, config, sessionDomain)

  const turn1 = await collect(adapter.stream({
    sessionId: agent.id,
    messages: [userMessage('first', 'msg-1')],
  }))
  assert.equal(turn1.find(c => c.type === 'block-end').block.text, 'reply-1')
  assert.equal(spawns.length, 1)

  // Simulate the CLI process exiting while idle between turns.
  children[0].terminate()
  await new Promise(resolve => setImmediate(resolve))

  const turn2 = await collect(adapter.stream({
    sessionId: agent.id,
    messages: [userMessage('second', 'msg-2')],
  }))
  assert.equal(spawns.length, 2)
  assert.deepEqual(spawns[1].argv.slice(-2), ['--conversation', 'conv-live'])
  assert.equal(turn2.find(c => c.type === 'block-end').block.text, 'reply-2')
  assert.deepEqual(turn2.at(-1).reason, { kind: 'stop' })
  await adapter.disposeAll()
})

test('non-stop finish and blank SUCCESS dispose the session instead of keeping it alive', async () => {
  const agent = { id: 'child-err', session: { id: 'child-err' } }
  const ctx = { agents: { get: id => id === agent.id ? agent : undefined } }
  const adapter = new AntigravityStreamLlmAdapter(ctx, {})

  const errState = fakeState([
    { kind: 'prompt-end', status: 'ERROR', response: '', finish: { kind: 'error', failure: { message: 'boom', code: 'AGY_ERROR' } } },
  ])
  adapter.sessions.set(agent.id, errState)
  const errChunks = await collect(adapter.stream({ sessionId: agent.id, messages: [userMessage('fail')] }))
  assert.equal(errChunks.at(-1).reason.kind, 'error')
  assert.equal(errState.cancelled, true)

  const blankState = fakeState([
    { kind: 'prompt-end', status: 'SUCCESS', response: '   ', finish: { kind: 'stop' } },
  ])
  adapter.sessions.set(agent.id, blankState)
  const blankChunks = await collect(adapter.stream({ sessionId: agent.id, messages: [userMessage('blank')] }))
  assert.equal(blankChunks.at(-1).reason.kind, 'error')
  assert.equal(blankChunks.at(-1).reason.failure.code, 'AGY_INVALID')
  assert.equal(blankState.cancelled, true)
})