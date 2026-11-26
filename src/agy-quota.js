const AGY_QUOTA_ARGUMENTS = Object.freeze([
  '--print', '/usage', '--output-format', 'json', '--print-timeout', '30s',
])

const STDOUT_LIMIT_BYTES = 256 * 1024
const STDERR_LIMIT_BYTES = 4096
const PROCESS_GRACE_MS = 2000
const DEFAULT_REFRESH_MS = 60_000
const FAILURE_REFRESH_MS = 15_000
const DEFAULT_TIMEOUT_MS = 35_000

function fetchedAt(now) {
  return new Date(now()).toISOString()
}

function unavailable(reason, now) {
  return { status: 'unavailable', reason, fetchedAt: fetchedAt(now), groups: [] }
}

function validString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 160) : null
}

function validRemainingFraction(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
}

function validResetTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null
}

/** Parse only the documented account-usage fields; never surface raw CLI output. */
export function parseAgyQuotaOutput(stdout, now = Date.now) {
  let payload
  try {
    payload = JSON.parse(stdout)
  } catch {
    return unavailable('invalid-json', now)
  }

  const groups = payload?.command?.name === 'usage' ? payload.command.data?.groups : undefined
  if (!Array.isArray(groups)) return unavailable('unstructured', now)

  const normalizedGroups = groups.slice(0, 32).flatMap((group) => {
    if (group === null || typeof group !== 'object') return []
    const buckets = Array.isArray(group.buckets) ? group.buckets.slice(0, 32).map(bucket => ({
      name: validString(bucket?.name),
      window: validString(bucket?.window),
      remainingFraction: validRemainingFraction(bucket?.remaining_fraction),
      resetTime: validResetTime(bucket?.reset_time),
    })) : []
    return [{ name: validString(group.name) ?? 'Agy', buckets }]
  })
  return {
    status: 'ready',
    groups: normalizedGroups,
    fetchedAt: fetchedAt(now),
  }
}

function abortReason(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error('Agy quota request aborted')
}

function awaitWithSignal(promise, signal) {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

function abortSignalError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error('Agy quota request cancelled')
}

async function runAgyQuotaQuery({ subprocess, command, env, cwd, signal, timeoutSignal, now }) {
  let child
  try {
    const executable = await subprocess.resolveExecutable(command, env, signal)
    signal.throwIfAborted()
    child = subprocess.spawn({
      argv: [executable, ...AGY_QUOTA_ARGUMENTS],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: STDOUT_LIMIT_BYTES },
        stderr: { maxBytes: STDERR_LIMIT_BYTES },
      },
      graceMs: PROCESS_GRACE_MS,
      env,
      signal,
    })
    const outcome = await child.done
    signal.throwIfAborted()
    if (outcome.exitCode !== 0) return unavailable('cli', now)
    const stdout = child.collected.stdout?.readFrom(0)
    if (stdout === undefined || stdout.lossy) return unavailable('output-limit', now)
    return parseAgyQuotaOutput(stdout.text, now)
  } catch {
    if (signal.aborted) {
      if (timeoutSignal.aborted) return unavailable('timeout', now)
      throw abortSignalError(signal)
    }
    if (child !== undefined) {
      child.terminate()
      await child.waitForExit().catch(() => false)
      await child.done.catch(() => {})
    }
    return unavailable('cli', now)
  }
}

/**
 * Create a cached, coalescing reader for Agy's native CLI usage command.
 * @param {object} options
 * @param {object} options.subprocess - DSH's managed subprocess service.
 * @param {string} options.command - configured Agy executable.
 * @param {Record<string, string>} options.env - explicit CLI environment overrides.
 * @param {string} options.cwd - valid Host working directory for the CLI.
 * @param {number} [options.refreshMs] - successful result cache lifetime.
 * @param {number} [options.failureRefreshMs] - unavailable result cache lifetime.
 * @param {number} [options.timeoutMs] - hard process query bound.
 * @param {() => number} [options.now] - clock seam for tests.
 */
export function createAgyQuotaReader({
  subprocess,
  command = 'agy',
  env = {},
  cwd = process.cwd(),
  refreshMs = DEFAULT_REFRESH_MS,
  failureRefreshMs = FAILURE_REFRESH_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
}) {
  if (subprocess === null || typeof subprocess?.resolveExecutable !== 'function' || typeof subprocess?.spawn !== 'function') {
    throw new TypeError('subagent-antigravity: Agy quota requires the DSH subprocess service')
  }
  if (typeof command !== 'string' || command.length === 0) throw new TypeError('subagent-antigravity: Agy quota command is empty')
  if (typeof cwd !== 'string' || cwd.length === 0) throw new TypeError('subagent-antigravity: Agy quota working directory is empty')

  const lifetime = new AbortController()
  let cached
  let cacheUntil = 0
  let lastGood
  let inFlight
  let disposed = false

  function beginQuery() {
    const controller = new AbortController()
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = AbortSignal.any([lifetime.signal, controller.signal, timeoutSignal])
    const flight = { controller, timeoutSignal, readers: 0, settled: false, promise: undefined }
    flight.promise = runAgyQuotaQuery({ subprocess, command, env, cwd, signal, timeoutSignal, now })
      .then((snapshot) => {
        if (signal.aborted) return snapshot
        if (snapshot.status === 'ready') {
          lastGood = snapshot
          cached = snapshot
          cacheUntil = now() + refreshMs
          return snapshot
        }
        cached = lastGood === undefined
          ? snapshot
          : { ...lastGood, status: 'stale', reason: snapshot.reason }
        cacheUntil = now() + failureRefreshMs
        return cached
      })
      .finally(() => {
        flight.settled = true
        if (inFlight === flight) inFlight = undefined
      })
    // The request waiter observes this promise; this handler also covers a route
    // that disconnects after its final waiter has already released the flight.
    flight.promise.catch(() => {})
    inFlight = flight
    return flight
  }

  async function read(signal) {
    if (disposed) return unavailable('unavailable', now)
    signal?.throwIfAborted()
    if (cached !== undefined && cacheUntil > now()) return cached
    const flight = inFlight ?? beginQuery()
    flight.readers += 1
    try {
      return await awaitWithSignal(flight.promise, signal)
    } finally {
      flight.readers -= 1
      if (!flight.settled && flight.readers === 0) flight.controller.abort(new Error('No Agy quota readers remain'))
    }
  }

  async function dispose() {
    if (disposed) return
    disposed = true
    lifetime.abort(new Error('Agy quota reader disposed'))
    if (inFlight !== undefined) {
      inFlight.controller.abort(new Error('Agy quota reader disposed'))
      await inFlight.promise.catch(() => {})
    }
    cached = undefined
    lastGood = undefined
  }

  return { read, dispose }
}
