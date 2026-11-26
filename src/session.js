/**
 * One long-lived Antigravity CLI (`agy`) child process per DSH child Session.
 *
 * The CLI is driven over its own stream-json protocol: this class owns the
 * process, the NDJSON event feed, the native tool-step bookkeeping and the
 * durable conversation mapping. It is transport state only — the LLM adapter
 * turns these events into DSH stream chunks, and the progress proxy tool turns
 * each tool step into a durable child-session row.
 *
 * Compared with an ACP child there is no protocol request/response pair: a turn
 * starts when a `user` line is written and ends when the product emits its
 * `result` event. Cancellation has no native message, so a cancelled turn
 * disposes the process and the next activation resumes the same conversation
 * with `--conversation`.
 *
 * @module @xgone/dsh-subagent-antigravity/session
 */

import { NdjsonEventFeed, permissionModeValue } from './antigravity.js'
import {
  buildStreamArgv,
  conversationIdOf,
  encodeUserTurn,
  oneLine,
  streamFinishReason,
  toTokenUsage,
  toolKind,
  toolOutputText,
  toolTitle,
} from './stream-json.js'

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('Antigravity CLI operation was aborted')
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

/**
 * Await a value, rejecting as soon as `signal` aborts.
 * @template T
 * @param {Promise<T> | T} value
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
export function awaitWithSignal(value, signal) {
  throwIfAborted(signal)
  if (signal === undefined) return Promise.resolve(value)
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(value).then(result => {
      cleanup()
      resolve(result)
    }, error => {
      cleanup()
      reject(error)
    })
    if (signal.aborted) onAbort()
  })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject, settled: false }
}

/**
 * Ordered event queue with abort-aware consumers; closing settles every waiter.
 */
export class AsyncEventQueue {
  constructor() {
    /** @type {Array<any>} */
    this.items = []
    /** @type {Array<{resolve: (value: any) => void, reject: (error: any) => void, cleanup: () => void}>} */
    this.waiters = []
    /** @type {boolean} */
    this.closed = false
    /** @type {unknown} */
    this.failure = undefined
  }

  /** @param {any} item */
  push(item) {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) {
      this.items.push(item)
      return
    }
    waiter.cleanup()
    waiter.resolve({ done: false, value: item })
  }

  /** @param {unknown} [error] */
  close(error) {
    if (this.closed) return
    this.closed = true
    this.failure = error
    for (const waiter of this.waiters.splice(0)) {
      waiter.cleanup()
      if (error === undefined) waiter.resolve({ done: true, value: undefined })
      else waiter.reject(error)
    }
  }

  /**
   * @param {AbortSignal} [signal]
   * @returns {Promise<{done: false, value: any} | {done: true, value: undefined}>}
   */
  next(signal) {
    if (this.items.length > 0) return Promise.resolve({ done: false, value: this.items.shift() })
    if (this.closed) {
      return this.failure === undefined
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.reject(this.failure)
    }
    if (signal?.aborted) return Promise.reject(abortError(signal))
    return new Promise((resolve, reject) => {
      /** @type {{resolve: (value: any) => void, reject: (error: any) => void, cleanup: () => void}} */
      const waiter = { resolve, reject, cleanup: () => {} }
      if (signal !== undefined) {
        const onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          waiter.cleanup()
          reject(abortError(signal))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort)
      }
      this.waiters.push(waiter)
      if (signal?.aborted) {
        const index = this.waiters.indexOf(waiter)
        if (index !== -1) this.waiters.splice(index, 1)
        waiter.cleanup()
        reject(abortError(signal))
      }
    })
  }
}

/**
 * Native tool-step bookkeeping shared between the adapter and the proxy tool.
 * @typedef {object} NativeToolCall
 * @property {string} callId
 * @property {number | undefined} stepIndex
 * @property {string} title
 * @property {string} kind
 * @property {unknown} rawInput
 * @property {string} status
 * @property {string} [output]
 * @property {string} [error]
 * @property {{promise: Promise<NativeToolCall>, resolve: (call: NativeToolCall) => void, settled: boolean}} result
 */

export class StreamJsonChildSession {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - context carrying the subprocess seam.
   * @param {{session: {id: string, header: {cwd: string}}}} agent - the live DSH child Agent.
   * @param {object} config - resolved provider config (command, permissionMode, model/effort/agent, env, graces).
   * @param {{table: (name: string) => any}} sessionDomain - durable conversation sidecar.
   */
  constructor(ctx, agent, config, sessionDomain) {
    this.ctx = ctx
    this.agent = agent
    this.config = config
    this.sessionDomain = sessionDomain
    this.dshSessionId = agent.session.id
    this.cwd = agent.session.header.cwd
    this.events = new AsyncEventQueue()
    /** @type {Map<string, NativeToolCall>} */
    this.toolCalls = new Map()
    this.promptActive = false
    this.promptEndConsumed = true
    this.promptAbortSignal = undefined
    this.promptAbortListener = undefined
    this.promptEpoch = 0
    this.lastPromptMessageId = undefined
    this.lastUsage = undefined
    this.conversationId = undefined
    this.disposed = false
    this.disposePromise = undefined
    /** @type {import('@deepseek-ai/dsh-subprocess').SubprocessHandle | undefined} */
    this.process = undefined
    /** @type {NdjsonEventFeed | undefined} */
    this.feed = undefined
    this.exitDeferred = deferred()
  }

  /**
   * Spawn the CLI, wait for its `init` event and persist the native
   * conversation id. Reopening a persisted child resumes that conversation.
   * @param {AbortSignal} [signal]
   */
  async open(signal) {
    throwIfAborted(signal)
    const previous = this.sessionDomain.table('sessions').get(this.dshSessionId)
    if (previous?.promptInFlight === true) {
      throw new Error('Antigravity CLI cannot safely replay a child turn interrupted before completion')
    }
    if (typeof previous?.conversationId === 'string') this.conversationId = previous.conversationId
    if (typeof previous?.lastDshMessageId === 'string') this.lastPromptMessageId = previous.lastDshMessageId
    const executable = await awaitWithSignal(
      this.ctx.subprocess.resolveExecutable(this.config.command, this.config.env),
      signal,
    )
    throwIfAborted(signal)
    this.process = this.ctx.subprocess.spawn({
      argv: buildStreamArgv(
        executable,
        { ...this.config, permissionMode: permissionModeValue(this.config.permissionMode) },
        previous?.conversationId,
      ),
      cwd: this.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      graceMs: this.config.disposeGraceMs,
      env: this.config.env,
    })
    if (this.process.stdin === undefined || this.process.stdout === undefined) {
      await this.dispose()
      throw new Error('Antigravity CLI subprocess did not provide piped stdio')
    }
    this.feed = new NdjsonEventFeed({
      store: false,
      onEvent: (event) => { this.handleEvent(event) },
    })
    const onData = (chunk) => { this.feed?.feed(chunk) }
    const onEnd = () => { this.feed?.end() }
    this.process.stdout.on('data', onData)
    this.process.stdout.on('end', onEnd)
    this.process.stdout.on('error', onEnd)
    // A child closing stdin while we still hold it surfaces asynchronously as an
    // 'error' event; consume it so an EPIPE can never crash the Host process.
    this.process.stdin.on?.('error', () => {})
    void this.process.done.then((outcome) => {
      this.exitDeferred.resolve(outcome)
      if (!this.disposed) this.events.push({ kind: 'process-exit', outcome })
    }, () => {
      this.exitDeferred.resolve(undefined)
      if (!this.disposed) {
        this.events.push({ kind: 'error', error: new Error('Antigravity CLI subprocess failed') })
      }
    })

    // The CLI reports `init` only once the first turn is submitted, so liveness
    // is proved by the process surviving its startup window, not by a handshake.
    const settled = await Promise.race([
      this.exitDeferred.promise.then(outcome => ({ exited: true, outcome })),
      new Promise((resolve) => {
        const timer = setTimeout(() => { resolve({ exited: false }) }, 100)
        timer.unref?.()
      }),
    ])
    if (settled.exited) {
      await this.dispose()
      throw new Error('Antigravity CLI exited before it accepted a turn')
    }
  }

  /**
   * Persist conversation identity and turn bookkeeping for this child Session.
   * @param {Record<string, unknown>} [overrides]
   */
  persistRecord(overrides = {}) {
    const table = this.sessionDomain.table('sessions')
    const current = table.get(this.dshSessionId) ?? {}
    const next = { ...current, ...overrides }
    if (this.conversationId !== undefined) next.conversationId = this.conversationId
    if (next.promptInFlight === undefined) next.promptInFlight = this.promptActive
    return table.put(this.dshSessionId, next)
  }

  /**
   * Route one parsed NDJSON event into native tool bookkeeping and the queue.
   * @param {{event: string, [key: string]: unknown}} event
   */
  handleEvent(event) {
    if (this.disposed) return
    if (event.event === 'init') {
      const conversationId = conversationIdOf(event)
      if (conversationId !== undefined && conversationId !== this.conversationId) {
        this.conversationId = conversationId
        void this.persistRecord().catch((error) => {
          if (!this.disposed) {
            this.events.push({
              kind: 'error',
              error: new Error('Antigravity CLI conversation could not be persisted', { cause: error }),
            })
          }
        })
      }
      return
    }
    if (event.event === 'step_update') {
      const step = event.step_update
      if (step === null || typeof step !== 'object') return
      this.handleStep(/** @type {Record<string, unknown>} */ (step))
      return
    }
    if (event.event === 'result') {
      const result = event.result
      if (result === null || typeof result !== 'object') return
      this.handleResult(/** @type {Record<string, unknown>} */ (result))
    }
  }

  /**
   * @param {Record<string, unknown>} step
   */
  handleStep(step) {
    const state = typeof step.state === 'string' ? step.state : ''
    if (step.step_type === 'agent_response') {
      const delta = typeof step.text_delta === 'string' ? step.text_delta : ''
      if (delta !== '') this.events.push({ kind: 'assistant-text', text: delta })
      const usage = toTokenUsage(step.usage)
      if (usage !== undefined) this.lastUsage = usage
      return
    }
    if (step.step_type !== 'tool') return

    const stepIndex = typeof step.step_index === 'number' ? step.step_index : undefined
    const callId = `s${stepIndex === undefined ? 'unknown' : stepIndex}`
    const toolName = typeof step.tool_name === 'string' ? step.tool_name : 'Antigravity tool'
    const info = step.tool_info !== null && typeof step.tool_info === 'object'
      ? /** @type {Record<string, unknown>} */ (step.tool_info)
      : {}
    const nativeName = typeof info.name === 'string' ? info.name : toolName

    if (state === 'ACTIVE') {
      if (this.toolCalls.has(callId)) return
      /** @type {NativeToolCall} */
      const call = {
        callId,
        stepIndex,
        title: oneLine(toolTitle(nativeName, info.parameters)),
        kind: toolKind(nativeName),
        rawInput: info.parameters,
        status: 'in_progress',
        result: deferred(),
      }
      this.toolCalls.set(callId, call)
      this.events.push({ kind: 'tool-call', call })
      return
    }

    const existing = this.toolCalls.get(callId)
    const call = existing ?? {
      callId,
      stepIndex,
      title: oneLine(toolTitle(nativeName, info.parameters)),
      kind: toolKind(nativeName),
      rawInput: info.parameters,
      status: 'in_progress',
      result: deferred(),
    }
    if (existing === undefined) this.toolCalls.set(callId, call)
    if (call.result.settled) return
    call.status = state === 'ERROR' ? 'failed' : 'completed'
    call.output = toolOutputText(info)
    if (state === 'ERROR') {
      call.error = call.output === '' ? 'Antigravity tool failed' : call.output
    }
    call.result.settled = true
    call.result.resolve(call)
    if (existing === undefined) this.events.push({ kind: 'tool-call', call })
  }

  /**
   * @param {Record<string, unknown>} result
   */
  handleResult(result) {
    const conversationId = typeof result.conversation_id === 'string' && result.conversation_id.length > 0
      ? result.conversation_id
      : undefined
    if (conversationId !== undefined) this.conversationId = conversationId
    if (!this.promptActive) return
    this.promptActive = false
    this.promptEndConsumed = true
    this.clearPromptAbortListener()
    this.promptEpoch += 1
    this.failPendingTools('Antigravity turn ended before the tool completed')
    const status = typeof result.status === 'string' ? result.status : ''
    const response = typeof result.response === 'string' ? result.response : ''
    const usage = toTokenUsage(result.usage) ?? this.lastUsage
    this.events.push({
      kind: 'prompt-end',
      status,
      response,
      usage,
      finish: streamFinishReason(status),
    })
    if (this.lastPromptMessageId !== undefined) {
      void this.persistRecord({ promptInFlight: false }).catch((error) => {
        this.events.push({
          kind: 'error',
          error: new Error('Antigravity CLI completion could not be persisted', { cause: error }),
        })
      })
    }
  }

  /** @param {string} reason */
  failPendingTools(reason) {
    for (const call of this.toolCalls.values()) {
      if (call.result.settled) continue
      call.status = 'failed'
      call.error = reason
      call.result.settled = true
      call.result.resolve(call)
    }
  }

  clearPromptAbortListener() {
    if (this.promptAbortSignal !== undefined && this.promptAbortListener !== undefined) {
      this.promptAbortSignal.removeEventListener('abort', this.promptAbortListener)
    }
    this.promptAbortSignal = undefined
    this.promptAbortListener = undefined
  }

  /**
   * Write one DSH turn to the CLI and record it as in flight.
   * @param {{id: string, text: string}} message
   * @param {AbortSignal} [signal]
   */
  async startPrompt(message, signal) {
    if (this.promptActive) throw new Error('Antigravity CLI already has an active turn for this child')
    throwIfAborted(signal)
    const previousMessageId = this.lastPromptMessageId
    const table = this.sessionDomain.table('sessions')
    const restoreRecord = () => {
      const current = table.get(this.dshSessionId) ?? {}
      const restored = { ...current, promptInFlight: false }
      if (previousMessageId === undefined) delete restored.lastDshMessageId
      else restored.lastDshMessageId = previousMessageId
      if (this.conversationId !== undefined) restored.conversationId = this.conversationId
      return table.put(this.dshSessionId, restored)
    }
    await this.persistRecord({ promptInFlight: true, lastDshMessageId: message.id })
    if (signal?.aborted) {
      await restoreRecord()
      throw abortError(signal)
    }
    this.promptActive = true
    this.promptEndConsumed = false
    this.lastPromptMessageId = message.id
    this.lastUsage = undefined
    this.promptEpoch += 1
    if (signal !== undefined) {
      this.promptAbortSignal = signal
      this.promptAbortListener = () => { void this.cancelPrompt() }
      signal.addEventListener('abort', this.promptAbortListener, { once: true })
    }
    try {
      throwIfAborted(signal)
      this.process.stdin.write(encodeUserTurn(message.text))
    } catch (error) {
      this.clearPromptAbortListener()
      this.promptActive = false
      this.promptEndConsumed = true
      this.lastPromptMessageId = previousMessageId
      if (signal?.aborted) {
        try { await restoreRecord() } catch { /* in-flight state remains fail-closed */ }
      }
      throw error
    }
  }

  /** Mark the current turn's terminal event as already consumed by a stream. */
  markPromptEndConsumed() {
    this.promptEndConsumed = true
  }

  /**
   * Await one native tool step's terminal state.
   * @param {string} callId
   * @param {AbortSignal} [signal]
   * @returns {Promise<NativeToolCall>}
   */
  async waitForToolCall(callId, signal) {
    const call = this.toolCalls.get(callId)
    if (call === undefined) throw new Error('Antigravity CLI tool call is no longer available')
    if (signal?.aborted) {
      await this.cancelPrompt()
      throw abortError(signal)
    }
    if (call.result.settled) return call.result.promise
    if (signal === undefined) return call.result.promise
    const aborted = new Promise((_, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        void this.cancelPrompt()
        reject(abortError(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      call.result.promise.finally(() => signal.removeEventListener('abort', onAbort)).catch(() => {})
    })
    return Promise.race([call.result.promise, aborted])
  }

  /**
   * There is no native per-turn cancel message: cancelling the turn disposes the
   * process, and the next activation resumes the same conversation.
   */
  async cancelPrompt() {
    if (this.disposed) return
    await this.dispose()
  }

  dispose() {
    this.disposePromise ??= this.disposeOwnedProcess()
    return this.disposePromise
  }

  async disposeOwnedProcess() {
    if (this.disposed) return
    this.disposed = true
    this.promptActive = false
    this.clearPromptAbortListener()
    this.promptEpoch += 1
    this.failPendingTools('Antigravity CLI session disposed')
    this.events.close()
    try { this.process?.stdin?.end() } catch { /* stdin may already be closed */ }
    let exited = this.process === undefined
    if (!exited) {
      const eofGrace = Number(this.config.disposeEofGraceMs)
      const bounded = Number.isFinite(eofGrace) && eofGrace > 0 ? eofGrace : 6000
      try {
        exited = await this.process.waitForExit(AbortSignal.timeout(Math.ceil(bounded)))
      } catch {
        exited = false
      }
    }
    if (exited === false) {
      try { this.process?.terminate() } catch { /* process may already have exited */ }
      try { await this.process?.waitForExit() } catch { /* disposal still awaits done below */ }
    }
    await this.process?.done.catch(() => {})
  }
}