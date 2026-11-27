/**
 * Pure, dependency-free protocol helpers for the Antigravity CLI (`agy`)
 * headless stream-json interface.
 *
 * Everything here can be unit-tested without spawning a process or importing
 * any `@deepseek-ai/*` runtime package: argv construction, the one-shot user
 * event encoding, the NDJSON event feed, terminal-status classification and
 * the safe failure diagnostic.
 *
 * Why stream-json rather than `-p`:
 *   - the prompt crosses stdin, so arbitrarily large tasks never hit ARG_MAX or
 *     shell quoting;
 *   - the terminal `result` event is the single authoritative outcome;
 *   - the `init` event proves the CLI accepted the session before we publish.
 *
 * @module @xgone/dsh-subagent-antigravity/antigravity
 */

import { StringDecoder } from 'node:string_decoder'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3000

/** Grace window for the CLI to flush a child session after stdin EOF. */
export const DEFAULT_DISPOSE_EOF_GRACE_MS = 6000

/**
 * Profile-selectable unattended permission posture, mapped to native `agy`
 * flags. These are the only knobs that decide whether the product asks a human
 * (it cannot answer one in headless mode) and how much it may do unsupervised.
 */
export const ANTIGRAVITY_PERMISSION_MODES = [
  'default',
  'accept-edits',
  'auto',
  'dangerously-skip-permissions',
]

/**
 * Read a Config value that may be a live `volatile` accessor.
 * @template T
 * @param {unknown} value - a plain value or an accessor exposing `get()`.
 * @returns {T}
 */
export function volatileValue(value) {
  if (value !== null && typeof value === 'object' && typeof (/** @type {{get?: () => T}} */ (value).get) === 'function') {
    return /** @type {{get: () => T}} */ (value).get()
  }
  return /** @type {T} */ (value)
}

/**
 * Read a permission posture that may be a live Config `volatile` accessor.
 * @param {unknown} value
 * @returns {string}
 */
export function permissionModeValue(value) {
  return volatileValue(value)
}

/** Default posture: sandbox commands and do not auto-approve operations. */
export const DEFAULT_ANTIGRAVITY_PERMISSION_MODE = 'default'

/** Native `agy` reasoning-effort values (availability depends on the model). */
export const ANTIGRAVITY_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Terminal `status` values reported by the `agy` result envelope. */
export const ANTIGRAVITY_TERMINAL_STATUSES = [
  'SUCCESS',
  'ERROR',
  'CANCELED',
  'INTERRUPTED',
  'INVALID',
  'WAITING',
  'RUNNING',
]

/**
 * Map a permission posture to `agy` startup flags.
 * @param {string} mode - one of {@link ANTIGRAVITY_PERMISSION_MODES}.
 * @returns {string[]} the extra argv entries (before model/effort/agent flags).
 */
export function permissionModeArgs(mode) {
  switch (mode) {
    case 'default':
      // No auto-approval; sandbox containment stays on for any executed command.
      return ['--sandbox']
    case 'accept-edits':
      // Auto-approve workspace file edits, keep commands sandboxed.
      return ['--mode=accept-edits', '--sandbox']
    case 'auto':
      // Edits + sandboxed/safe commands auto-approved; irreversible actions still prompt.
      return ['--mode=auto', '--sandbox']
    case 'dangerously-skip-permissions':
      // Fully unsupervised; must be selected explicitly by deployment config.
      return ['--dangerously-skip-permissions']
    default:
      throw new Error(`subagent-antigravity: unknown permissionMode: ${String(mode)}`)
  }
}

/**
 * Build the fixed `agy` argv for one headless stream-json session.
 * @param {string} executable - resolved absolute path to `agy`.
 * @param {{permissionMode: string, model?: string, effort?: string, agent?: string}} spec
 * @returns {string[]} argv passed verbatim to the subprocess seam (no shell).
 */
export function buildArgv(executable, spec) {
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new Error('subagent-antigravity: an executable path is required')
  }
  const argv = [
    executable,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    // Keep a task whose text starts with `/model`, `/plan`, … from being
    // interpreted as a CLI slash command (which would ERROR and end the session).
    '--disable-slash-commands',
    ...permissionModeArgs(spec.permissionMode),
  ]
  if (spec.model !== undefined) argv.push('--model', spec.model)
  if (spec.effort !== undefined) argv.push('--effort', spec.effort)
  if (spec.agent !== undefined) argv.push('--agent', spec.agent)
  return argv
}

/**
 * Encode exactly one user turn as the newline-delimited `user` event the CLI
 * reads from stdin in `--input-format stream-json` mode.
 * @param {ReadonlyArray<{type: 'text', text: string}>} blocks - validated text blocks.
 * @returns {string} one JSON line, including the trailing newline.
 */
export function encodeUserEvent(blocks) {
  return `${JSON.stringify({ event: 'user', message: { content: blocks } })}\n`
}

/**
 * Parse one NDJSON line into an event object, or return `undefined` for blank
 * or non-event lines. The CLI keeps diagnostics on stderr, so a stdout line
 * that is not a JSON object with a string `event` is ignorable noise.
 * @param {string} line
 * @returns {{event: string, [key: string]: unknown} | undefined}
 */
export function parseEventLine(line) {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  if (typeof parsed.event !== 'string' || parsed.event.length === 0) return undefined
  return parsed
}

/**
 * The terminal result payload carried by the `result` event, if present.
 * @param {unknown} result
 * @returns {{status?: string, response?: string, error?: string, conversation_id?: string} | undefined}
 */
export function resultPayload(result) {
  if (result === null || typeof result !== 'object') return undefined
  return /** @type {Record<string, unknown>} */ (result)
}

/**
 * Classify a terminal `result` envelope into a subagent stop reason.
 * @param {unknown} result - the `result.result` payload.
 * @returns {{stopReason: 'completed'|'aborted'|'error', text?: string, category?: string, status: string}}
 */
export function classifyResult(result) {
  const payload = resultPayload(result)
  const rawStatus = payload !== undefined && typeof payload.status === 'string' ? payload.status : ''
  // Never reflect an untrusted product string into model-visible diagnostics.
  // The CLI documents this closed terminal set; every other value is one fixed label.
  const status = ANTIGRAVITY_TERMINAL_STATUSES.includes(rawStatus)
    ? rawStatus
    : rawStatus === '' ? 'missing' : 'unknown'
  const response = payload !== undefined && typeof payload.response === 'string' ? payload.response : ''
  switch (status) {
    case 'SUCCESS':
      if (response.trim().length === 0) {
        return { stopReason: 'error', category: 'invalid-result', status }
      }
      return { stopReason: 'completed', text: response, status }
    case 'CANCELED':
    case 'INTERRUPTED':
      return { stopReason: 'aborted', status }
    case 'INVALID':
      return { stopReason: 'error', category: 'invalid-result', status }
    case 'ERROR':
      return { stopReason: 'error', category: 'product-error', status }
    case 'WAITING':
    case 'RUNNING':
      return { stopReason: 'error', category: 'unknown', status }
    case 'unknown':
      return { stopReason: 'error', category: 'unknown', status }
    case 'missing':
    default:
      return { stopReason: 'error', category: 'invalid-result', status: 'missing' }
  }
}

/**
 * Build the fixed, safe failure diagnostic exposed to the parent. It carries
 * only product/stage/category/status and process-exit facts, never response
 * text, tool inputs, paths, environment values or raw protocol payloads.
 * @param {{stage: string, category: string, status?: string, outcome?: {exitCode: number|null, signal: string|null}}} facts
 * @returns {string}
 */
export function failureDiagnostic(facts) {
  const fields = [
    'product: Antigravity',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  if (facts.status !== undefined) {
    const safeStatus = ANTIGRAVITY_TERMINAL_STATUSES.includes(facts.status)
      || facts.status === 'missing'
      || facts.status === 'unknown'
      ? facts.status
      : 'unknown'
    fields.push(`status: ${safeStatus}`)
  }
  const exitCode = facts.outcome?.exitCode
  if (exitCode !== null && exitCode !== undefined) fields.push(`exit code: ${exitCode}`)
  const signal = facts.outcome?.signal
  if (signal !== null && signal !== undefined) fields.push(`signal: ${signal}`)
  return `Product subagent failure (${fields.join('; ')})`
}

/**
 * A small newline-delimited JSON feed over a child's stdout. It records every
 * event, lets a caller await a specific event type, and — critically — never
 * rejects a waiter: when the stream ends before the awaited event arrives, the
 * waiter resolves with an `{event: 'eof'}` sentinel so racing branches cannot
 * produce unhandled rejections.
 */
export class NdjsonEventFeed {
  /** @type {string} */
  #buffer = ''
  /** @type {ReadonlyArray<{event: string, [key: string]: unknown}>} */
  #events = []
  /** @type {Array<{type: string, resolve: (value: any) => void}>} */
  #waiters = []
  /** @type {boolean} */
  #ended = false
  /** @type {StringDecoder} */
  #decoder = new StringDecoder('utf8')
  /** @type {((event: {event: string, [key: string]: unknown}) => void) | undefined} */
  #onEvent
  /** @type {boolean} */
  #store

  /**
   * @param {{onEvent?: (event: {event: string, [key: string]: unknown}) => void, store?: boolean}} [options]
   *   `onEvent` observes every dispatched event; `store` keeps the event log
   *   (default true). A long-lived child session disables storage so a
   *   multi-turn conversation cannot grow without bound.
   */
  constructor(options = {}) {
    this.#onEvent = options.onEvent
    this.#store = options.store ?? true
  }

  /**
   * Feed a raw stdout chunk (Buffer or string). StringDecoder preserves a
   * multi-byte UTF-8 character split across adjacent Buffer chunks.
   * @param {Buffer | string} chunk
   */
  feed(chunk) {
    if (this.#ended) return
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    this.#buffer += this.#decoder.write(bytes)
    this.#drainLines()
  }

  /** Dispatch every complete NDJSON line currently buffered. */
  #drainLines() {
    let newlineIndex
    while ((newlineIndex = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, newlineIndex)
      this.#buffer = this.#buffer.slice(newlineIndex + 1)
      this.#dispatch(line)
    }
  }

  /**
   * Signal that stdout closed; flush a trailing unterminated line, then settle
   * any still-pending waiter with an `eof` sentinel.
   */
  end() {
    if (this.#ended) return
    this.#buffer += this.#decoder.end()
    this.#drainLines()
    this.#ended = true
    const rest = this.#buffer.trim()
    this.#buffer = ''
    if (rest.length > 0) this.#dispatch(rest)
    const pending = this.#waiters
    this.#waiters = []
    for (const waiter of pending) waiter.resolve({ event: 'eof' })
  }

  /**
   * Await the next event of a given type. Returns immediately if one was
   * already recorded; resolves `{event:'eof'}` if the stream already ended.
   * @param {string} type
   * @returns {Promise<{event: string, [key: string]: unknown}>}
   */
  waitFor(type) {
    const found = this.#events.find((event) => event.event === type)
    if (found !== undefined) return Promise.resolve(found)
    if (this.#ended) return Promise.resolve({ event: 'eof' })
    return new Promise((resolve) => {
      this.#waiters.push({ type, resolve })
    })
  }

  /** @param {string} line */
  #dispatch(line) {
    const event = parseEventLine(line)
    if (event === undefined) return
    if (this.#store) this.#events.push(event)
    this.#onEvent?.(event)
    const keep = []
    for (const waiter of this.#waiters) {
      if (waiter.type === event.event) waiter.resolve(event)
      else keep.push(waiter)
    }
    this.#waiters = keep
  }

  /** Whether stdout closed and pending waiters were settled with `eof`. */
  get ended() {
    return this.#ended
  }

  /** @returns {ReadonlyArray<{event: string, [key: string]: unknown}>} */
  get events() {
    return this.#events
  }

  /** The payload of the first `result` event, if one arrived. */
  get result() {
    const event = this.#events.find((candidate) => candidate.event === 'result')
    return event === undefined ? undefined : resultPayload(event.result)
  }

  /** The payload of the first `init` event, if one arrived. */
  get init() {
    const event = this.#events.find((candidate) => candidate.event === 'init')
    return event === undefined ? undefined : resultPayload(event.init)
  }

  /**
   * Accumulated text deltas from the last non-empty `agent_response` step.
   * The terminal `result.response` remains authoritative for completion; this
   * stream text is retained as partial output if the result is blank or fails.
   * @returns {string}
   */
  get agentText() {
    /** @type {Map<number | string, string>} */
    const textByStep = new Map()
    /** @type {Array<number | string>} */
    const order = []
    /** @type {Set<number | string>} */
    const completed = new Set()

    for (const event of this.#events) {
      if (event.event !== 'step_update') continue
      const step = resultPayload(event.step_update)
      if (step === undefined || step.step_type !== 'agent_response') continue
      const key = typeof step.step_index === 'number' ? step.step_index : 'unknown'
      if (!textByStep.has(key)) {
        textByStep.set(key, '')
        order.push(key)
      }
      if (typeof step.text_delta === 'string') {
        textByStep.set(key, (textByStep.get(key) ?? '') + step.text_delta)
      }
      if (step.state === 'DONE') completed.add(key)
    }

    const lastCompleted = [...order].reverse().find(key =>
      completed.has(key) && (textByStep.get(key) ?? '').trim().length > 0)
    const lastStep = [...order].reverse().find(key => (textByStep.get(key) ?? '').trim().length > 0)
    const selected = lastCompleted ?? lastStep
    return selected === undefined ? '' : textByStep.get(selected) ?? ''
  }
}
