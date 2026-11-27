import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgyQuotaReader, parseAgyQuotaOutput } from '../src/agy-quota.js'

const usageOutput = JSON.stringify({
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            { name: 'Five Hour Limit', window: '5h', remaining_fraction: 0.875, reset_time: '2026-11-26T14:00:00Z' },
            { name: 'Weekly Limit', window: 'week', remaining_fraction: 0.72, reset_time: '2026-12-01T00:00:00Z' },
          ],
        },
      ],
    },
  },
})

function fakeSubprocess({ outputs, exitCodes, stderrs, onSpawn } = {}) {
  let calls = 0
  const specs = []
  return {
    specs,
    async resolveExecutable(command, env, signal) {
      assert.equal(command, 'agy')
      assert.deepEqual(env, {})
      assert.equal(signal.aborted, false)
      return '/resolved/agy'
    },
    spawn(spec) {
      const index = calls++
      specs.push(spec)
      onSpawn?.(spec, index)
      return {
        done: Promise.resolve({ exitCode: exitCodes?.[index] ?? 0, signal: null }),
        collected: {
          stdout: { readFrom: offset => ({ text: outputs?.[index] ?? usageOutput, nextOffset: offset, lossy: false }) },
          stderr: { readFrom: offset => ({ text: stderrs?.[index] ?? '', nextOffset: offset, lossy: false }) },
        },
        terminate() {},
        async waitForExit() { return true },
      }
    },
  }
}

test('a signed-out CLI is reported as an auth failure, not a generic CLI error', async () => {
  const byStderr = createAgyQuotaReader({
    subprocess: fakeSubprocess({
      outputs: ['{"status":"ERROR","error":"authentication failed or timed out"}'],
      exitCodes: [1],
      stderrs: ['Authentication required. Please visit the URL to log in:'],
    }),
    command: 'agy', env: {}, cwd: '/workspace',
  })
  assert.equal((await byStderr.read()).reason, 'auth')

  const byStdout = createAgyQuotaReader({
    subprocess: fakeSubprocess({
      outputs: ['{"status":"ERROR","error":"authentication failed or timed out"}'],
      exitCodes: [0],
    }),
    command: 'agy', env: {}, cwd: '/workspace',
  })
  assert.equal((await byStdout.read()).reason, 'auth')
  await byStderr.dispose()
  await byStdout.dispose()
})

test('a persisted snapshot answers immediately and revalidates in the background', async () => {
  const seed = {
    status: 'ready',
    fetchedAt: '2026-11-27T00:00:00.000Z',
    groups: [{ name: 'Gemini Models', buckets: [{ name: 'Weekly', window: 'week', remainingFraction: 0.9, resetTime: '2026-12-01T00:00:00.000Z' }] }],
  }
  let persistCount = 0
  let release
  const subprocess = fakeSubprocess({
    onSpawn(_spec, index) {
      if (index === 0) release = undefined
    },
  })
  const spawns = []
  const slow = {
    async resolveExecutable() { return '/resolved/agy' },
    spawn(spec) {
      spawns.push(spec)
      return {
        done: new Promise((resolve) => { release = () => resolve({ exitCode: 0, signal: null }) }),
        collected: {
          stdout: { readFrom: () => ({ text: usageOutput, nextOffset: 0, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        },
        terminate() {},
        async waitForExit() { return true },
      }
    },
  }
  const reader = createAgyQuotaReader({
    subprocess: slow,
    command: 'agy',
    env: {},
    cwd: '/workspace',
    seed,
    persist: () => { persistCount += 1 },
  })
  const restored = await reader.read()
  assert.equal(restored.status, 'stale')
  assert.equal(restored.groups[0].buckets[0].remainingFraction, 0.9)
  assert.equal(spawns.length, 1)
  assert.equal(persistCount, 0)
  release()
  await new Promise(resolve => setImmediate(resolve))
  const fresh = await reader.read()
  assert.equal(fresh.status, 'ready')
  assert.equal(persistCount, 1)
  assert.equal(subprocess.specs.length, 0)
  await reader.dispose()
})

test('the probe process cannot launch a desktop browser opener', async () => {
  if (process.platform === 'win32') return
  let probePath
  const subprocess = fakeSubprocess({
    outputs: [usageOutput],
    onSpawn(spec) { probePath = spec.env.PATH },
  })
  const reader = createAgyQuotaReader({ subprocess, command: 'agy', env: {}, cwd: '/workspace' })
  await reader.read()
  assert.equal(typeof probePath, 'string')
  assert.match(probePath, /agy-quota-shim-/u)
  assert.ok(probePath.split(':')[0].includes('agy-quota-shim-'))
  await reader.dispose()
})

test('quota parser keeps the CLI remaining fraction and reset timestamps', () => {
  const snapshot = parseAgyQuotaOutput(usageOutput, () => Date.parse('2026-11-26T12:00:00Z'))
  assert.deepEqual(snapshot, {
    status: 'ready',
    fetchedAt: '2026-11-26T12:00:00.000Z',
    groups: [{
      name: 'Gemini Models',
      buckets: [
        { name: 'Five Hour Limit', window: '5h', remainingFraction: 0.875, resetTime: '2026-11-26T14:00:00.000Z' },
        { name: 'Weekly Limit', window: 'week', remainingFraction: 0.72, resetTime: '2026-12-01T00:00:00.000Z' },
      ],
    }],
  })
})

test('quota parser rejects malformed or unstructured output without reflecting it', () => {
  assert.deepEqual(parseAgyQuotaOutput('not-json', () => 0), {
    status: 'unavailable', reason: 'invalid-json', fetchedAt: '1970-01-01T00:00:00.000Z', groups: [],
  })
  assert.deepEqual(parseAgyQuotaOutput(JSON.stringify({ command: { name: 'usage', data: {} } }), () => 0), {
    status: 'unavailable', reason: 'unstructured', fetchedAt: '1970-01-01T00:00:00.000Z', groups: [],
  })
})

test('reader uses Agy print mode and caches concurrent/successful quota reads', async () => {
  let releaseDone
  let spawnCount = 0
  const spawned = new Promise(resolve => { releaseDone = resolve })
  const subprocess = {
    async resolveExecutable(command) { assert.equal(command, 'agy'); return '/resolved/agy' },
    spawn(spec) {
      spawnCount += 1
      assert.deepEqual(spec.argv, [
        '/resolved/agy', '--print', '/usage', '--output-format', 'json', '--print-timeout', '30s',
      ])
      assert.equal(spec.stdio.stdin, 'ignore')
      releaseDone()
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: { readFrom: () => ({ text: usageOutput, nextOffset: usageOutput.length, lossy: false }) } },
      }
    },
  }
  const reader = createAgyQuotaReader({ subprocess, command: 'agy', env: {}, cwd: '/workspace', now: () => 1000 })
  const first = reader.read()
  const second = reader.read()
  await spawned
  const [one, two] = await Promise.all([first, second])
  assert.deepEqual(one, two)
  assert.equal(one.status, 'ready')
  assert.equal(spawnCount, 1)
  assert.equal((await reader.read()).status, 'ready')
  assert.equal(spawnCount, 1)
  await reader.dispose()
})

test('reader serves the last successful quota as stale when a refresh fails', async () => {
  let time = 0
  const subprocess = fakeSubprocess({ outputs: [usageOutput, 'invalid'] })
  const reader = createAgyQuotaReader({
    subprocess,
    command: 'agy',
    env: {},
    cwd: '/workspace',
    refreshMs: 10,
    failureRefreshMs: 5,
    now: () => time,
  })
  const first = await reader.read()
  assert.equal(first.status, 'ready')
  time = 11
  const stale = await reader.read()
  assert.equal(stale.status, 'stale')
  assert.deepEqual(stale.groups, first.groups)
  assert.equal(stale.reason, 'invalid-json')
  assert.equal(subprocess.specs.length, 2)
  await reader.dispose()
})

test('aborting the final quota reader aborts the managed Agy process', async () => {
  let specSeen
  const subprocess = {
    async resolveExecutable() { return '/resolved/agy' },
    spawn(spec) {
      specSeen = spec
      return {
        done: new Promise((_resolve, reject) => {
          spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true })
        }),
        collected: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
        terminate() {},
        async waitForExit() { return true },
      }
    },
  }
  const reader = createAgyQuotaReader({ subprocess, command: 'agy', env: {}, cwd: '/workspace' })
  const controller = new AbortController()
  const request = reader.read(controller.signal)
  await new Promise(resolve => setImmediate(resolve))
  controller.abort(new Error('client disconnected'))
  await assert.rejects(request, /client disconnected/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(specSeen.signal.aborted, true)
  await reader.dispose()
})

test('probe timeout serves lastGood as stale and caches failure backoff', async () => {
  let time = 100
  let spawnCount = 0
  const subprocess = {
    async resolveExecutable() { return '/resolved/agy' },
    spawn(spec) {
      spawnCount += 1
      if (spawnCount === 1) {
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: usageOutput, nextOffset: usageOutput.length, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
          terminate() {},
          async waitForExit() { return true },
        }
      }
      return {
        done: new Promise((_resolve, reject) => {
          spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true })
        }),
        collected: {
          stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        },
        terminate() {},
        async waitForExit() { return true },
      }
    },
  }
  const reader = createAgyQuotaReader({
    subprocess,
    command: 'agy',
    env: {},
    cwd: '/workspace',
    refreshMs: 50,
    failureRefreshMs: 200,
    timeoutMs: 25,
    now: () => time,
  })

  const first = await reader.read()
  assert.equal(first.status, 'ready')
  assert.equal(spawnCount, 1)

  time = 200
  const timedOut = await reader.read()
  assert.equal(timedOut.status, 'stale')
  assert.equal(timedOut.reason, 'timeout')
  assert.deepEqual(timedOut.groups, first.groups)
  assert.equal(spawnCount, 2)

  // Within failureRefreshMs backoff window, cached stale result is served without re-spawning.
  time = 300
  const cached = await reader.read()
  assert.deepEqual(cached, timedOut)
  assert.equal(spawnCount, 2)

  // After backoff expires, a new probe runs.
  time = 450
  const afterBackoff = await reader.read()
  assert.equal(afterBackoff.status, 'stale')
  assert.equal(afterBackoff.reason, 'timeout')
  assert.equal(spawnCount, 3)

  await reader.dispose()
})
