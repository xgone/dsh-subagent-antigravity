#!/usr/bin/env node
/**
 * Developer probe: drive one real Antigravity CLI turn through the same bridge
 * the DSH child Session uses (session → LLM adapter → progress proxy tool)
 * without booting a Host or a browser.
 *
 *   node scripts/probe-stream-session.mjs "run printf stream-ok and report it"
 *
 * It prints every DSH stream chunk, every progress-tool result and the final
 * finish reason, so a CLI upgrade can be diffed against the pinned contract.
 * The CLI must already be authenticated; `--workspace <dir>` selects the cwd.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { AntigravityStreamLlmAdapter } from '../src/adapter.js'
import { createAgyProgressTool } from '../src/progress-tool.js'
import { STREAM_MODEL, STREAM_PROVIDER } from '../src/stream-json.js'

const args = process.argv.slice(2)
const workspaceIndex = args.indexOf('--workspace')
const workspace = workspaceIndex === -1
  ? mkdtempSync(join(tmpdir(), 'agy-stream-probe-'))
  : args[workspaceIndex + 1]
if (workspaceIndex !== -1) args.splice(workspaceIndex, 2)
const prompt = args.join(' ').trim()
if (prompt === '') {
  console.error('usage: node scripts/probe-stream-session.mjs [--workspace <dir>] "<task>"')
  process.exit(2)
}

/** Prefer an explicit CLI path; fall back to the documented installer location. */
function defaultCommand() {
  const installed = join(homedir(), '.local', 'bin', 'agy')
  return existsSync(installed) ? installed : 'agy'
}
const command = process.env.AGY_CLI ?? defaultCommand()

function spawnHandle(argv, cwd, env) {
  const child = nodeSpawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'inherit'] })
  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })
  child.on('exit', (code, signal) => resolveDone({ exitCode: code, signal }))
  child.on('error', (error) => resolveDone({ exitCode: null, signal: null, error }))
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    done,
    terminate() { child.kill('SIGTERM') },
    async waitForExit() { await done; return true },
  }
}

const table = new Map()
const sessionDomain = {
  table: () => ({
    get: (key) => table.get(key),
    async put(key, value) { table.set(key, value) },
    async update(key, transform) { const next = transform(table.get(key)); table.set(key, next); return next },
  }),
}
const agent = {
  session: { id: 'probe-child', header: { cwd: workspace } },
  ctx: { effect: () => () => {} },
}
const ctx = {
  agents: { get: (id) => (id === agent.session.id ? agent : undefined) },
  subprocess: {
    async resolveExecutable(name) { return name },
    spawn(spec) {
      // The harness layers an explicit overlay over a scrubbed parent env; the
      // probe only needs PATH/HOME so the CLI can find its cached credentials.
      return spawnHandle(spec.argv, spec.cwd, { ...process.env, ...spec.env })
    },
  },
}
const config = {
  command,
  permissionMode: 'dangerously-skip-permissions',
  env: {},
  disposeEofGraceMs: 6000,
  disposeGraceMs: 3000,
}
const adapter = new AntigravityStreamLlmAdapter(ctx, config, sessionDomain)
const tool = createAgyProgressTool(adapter)
const controller = new AbortController()

function show(chunk) {
  if (chunk.type === 'text-delta') return process.stdout.write(chunk.text)
  if (chunk.type === 'usage') return console.log(`\n[usage] ${JSON.stringify(chunk.usage)}`)
  if (chunk.type === 'finish') return console.log(`\n[finish] ${JSON.stringify(chunk.reason)}`)
  if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') return
  return undefined
}

const options = {
  provider: STREAM_PROVIDER,
  model: STREAM_MODEL,
  sessionId: agent.session.id,
  signal: controller.signal,
  messages: [{ id: 'probe-user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }],
}

let exited = false
try {
  for (;;) {
    let toolCall
    for await (const chunk of adapter.stream(options)) {
      if (chunk.type === 'block-end' && chunk.block?.type === 'tool-call') toolCall = chunk.block
      show(chunk)
    }
    if (toolCall === undefined) break
    const toolArgs = JSON.parse(toolCall.arguments)
    const value = await tool.execute(toolArgs, { agent, signal: controller.signal })
    console.log(`[progress] ${value.title} → ${value.status}: ${value.outputText.split('\n').slice(-2).join(' / ')}`)
  }
} catch (error) {
  exited = true
  console.error(`\nprobe failed: ${error.message}`)
  if (error.cause !== undefined) console.error(error.cause)
} finally {
  await adapter.disposeAll()
}
process.exit(exited ? 1 : 0)