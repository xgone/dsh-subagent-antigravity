/**
 * One-shot Antigravity child lifecycle: resolve the real `agy` executable
 * through the subprocess seam, run one headless stream-json session in the
 * delegating Session's workspace, publish only after the CLI emits its `init`
 * event, and dispose to whole-range quiescence.
 *
 * Mirrors the Codex sibling's lifecycle boundaries:
 *   - task validation happens before the process boundary;
 *   - publication waits for a product-owned "session established" fact (`init`);
 *   - post-publication failures flatten into a `SubagentResult` via the shared
 *     `settleRunResult`;
 *   - teardown closes stdin, terminates the managed range and waits for exit.
 *
 * @module dsh-subagent-antigravity/run
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import {
  settleRunResult,
  subprocessRunHandle,
} from '@deepseek-ai/dsh-subagent'
import {
  buildArgv,
  classifyResult,
  encodeUserEvent,
  failureDiagnostic,
  NdjsonEventFeed,
} from './antigravity.js'

/**
 * One private product failure, carrying fixed safe facts plus an internal
 * cause chain that never enters model-visible text.
 */
export class AntigravityRunError extends Error {
  /**
   * @param {{stage: string, category: string, status?: string, outcome?: {exitCode: number|null, signal: string|null}}} facts
   * @param {unknown} [cause]
   */
  constructor(facts, cause) {
    super(
      `subagent-antigravity: ${failureDiagnostic(facts)}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'AntigravityRunError'
    this.facts = facts
  }
}

/**
 * Hide an unpublished host/product failure behind fixed safe startup facts.
 * @param {unknown} cause - original failure retained only on the Error cause chain.
 * @returns {AntigravityRunError}
 */
export function antigravityStartupFailure(cause) {
  return new AntigravityRunError({ stage: 'initialize', category: 'unknown' }, cause)
}

/**
 * Validate and preserve the one-shot task before crossing the process boundary.
 * @param {ReadonlyArray<{type: string, text?: string}>} prompt - content blocks from the shared service.
 * @returns {Array<{type: 'text', text: string}>} the exact text blocks to send.
 */
export function textTask(prompt) {
  if (!Array.isArray(prompt) || prompt.length === 0) {
    throw new Error('subagent-antigravity: the one-shot task must contain only text blocks')
  }
  /** @type {Array<{type: 'text', text: string}>} */
  const texts = []
  for (const block of prompt) {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') {
      throw new Error('subagent-antigravity: the one-shot task must contain only text blocks')
    }
    texts.push({ type: 'text', text: block.text })
  }
  if (texts.every((block) => block.text.trim().length === 0)) {
    throw new Error('subagent-antigravity: the one-shot task must not be empty')
  }
  return texts
}

/**
 * Normalize a caught unknown into an Error.
 * @param {unknown} value
 * @returns {Error}
 */
function thrown(value) {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Close the private feed, terminate the managed range and wait for the
 * subprocess owner to prove quiescence.
 * @param {NdjsonEventFeed} feed
 * @param {import('@deepseek-ai/dsh-subprocess').SubprocessHandle} child
 * @returns {Promise<void>}
 */
export async function disposeAntigravityChild(feed, child) {
  feed.end()

  /** @type {import('@deepseek-ai/dsh-subprocess').SubprocessOutcome | undefined} */
  let outcome
  void child.done.then(
    (value) => { outcome = value },
    () => {},
  )
  try {
    child.stdin?.end()
  } catch {
    // A concurrently closed stdin does not change range ownership below.
  }
  child.terminate()
  try {
    await child.waitForExit()
  } catch (error) {
    throw new AntigravityRunError({ stage: 'teardown', category: 'unknown', outcome }, thrown(error))
  }
  await child.done.catch(() => {})
}

/**
 * Fully resolved inputs for one Antigravity CLI run.
 * @typedef {object} AntigravityRunSpec
 * @property {string} cwd - selected child working directory.
 * @property {string} [model] - optional `--model`.
 * @property {string} [effort] - optional `--effort`.
 * @property {string} [agent] - optional `--agent`.
 * @property {string} permissionMode - permission posture (see antigravity.js).
 * @property {Record<string, string>} env - explicit env overlay.
 * @property {number} disposeGraceMs - managed-range termination grace.
 * @property {string} command - executable name/path to resolve (default `agy`).
 * @property {(command: string, env?: Readonly<Record<string,string>>, signal?: AbortSignal) => Promise<string>} resolveExecutable
 * @property {(spec: import('@deepseek-ai/dsh-subprocess').SubprocessSpawnSpec) => import('@deepseek-ai/dsh-subprocess').SubprocessHandle} spawn
 * @property {(error: Error, stopReason: string) => void} [onError]
 */

/**
 * Start one real `agy` headless session and publish its one-shot run.
 * @param {import('@deepseek-ai/dsh-subagent').SubagentStartRequest} request
 * @param {AntigravityRunSpec} spec
 * @returns {Promise<import('@deepseek-ai/dsh-subagent').SubagentRun>}
 */
export async function startAntigravityRun(request, spec) {
  const blocks = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-antigravity: request was aborted before CLI startup')
  }

  let executable
  try {
    executable = await spec.resolveExecutable(spec.command, spec.env, request.signal)
  } catch (error) {
    throw new AntigravityRunError({ stage: 'initialize', category: 'unknown' }, thrown(error))
  }

  /** @type {import('@deepseek-ai/dsh-subprocess').SubprocessHandle} */
  let child
  try {
    child = spec.spawn({
      argv: buildArgv(executable, spec),
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: spec.disposeGraceMs,
      env: spec.env,
    })
  } catch (error) {
    throw new AntigravityRunError({ stage: 'initialize', category: 'unknown' }, thrown(error))
  }

  const feed = new NdjsonEventFeed()
  const onStdoutData = (chunk) => { feed.feed(chunk) }
  const onStdoutEnd = () => { feed.end() }
  const onStderr = (chunk) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    try {
      // Synchronous fd forwarding preserves byte order without owning a
      // backpressure queue. A slow host sink can block this event-loop turn.
      writeFileSync(process.stderr.fd, bytes)
    } catch {
      // Host stderr is an observation sink, not a child-run failure authority.
    }
  }
  child.stdout?.on('data', onStdoutData)
  child.stdout?.on('end', onStdoutEnd)
  child.stdout?.on('error', onStdoutEnd)
  child.stderr?.on('data', onStderr)
  child.stderr?.on('error', () => {})
  // A child closing stdin while we still hold it surfaces asynchronously as an
  // 'error' event; consume it so an EPIPE cannot crash the Host process.
  child.stdin?.on('error', () => {})

  /** @type {{stage: string, category: string, outcome?: {exitCode: number|null, signal: string|null}} | undefined} */
  let processFailureFacts
  const processFailure = child.done.then(
    (outcome) => {
      processFailureFacts = { stage: 'process', category: 'process', outcome }
      throw new AntigravityRunError(processFailureFacts)
    },
    (error) => {
      processFailureFacts = { stage: 'process', category: 'unknown' }
      throw new AntigravityRunError(processFailureFacts, thrown(error))
    },
  )
  // A normal post-result dispose also closes the process; keep the expected
  // late rejection observed when the terminal result settles first.
  processFailure.catch(() => {})

  const runAbort = new AbortController()
  const requestCancel = () => {
    if (runAbort.signal.aborted) return
    runAbort.abort(new Error('subagent-antigravity: run cancelled locally'))
    child.terminate()
    try { child.stdin?.end() } catch { /* stdin may already be closed */ }
  }
  const onAbort = () => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  const disposeProcess = async () => {
    try {
      await disposeAntigravityChild(feed, child)
      // Let stderr already queued by the process close reach the Host before
      // its forwarding listeners are detached.
      await new Promise((resolve) => { setImmediate(resolve) })
    } finally {
      child.stdout?.off('data', onStdoutData)
      child.stdout?.off('end', onStdoutEnd)
      child.stdout?.off('error', onStdoutEnd)
      child.stderr?.off('data', onStderr)
    }
  }

  const initPromise = feed.waitFor('init')
  const resultPromise = feed.waitFor('result')

  // --- startup gate: publish only after the CLI reports an established session.
  const startupStage = 'initialize'
  try {
    if (child.stdin === undefined) {
      throw new Error('subagent-antigravity: child stdin was not piped')
    }
    child.stdin.write(encodeUserEvent(blocks))
    const first = await Promise.race([initPromise, resultPromise, processFailure])
    if (first.event === 'result') {
      // A result before `init` means the session never established: surface a
      // product failure rather than publishing a dead run.
      const classification = classifyResult(first.result)
      const facts = {
        stage: 'initialize',
        category: classification.category ?? 'product-error',
        status: classification.status,
        ...(processFailureFacts?.outcome === undefined ? {} : { outcome: processFailureFacts.outcome }),
      }
      throw new AntigravityRunError(facts)
    }
    if (first.event === 'eof') {
      throw new AntigravityRunError({
        stage: 'initialize',
        category: 'process',
        ...(processFailureFacts?.outcome === undefined ? {} : { outcome: processFailureFacts.outcome }),
      })
    }
    // first.event === 'init' -> session established.
  } catch (error) {
    request.signal.removeEventListener('abort', onAbort)
    const cancelledBeforeCleanup = runAbort.signal.aborted || request.signal.aborted
    const failure = error instanceof AntigravityRunError
      ? error
      : new AntigravityRunError({
        stage: startupStage,
        category: 'unknown',
        ...(processFailureFacts?.outcome === undefined ? {} : { outcome: processFailureFacts.outcome }),
      }, thrown(error))
    try {
      await disposeProcess()
    } catch (disposeError) {
      const cleanupFailure = thrown(disposeError)
      throw new AggregateError(
        [failure, cleanupFailure],
        `${failure.message}; ${cleanupFailure.message}`,
      )
    }
    if (cancelledBeforeCleanup) {
      throw new Error('subagent-antigravity: request was aborted before run publication')
    }
    throw failure
  }

  // --- published run.
  const collectOutput = () => {
    const response = feed.result?.response
    const text = typeof response === 'string' && response.trim().length > 0
      ? response
      : feed.agentText
    return typeof text === 'string' && text.trim().length > 0
      ? [{ type: 'text', text }]
      : []
  }
  /** @type {string | undefined} */
  let diagnostic
  const record = (facts) => {
    diagnostic = failureDiagnostic(facts)
    return diagnostic
  }
  const withOutcome = (facts) => (
    processFailureFacts?.outcome === undefined
      ? facts
      : { ...facts, outcome: processFailureFacts.outcome }
  )
  const publishedProcessFailure = processFailure.catch(async (error) => {
    // Frames already queued by the exiting CLI remain authoritative. One I/O
    // turn lets them settle before process exit ends the run.
    await new Promise((resolve) => { setImmediate(resolve) })
    throw error
  })

  /** @type {Promise<import('@deepseek-ai/dsh-subagent').SubagentResult>} */
  const result = settleRunResult({
    attempt: async () => {
      try {
        const event = await Promise.race([resultPromise, publishedProcessFailure])
        if (event.event === 'eof') {
          const facts = withOutcome({ stage: 'run', category: 'invalid-result' })
          record(facts)
          throw new AntigravityRunError(facts)
        }
        const classification = classifyResult(event.result)
        if (classification.stopReason === 'completed') {
          return { output: [{ type: 'text', text: classification.text }], stopReason: 'completed' }
        }
        if (classification.stopReason === 'aborted') {
          return { output: collectOutput(), stopReason: 'aborted' }
        }
        const facts = withOutcome({
          stage: 'run',
          category: classification.category,
          status: classification.status,
        })
        record(facts)
        throw new AntigravityRunError(facts)
      } catch (error) {
        if (error instanceof AntigravityRunError) {
          if (diagnostic === undefined) record(error.facts)
          throw error
        }
        const facts = withOutcome({ stage: 'process', category: 'unknown' })
        record(facts)
        throw new AntigravityRunError(facts, thrown(error))
      }
    },
    collectOutput,
    collectDiagnostic: () => diagnostic,
    cancelled: () => runAbort.signal.aborted,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })

  return subprocessRunHandle({
    id: randomUUID(),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: disposeProcess,
  })
}
