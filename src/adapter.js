/**
 * DSH child-session LLM route backed by a live Antigravity CLI (`agy`) process.
 *
 * DSH still owns the child Agent and its Session; this adapter only translates
 * between the harness stream vocabulary and the CLI's own stream-json events.
 * Every native tool step becomes a `agy_progress` call in the child Session so
 * the built-in subagent UI shows a durable, live progress row, while the CLI
 * keeps full control of its model requests and tool execution.
 *
 * @module @xgone/dsh-subagent-antigravity/adapter
 */

import { randomUUID } from 'node:crypto'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import {
  PROGRESS_TOOL_NAME,
  STREAM_MODEL,
  STREAM_PROVIDER,
  safeJson,
  streamFinishReason,
} from './stream-json.js'
import { StreamJsonChildSession } from './session.js'

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('Antigravity CLI operation was aborted')
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

export { STREAM_MODEL, STREAM_PROVIDER }

/**
 * Native tool result text already prepared by the session bookkeeping.
 * @param {{status: string, output?: string, error?: string}} call
 * @returns {string}
 */
export function callResultText(call) {
  const output = typeof call.output === 'string' ? call.output : ''
  if (output !== '') return output
  const error = typeof call.error === 'string' ? call.error : ''
  return error === '' ? `Antigravity tool ${call.status}.` : error
}

function contentText(content) {
  if (Array.isArray(content)) {
    return content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
  }
  return content?.type === 'text' && typeof content.text === 'string' ? content.text : ''
}

/**
 * DSH appends a "return your result to the parent agent" instruction to child
 * tasks. The Antigravity child never sees the harness tool vocabulary, so that
 * suffix would only confuse it.
 * @param {string} text
 * @returns {string}
 */
export function stripDshReturnGuidance(text) {
  const marker = 'Your parent agent id is '
  const index = text.lastIndexOf(marker)
  if (index === -1) return text
  const suffix = text.slice(index)
  if (!/^Your parent agent id is .+?\. Before you finish, send your result to that agent with send_message\(/su.test(suffix)) {
    return text
  }
  return text.slice(0, index).trimEnd()
}

/**
 * Select the newest user-authored task in one DSH request.
 * @param {ReadonlyArray<any>} messages
 * @returns {{id: string, text: string} | undefined}
 */
export function extractDshUserMessage(messages) {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    const sourceKind = message.source?.kind
    if (sourceKind !== 'user' && sourceKind !== 'agent-message') continue
    const text = stripDshReturnGuidance(contentText(message.content)).trim()
    if (text === '') continue
    const id = typeof message.id === 'string' && message.id.length > 0
      ? message.id
      : `user-${index}-${text.length}`
    return { id, text }
  }
  return undefined
}

/**
 * One provider route whose children are Antigravity CLI conversations.
 */
export class AntigravityStreamLlmAdapter extends LlmAdapter {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {object} config - resolved provider config.
   * @param {{table: (name: string) => any}} sessionDomain
   */
  constructor(ctx, config, sessionDomain) {
    super()
    this.ctx = ctx
    this.config = config
    this.sessionDomain = sessionDomain
    /** @type {Map<string, StreamJsonChildSession>} */
    this.sessions = new Map()
    /** @type {Map<string, boolean>} */
    this.turnTextSeen = new Map()
  }

  /** @param {string} provider */
  providerInfo(provider) {
    return { id: provider, name: 'Antigravity CLI' }
  }

  /** @param {string} provider */
  listModels(provider) {
    return Promise.resolve([{
      provider,
      id: STREAM_MODEL,
      name: 'Antigravity native settings',
      inputModalities: ['text'],
    }])
  }

  /**
   * Stream one child turn. A turn that produced a native tool step ends with a
   * `tool-calls` finish so the child Session records the progress row; the next
   * call resumes draining the same CLI turn.
   * @param {import('@deepseek-ai/dsh-llm').GenerateOptions} options
   * @returns {AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk>}
   */
  async *stream(options) {
    if (options.signal?.aborted) {
      if (options.sessionId !== undefined) await this.sessions.get(options.sessionId)?.cancelPrompt()
      throw abortError(options.signal)
    }
    if (options.sessionId === undefined) throw new Error('Antigravity CLI requires a DSH child Session id')
    const sessionId = options.sessionId
    const prompt = extractDshUserMessage(options.messages)
    if (prompt === undefined) throw new Error('Antigravity CLI requires a non-empty user task')
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('Antigravity CLI could not resolve its live DSH child Agent')
    const state = await this.ensureSession(sessionId, agent, options.signal)
    let keepSession = false
    let blockIndex = 0
    let textStarted = false
    let textContent = ''
    try {
      throwIfAborted(options.signal)
      if (!state.promptActive && state.lastPromptMessageId !== prompt.id) {
        this.turnTextSeen.set(sessionId, false)
        await state.startPrompt(prompt, options.signal)
      } else if (!state.promptActive && state.lastPromptMessageId === prompt.id && state.promptEndConsumed) {
        throw new Error('Antigravity CLI has already completed or failed this child task; send a new message to continue')
      }

      for (;;) {
        const next = await state.events.next(options.signal)
        if (next.done) throw new Error('Antigravity CLI session closed before the turn completed')
        const event = next.value
        if (event.kind === 'assistant-text') {
          if (!textStarted) {
            textStarted = true
            yield { type: 'block-start', index: blockIndex, blockType: 'text' }
          }
          textContent += event.text
          if (event.text.trim() !== '') this.turnTextSeen.set(sessionId, true)
          yield { type: 'text-delta', index: blockIndex, text: event.text }
          continue
        }
        if (event.kind === 'tool-call') {
          if (textStarted) {
            yield { type: 'block-end', index: blockIndex, block: { type: 'text', text: textContent } }
            blockIndex += 1
          }
          const call = event.call
          const dshCallId = randomUUID()
          const args = JSON.stringify({
            callId: call.callId,
            title: call.title,
            kind: call.kind,
            rawInputText: safeJson(call.rawInput),
          })
          yield { type: 'block-start', index: blockIndex, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: blockIndex, id: dshCallId, name: PROGRESS_TOOL_NAME, argumentsDelta: args }
          yield {
            type: 'block-end',
            index: blockIndex,
            block: { type: 'tool-call', id: dshCallId, name: PROGRESS_TOOL_NAME, arguments: args },
          }
          keepSession = true
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        if (event.kind === 'prompt-end') {
          state.markPromptEndConsumed()
          const hasAssistantText = Boolean(state.turnHasAssistantText)
            || this.turnTextSeen.get(sessionId) === true
            || textContent.trim() !== ''
          this.turnTextSeen.delete(sessionId)
          // A resumed conversation replays no deltas; the terminal response is
          // then the only assistant text of the turn.
          if (!textStarted && typeof event.response === 'string' && event.response.trim() !== '') {
            textStarted = true
            textContent = event.response
            yield { type: 'block-start', index: blockIndex, blockType: 'text' }
            yield { type: 'text-delta', index: blockIndex, text: event.response }
          }
          if (textStarted) {
            yield { type: 'block-end', index: blockIndex, block: { type: 'text', text: textContent } }
          }
          const finish = event.status === 'SUCCESS'
            ? streamFinishReason(event.status, { hasAssistantText, response: event.response })
            : event.finish
          if (event.usage !== undefined) yield { type: 'usage', usage: event.usage }
          keepSession = finish.kind === 'stop'
          yield { type: 'finish', reason: finish }
          return
        }
        if (event.kind === 'error') throw event.error
        if (event.kind === 'process-exit') throw new Error('Antigravity CLI process exited before completing its turn')
      }
    } catch (error) {
      if (options.signal?.aborted) {
        await state.cancelPrompt()
        throw abortError(options.signal)
      }
      throw error
    } finally {
      if (!keepSession) {
        this.turnTextSeen.delete(sessionId)
        await state.cancelPrompt()
      }
    }
  }

  /**
   * Reuse the child's live CLI process, or spawn one (resuming its persisted
   * conversation) after the previous process was disposed.
   * @param {string} sessionId
   * @param {{session: {id: string, header: {cwd: string}}, ctx: any}} agent
   * @param {AbortSignal} [signal]
   */
  async ensureSession(sessionId, agent, signal) {
    throwIfAborted(signal)
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined && !existing.disposed && !existing.exited) return existing
    if (existing !== undefined) {
      this.sessions.delete(sessionId)
      this.turnTextSeen.delete(sessionId)
      await existing.dispose()
    }
    const state = new StreamJsonChildSession(this.ctx, agent, this.config, this.sessionDomain)
    try {
      await state.open(signal)
      throwIfAborted(signal)
    } catch (error) {
      await state.dispose()
      throw signal?.aborted ? abortError(signal) : error
    }
    this.sessions.set(sessionId, state)
    agent.ctx.effect(() => () => this.disposeSession(sessionId), `agy-stream.child-session:${sessionId}`)
    return state
  }

  /**
   * Await one native tool step terminal state for the progress proxy tool.
   * @param {string} sessionId
   * @param {string} callId
   * @param {AbortSignal} [signal]
   */
  async waitForToolCall(sessionId, callId, signal) {
    const state = this.sessions.get(sessionId)
    if (state === undefined) throw new Error('Antigravity CLI progress session is missing')
    return state.waitForToolCall(callId, signal)
  }

  /**
   * @param {string} sessionId
   */
  async disposeSession(sessionId) {
    const state = this.sessions.get(sessionId)
    this.turnTextSeen.delete(sessionId)
    if (state === undefined) return
    this.sessions.delete(sessionId)
    await state.dispose()
  }

  async disposeAll() {
    const sessionIds = [...this.sessions.keys()]
    await Promise.all(sessionIds.map(sessionId => this.disposeSession(sessionId)))
  }
}