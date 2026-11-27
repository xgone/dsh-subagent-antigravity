import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { Config, apply, name, inject } from '../src/index.js'

function hostContext() {
  const registrations = []
  const projections = []
  const sections = []
  const listeners = new Map()
  const disposers = new Map()
  const guards = []
  const adapterRegistrations = []
  const domainSpecs = []
  const toolRegistrations = []
  const optionalInjections = []
  const agents = []
  const availableTools = new Set(['subagent', 'subagent_fork', 'subagent_antigravity'])

  const makeAgent = (id, localTools = []) => {
    const hiddenTools = new Set()
    const scopedTools = new Set(localTools)
    return {
      id,
      hiddenTools,
      scopedTools,
      disposeScope() { hiddenTools.clear() },
      ctx: {
        tools: {
          restrict({ deny }) {
            if (deny.some(name => scopedTools.has(name))) throw new Error('scope-local tool cannot be restricted')
            const added = deny.filter(name => !hiddenTools.has(name))
            for (const name of deny) hiddenTools.add(name)
            listeners.get('tools/change')?.()
            return () => {
              for (const name of added) hiddenTools.delete(name)
              listeners.get('tools/change')?.()
            }
          },
        },
      },
    }
  }

  const ctx = {
    subagents: { registerProvider(provider) { registrations.push(provider) } },
    subprocess: {
      async resolveExecutable(command) { return command },
      spawn() { throw new Error('unexpected quota subprocess in a headless test context') },
    },
    inject(names, callback) {
      optionalInjections.push([...names])
      if (names.every(service => service in ctx)) callback(ctx)
      return () => {}
    },
    agents: { list() { return [...agents] } },
    tools: {
      register(tool, options) {
        toolRegistrations.push({ tool, options })
        return () => {}
      },
      get(name, agent) {
        if (agent?.scopedTools.has(name)) return { name, scope: 'local' }
        if (!availableTools.has(name) || agent?.hiddenTools.has(name)) return undefined
        return { name, scope: 'global' }
      },
      guard(guard) {
        guards.push(guard)
        return () => { guards.splice(guards.indexOf(guard), 1) }
      },
    },
    llm: {
      registerAdapter(providers, adapter) {
        adapterRegistrations.push({ providers: [...providers], adapter })
        return () => {}
      },
    },
    storageDomain: {
      async open(spec) {
        domainSpecs.push(spec)
        return {
          table() {
            return {
              get() { return undefined },
              async put() {},
              async update() {},
            }
          },
          close() {},
        }
      },
    },
    sessionProjections: {
      register(definition) {
        projections.push(definition)
        return Promise.resolve({ key: definition.key, async dispose() {} })
      },
    },
    logger: { warn() {} },
    systemPrompt: {
      getSectionOrder(name) {
        assert.equal(name, 'TOOL_SUBAGENT')
        return 2800
      },
      section(section) {
        sections.push(section)
        return () => { sections.splice(sections.indexOf(section), 1) }
      },
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => { listeners.delete(name) }
    },
    effect(effect, label) {
      const dispose = effect()
      disposers.set(label, dispose)
      return dispose
    },
  }
  const guardReason = (agent, name) => guards.map(guard => guard({ agent, name })).find(reason => reason !== undefined)
  return {
    ctx, registrations, projections, sections, listeners, disposers, guards, agents, optionalInjections,
    availableTools, adapterRegistrations, domainSpecs, toolRegistrations, makeAgent, guardReason,
  }
}

test('plugin advertises its identity and injected services', () => {
  assert.equal(name, 'subagent-antigravity')
  assert.deepEqual([...inject], [
    'subagents', 'subprocess', 'systemPrompt', 'agents', 'tools', 'llm', 'storageDomain',
  ])
})

test('Config fills documented defaults and omits the optional native overrides', () => {
  const resolved = new Config({})
  assert.equal(resolved.providerName, 'antigravity')
  assert.equal(resolved.command.get(), 'agy')
  for (const field of ['command', 'model', 'effort', 'agent', 'env', 'disposeEofGraceMs', 'disposeGraceMs']) {
    assert.equal(typeof resolved[field]?.get, 'function', `${field} must be a volatile accessor`)
  }
  assert.equal(resolved.permissionMode.get(), 'default')
  assert.deepEqual(resolved.env.get(), {})
  assert.equal(resolved.disposeGraceMs.get(), 3000)
  assert.equal(resolved.disposeEofGraceMs.get(), 6000)
  assert.equal(resolved.autoDelegate.get(), false)
  assert.equal(resolved.model.get(), undefined)
  assert.equal(resolved.effort.get(), undefined)
  assert.equal(resolved.agent.get(), undefined)
})

test('Config rejects an unknown permission mode', () => {
  assert.throws(() => new Config({ permissionMode: 'bogus' }), /permissionMode|union|expected/i)
})

test('apply registers a continuable provider, the CLI LLM route and the progress proxy', async () => {
  const { ctx, registrations, projections, disposers, optionalInjections, adapterRegistrations, domainSpecs, toolRegistrations } = hostContext()
  await apply(ctx, new Config({ providerName: 'agy-prod', model: 'gemini-4-neon-high' }))
  assert.equal(registrations.length, 1)
  assert.deepEqual(optionalInjections, [['connection']])
  assert.equal(disposers.has('subagent-antigravity.agy-quota-reader'), true)

  const provider = registrations[0]
  assert.equal(provider.name, 'agy-prod')
  assert.equal(provider.inheritsParentContext, false)
  assert.deepEqual(provider.capabilities, {
    agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true,
  })
  assert.equal(typeof provider.prepareContinuable, 'function')
  assert.equal('start' in provider, false)
  assert.deepEqual(provider.agentRouteDefaults, { provider: 'agy-stream', model: 'native' })
  assert.equal(provider.config.permissionMode.get(), 'default')

  assert.equal(adapterRegistrations.length, 1)
  assert.deepEqual(adapterRegistrations[0].providers, ['agy-stream'])
  assert.deepEqual(domainSpecs.map(spec => spec.name), ['xgone_antigravity_quota', 'xgone_antigravity_stream_sessions'])
  assert.equal(toolRegistrations.length, 1)
  assert.equal(toolRegistrations[0].tool.name, 'agy_progress')
  assert.equal(toolRegistrations[0].options.when({ modelSelection: { provider: 'agy-stream' } }), true)
  assert.equal(toolRegistrations[0].options.when({ modelSelection: { provider: 'deepseek' } }), false)
  assert.equal(disposers.has('subagent-antigravity.stream-session-domain'), true)
  assert.equal(disposers.has('subagent-antigravity.stream-sessions'), true)
})

test('quota fetch route is attached only when the optional Connection service is present', async () => {
  const { ctx, disposers } = hostContext()
  let route
  ctx.connection = {
    fetch: {
      register(value) {
        route = value
        return async () => {}
      },
    },
  }

  await apply(ctx, new Config({}))
  assert.equal(route.path, '/api/xgone/agy-quota')
  assert.deepEqual(route.methods, ['GET'])
  assert.equal(route.requestBody, 'buffered')
  const response = await route.fetch(new Request('http://localhost/api/xgone/agy-quota'))
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const snapshot = await response.json()
  assert.equal(snapshot.status, 'unavailable')
  assert.equal(snapshot.reason, 'cli')
  assert.deepEqual(snapshot.groups, [])
  assert.ok(Number.isFinite(Date.parse(snapshot.fetchedAt)))
  await disposers.get('subagent-antigravity.agy-quota-route')()
  await disposers.get('subagent-antigravity.agy-quota-reader')()
})

test('autoDelegate hides built-in subagents, preserves Agy, and follows live Config Form changes', async () => {
  const { ctx, registrations, sections, listeners, disposers, agents, makeAgent, guardReason } = hostContext()
  const rootAgent = makeAgent('root-agent')
  agents.push(rootAgent)
  let enabled = true
  const config = { ...new Config({ autoDelegate: true }), autoDelegate: { get: () => enabled } }

  await apply(ctx, config)
  assert.equal(registrations.length, 1)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'subagent-antigravity:auto-delegation')
  assert.equal(sections[0].order, 2810)
  assert.equal(sections[0].interpolate, false)
  assert.match(sections[0].text, /call `subagent_antigravity` exactly once/)
  assert.match(sections[0].text, /completion notice/)
  assert.match(sections[0].text, /do not delegate it again/)

  assert.equal(rootAgent.hiddenTools.has('subagent'), true)
  assert.equal(rootAgent.hiddenTools.has('subagent_fork'), true)
  assert.equal(ctx.tools.get('subagent_antigravity', rootAgent)?.name, 'subagent_antigravity')
  assert.match(guardReason(rootAgent, 'subagent'), /subagent_antigravity/)

  const lateAgent = makeAgent('late-agent')
  agents.push(lateAgent)
  listeners.get('agent/created')({ agent: lateAgent })
  assert.equal(lateAgent.hiddenTools.has('subagent'), true)
  assert.equal(lateAgent.hiddenTools.has('subagent_fork'), true)

  enabled = false
  listeners.get('settings/document-updated')('subagent-antigravity', 1)
  assert.equal(sections.length, 0)
  assert.equal(rootAgent.hiddenTools.size, 0)
  assert.equal(lateAgent.hiddenTools.size, 0)
  assert.equal(guardReason(rootAgent, 'subagent'), undefined)

  enabled = true
  listeners.get('settings/document-updated')('subagent-antigravity', 2)
  assert.equal(sections.length, 1)
  assert.equal(rootAgent.hiddenTools.has('subagent'), true)
  assert.equal(lateAgent.hiddenTools.has('subagent'), true)

  disposers.get('subagent-antigravity.auto-delegation')()
  assert.equal(sections.length, 0)
  assert.equal(rootAgent.hiddenTools.size, 0)
  assert.equal(lateAgent.hiddenTools.size, 0)
  assert.equal(guardReason(rootAgent, 'subagent'), undefined)
})

test('autoDelegate guard blocks a same-named scoped DSH tool when it cannot be hidden', async () => {
  const { ctx, agents, makeAgent, listeners, guardReason, disposers } = hostContext()
  const agent = makeAgent('scoped-agent', ['subagent'])
  agents.push(agent)
  await apply(ctx, new Config({ autoDelegate: true }))
  assert.equal(agent.hiddenTools.has('subagent'), false)
  listeners.get('agent/created')({ agent })
  assert.match(guardReason(agent, 'subagent'), /subagent_antigravity/)
  assert.match(guardReason(agent, 'subagent_fork'), /subagent_antigravity/)
  disposers.get('subagent-antigravity.auto-delegation')()
  assert.equal(guardReason(agent, 'subagent'), undefined)
})

test('autoDelegate false leaves local subagent tools visible', async () => {
  const { ctx, sections, listeners, disposers, agents, makeAgent, guardReason } = hostContext()
  const agent = makeAgent('default-agent')
  agents.push(agent)
  await apply(ctx, new Config({ autoDelegate: false }))
  assert.equal(sections.length, 0)
  assert.equal(ctx.tools.get('subagent', agent)?.name, 'subagent')
  assert.equal(ctx.tools.get('subagent_fork', agent)?.name, 'subagent_fork')
  assert.equal(guardReason(agent, 'subagent'), undefined)
  assert.equal(typeof listeners.get('settings/document-updated'), 'function')
  disposers.get('subagent-antigravity.auto-delegation')()
  assert.equal(listeners.size, 0)
})

test('autoDelegate hides built-in subagents registered after an Agent exists', async () => {
  const { ctx, agents, availableTools, makeAgent, listeners, disposers } = hostContext()
  availableTools.delete('subagent_fork')
  const agent = makeAgent('late-tool-agent')
  agents.push(agent)
  await apply(ctx, new Config({ autoDelegate: true }))
  assert.equal(agent.hiddenTools.has('subagent'), true)
  assert.equal(agent.hiddenTools.has('subagent_fork'), false)

  availableTools.add('subagent_fork')
  listeners.get('tools/change')()
  assert.equal(agent.hiddenTools.has('subagent_fork'), true)
  disposers.get('subagent-antigravity.auto-delegation')()
  assert.equal(agent.hiddenTools.size, 0)
})

test('Config enforces positive and MAX_TIMER_DELAY_MS bounds on grace values', () => {
  for (const field of ['disposeGraceMs', 'disposeEofGraceMs']) {
    assert.throws(() => new Config({ [field]: 0 }))
    assert.throws(() => new Config({ [field]: -1 }))
    assert.throws(() => new Config({ [field]: MAX_TIMER_DELAY_MS + 1 }))
    const valid = new Config({ [field]: MAX_TIMER_DELAY_MS })
    assert.equal(valid[field].get(), MAX_TIMER_DELAY_MS)
  }
})

test('apply rejects a non-positive or excessive disposeGraceMs', async () => {
  const ctx = { subagents: { registerProvider() {} }, subprocess: {}, logger: { warn() {} } }
  const base = new Config({})
  await assert.rejects(() => apply(ctx, { ...base, disposeGraceMs: { get: () => 0 } }), /positive finite/)
  await assert.rejects(
    () => apply(ctx, { ...base, disposeEofGraceMs: { get: () => MAX_TIMER_DELAY_MS + 1 } }),
    /no greater than/,
  )
})
