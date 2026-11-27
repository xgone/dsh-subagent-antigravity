import test from 'node:test'
import assert from 'node:assert/strict'
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