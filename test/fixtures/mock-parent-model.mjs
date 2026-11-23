import { createServer } from 'node:http'

const port = Number(process.env.AGY_MOCK_PORT ?? 3082)
let requestCount = 0
let toolIssued = false

function blockText(block) {
  if (typeof block === 'string') return block
  if (Array.isArray(block)) return block.map(blockText).join('\n')
  if (typeof block !== 'object' || block === null) return ''
  return [
    typeof block.text === 'string' ? block.text : '',
    block.content === undefined ? '' : blockText(block.content),
  ].filter(Boolean).join('\n')
}

function event(type, fields = {}) {
  return { type, ...fields }
}

function sendSse(response, events) {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  for (const item of events) {
    response.write(`event: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`)
  }
  response.end()
}

function textReply(text) {
  return [
    event('message_start', {
      message: { id: `msg_${requestCount}`, type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], usage: { input_tokens: 24, output_tokens: 0 } },
    }),
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
    event('content_block_stop', { index: 0 }),
    event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 16 } }),
    event('message_stop'),
  ]
}

function toolReply() {
  toolIssued = true
  const input = {
    description: 'Agy status end-to-end smoke test',
    prompt: 'Run the read-only shell commands `sleep 12`, `pwd`, and `echo AGY_CHILD_COMPLETE_OK` in that order. Do not edit files. Return the command output and the exact completion marker.',
  }
  return [
    event('message_start', {
      message: { id: `msg_${requestCount}`, type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], usage: { input_tokens: 32, output_tokens: 0 } },
    }),
    event('content_block_start', {
      index: 0,
      content_block: { type: 'tool_use', id: `agy_call_${requestCount}`, name: 'subagent_antigravity', input },
    }),
    event('content_block_stop', { index: 0 }),
    event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } }),
    event('message_stop'),
  ]
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  if (request.method === 'GET' && (url.pathname.endsWith('/models') || url.pathname.endsWith('/v1/models'))) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'deepseek-flash', object: 'model', created: 0, owned_by: 'agy-test' }] }))
    return
  }
  if (request.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'not found' } }))
    return
  }

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  let body
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'invalid JSON' } }))
    return
  }

  requestCount += 1
  const messages = Array.isArray(body.messages) ? body.messages : []
  const allText = messages.map(message => blockText(message.content)).join('\n')
  const tools = Array.isArray(body.tools) ? body.tools : []
  const hasAgyTool = tools.some(tool => tool?.name === 'subagent_antigravity')
  const hasCompletion = allText.includes('AGY_CHILD_COMPLETE_OK')
  const hasStartReceipt = messages.some(message => Array.isArray(message.content)
    && message.content.some(block => block?.type === 'tool_result' && blockText(block.content).includes('started subagent')))
  let stage
  let events
  if (hasCompletion) {
    stage = 'completion'
    events = textReply('AGY_TEST_RESULT_OK: AGY_CHILD_COMPLETE_OK')
  } else if (hasStartReceipt) {
    stage = 'waiting'
    events = textReply('Agy child started; I will wait for its completion notice.')
  } else if (!toolIssued && hasAgyTool && allText.includes('AGY_STATUS_E2E_TRIGGER')) {
    stage = 'start-tool'
    events = toolReply()
  } else if (!hasAgyTool) {
    stage = 'title-or-no-tools'
    events = textReply('Agy status smoke test')
  } else {
    stage = 'wait-for-completion'
    events = textReply('Agy child is still running; I will wait for its completion notice.')
  }
  console.log(`AGY_MOCK request=${requestCount} stage=${stage} tools=${tools.map(tool => tool?.name).filter(Boolean).join(',')}`)
  sendSse(response, events)
})

server.listen(port, '127.0.0.1', () => {
  const address = server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port
  console.log(`AGY_MOCK listening http://127.0.0.1:${actualPort}`)
})

function stop() {
  server.close(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
