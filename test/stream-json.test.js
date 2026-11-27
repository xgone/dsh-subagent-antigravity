import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROGRESS_TOOL_NAME,
  parseExitCode,
  toolPath,
  STREAM_MODEL,
  STREAM_PROVIDER,
  buildStreamArgv,
  conversationIdOf,
  encodeUserTurn,
  oneLine,
  toTokenUsage,
  toolKind,
  toolOutputText,
  toolTitle,
  streamFinishReason,
} from '../src/stream-json.js'

test('child route advertises one native model behind the CLI provider', () => {
  assert.equal(STREAM_PROVIDER, 'agy-stream')
  assert.equal(STREAM_MODEL, 'native')
  assert.equal(PROGRESS_TOOL_NAME, 'agy_progress')
})

test('buildStreamArgv keeps the CLI in stream-json mode and appends native overrides', () => {
  assert.deepEqual(buildStreamArgv('/usr/bin/agy', { permissionMode: 'default' }), [
    '/usr/bin/agy', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--disable-slash-commands', '--sandbox',
  ])
  assert.deepEqual(
    buildStreamArgv('agy', {
      permissionMode: 'dangerously-skip-permissions',
      model: 'gemini-4-neon-high',
      effort: 'high',
      agent: 'reviewer',
    }, 'conversation-1'),
    ['agy', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--disable-slash-commands', '--dangerously-skip-permissions',
      '--model', 'gemini-4-neon-high', '--effort', 'high', '--agent', 'reviewer',
      '--conversation', 'conversation-1'],
  )
  assert.throws(() => buildStreamArgv('', { permissionMode: 'default' }), /executable path/)
  assert.throws(() => buildStreamArgv('agy', { permissionMode: 'bogus' }), /unknown permissionMode/)
  assert.throws(() => buildStreamArgv('agy', { permissionMode: 'default' }, '--bad-flag'), /invalid conversationId/)
  assert.throws(() => buildStreamArgv('agy', { permissionMode: 'default' }, '-x'), /invalid conversationId/)
  assert.throws(() => buildStreamArgv('agy', { permissionMode: 'default' }, 'conv\n1'), /invalid conversationId/)
  assert.throws(() => buildStreamArgv('agy', { permissionMode: 'default' }, 'conv\x001'), /invalid conversationId/)
  assert.throws(() => buildStreamArgv('agy', { permissionMode: 'default' }, 'conv\x7f1'), /invalid conversationId/)
})

test('encodeUserTurn writes exactly one NDJSON user event', () => {
  const line = encodeUserTurn('do the thing')
  assert.equal(line.at(-1), '\n')
  assert.equal(line.split('\n').filter(Boolean).length, 1)
  assert.deepEqual(JSON.parse(line), {
    event: 'user',
    message: { content: [{ type: 'text', text: 'do the thing' }] },
  })
})

test('executed and advertised tool names both map to UI card kinds', () => {
  assert.equal(toolKind('run_command'), 'execute')
  assert.equal(toolKind('execute_browser_javascript'), 'execute')
  assert.equal(toolKind('read_file'), 'read')
  assert.equal(toolKind('view_file'), 'read')
  assert.equal(toolKind('write_to_file'), 'edit')
  assert.equal(toolKind('multi_replace_file_content'), 'edit')
  assert.equal(toolKind('grep_search'), 'search')
  assert.equal(toolKind('read_url_content'), 'fetch')
  assert.equal(toolKind('delete_file'), 'delete')
  assert.equal(toolKind('invoke_subagent'), 'other')
  assert.equal(toolKind(undefined), 'other')
})

test('tool titles lead with the acted-on value for commands', () => {
  assert.equal(toolTitle('run_command', { CommandLine: 'printf hello' }), 'printf hello')
  assert.equal(toolTitle('read_file', { Path: '/tmp/a.jsonl' }), 'read_file /tmp/a.jsonl')
  assert.equal(toolTitle('invoke_subagent', { description: 'audit the repo' }), 'invoke_subagent audit the repo')
  assert.equal(toolTitle('mystery_tool', {}), 'mystery_tool')
  assert.equal(toolTitle('run_command', { CommandLine: `ls\n${'x'.repeat(400)}` }).length <= 160, true)
})

test('tool output prefers native output then the failure text', () => {
  assert.equal(toolOutputText({ output: 'Command output:\nhi' }), 'Command output:\nhi')
  assert.equal(toolOutputText({ error: { type: 'TOOL_ERROR', message: 'denied' } }), 'denied')
  assert.equal(toolOutputText({}), '')
  assert.equal(toolOutputText(null), '')
  assert.equal(toolOutputText({ output: 'y'.repeat(20_000) }).length, 12_000)
})

test('command results expose their exit code and acted-on path', () => {
  assert.equal(parseExitCode('Command exited with code 0.\n\nCommand output:\nok'), 0)
  assert.equal(parseExitCode('Command exited with code 2.'), 2)
  assert.equal(parseExitCode('exit code: 127'), 127)
  assert.equal(parseExitCode('no code here'), undefined)
  assert.equal(parseExitCode(undefined), undefined)

  assert.equal(toolPath({ Path: '/tmp/a.txt' }), '/tmp/a.txt')
  assert.equal(toolPath({ FilePath: '/w/b.ts' }), '/w/b.ts')
  assert.equal(toolPath({ Path: '/tmp/a.txt', FilePath: '/w/b.ts' }), '/tmp/a.txt')
  assert.equal(toolPath({ CommandLine: 'ls' }), undefined)
  assert.equal(toolPath(null), undefined)
})

test('native usage maps onto disjoint DSH token accounting', () => {
  assert.deepEqual(toTokenUsage({
    input_tokens: 14346,
    output_tokens: 110,
    thinking_tokens: 60,
    cache_read_tokens: 10052,
    total_tokens: 14456,
  }), {
    inputTokens: 4294,
    outputTokens: 110,
    totalTokens: 14456,
    cacheReadTokens: 10052,
    reasoningTokens: 60,
  })
  assert.deepEqual(toTokenUsage({ input_tokens: 10, output_tokens: 2 }), {
    inputTokens: 10, outputTokens: 2, totalTokens: 12,
  })
  assert.equal(toTokenUsage({}), undefined)
  assert.equal(toTokenUsage(null), undefined)
})

test('terminal CLI statuses map to DSH finish reasons with fixed messages', () => {
  assert.deepEqual(streamFinishReason('SUCCESS'), { kind: 'stop' })
  assert.deepEqual(streamFinishReason('SUCCESS', { hasAssistantText: true, response: '' }), { kind: 'stop' })
  assert.deepEqual(streamFinishReason('SUCCESS', { hasAssistantText: false, response: 'ok' }), { kind: 'stop' })
  for (const blank of ['', '   ', '\n\t']) {
    const emptySuccess = streamFinishReason('SUCCESS', { hasAssistantText: false, response: blank })
    assert.equal(emptySuccess.kind, 'error')
    assert.equal(emptySuccess.failure.code, 'AGY_INVALID')
  }
  assert.equal(streamFinishReason('CANCELED').kind, 'aborted')
  assert.equal(streamFinishReason('INTERRUPTED').kind, 'aborted')
  for (const status of ['ERROR', 'INVALID', 'WAITING', 'RUNNING', 'unexpected', '']) {
    const reason = streamFinishReason(status)
    assert.equal(reason.kind, 'error')
    assert.match(reason.failure.message, /^Antigravity CLI/u)
    assert.match(reason.failure.code, /^AGY_/u)
  }
})

test('conversation ids are read from init and result envelopes', () => {
  assert.equal(conversationIdOf({ event: 'init', conversation_id: 'conv-a', init: {} }), 'conv-a')
  assert.equal(conversationIdOf({ event: 'result', result: { conversation_id: 'conv-b' } }), 'conv-b')
  assert.equal(conversationIdOf({ event: 'result', result: {} }), undefined)
  assert.equal(conversationIdOf({ event: 'init', conversation_id: '' }), undefined)
  assert.equal(conversationIdOf(null), undefined)
})

test('display helpers never throw on hostile product values', () => {
  assert.equal(oneLine('a\nb\tc'), 'a b c')
  assert.equal(oneLine(undefined), '')
  assert.equal(oneLine('z'.repeat(200), 10), 'zzzzzzzzz…')
})