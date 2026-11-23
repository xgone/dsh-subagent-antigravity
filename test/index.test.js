import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, apply, name, inject } from '../src/index.js'

function hostContext() {
  const registrations = []
  const projections = []
  const sections = []
  const listeners = new Map()
  const disposers = new Map()
  const ctx = {
    subagents: { registerProvider(provider) { registrations.push(provider) } },
    subprocess: {},
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
  return { ctx, registrations, projections, sections, listeners, disposers }
}

test('plugin advertises its identity and injected services', () => {
  assert.equal(name, 'subagent-antigravity')
  assert.deepEqual([...inject], ['subagents', 'subprocess', 'systemPrompt', 'sessionProjections'])
})

test('Config fills documented defaults and omits the optional native overrides', () => {
  const resolved = new Config({})
  assert.equal(resolved.providerName, 'antigravity')
  assert.equal(resolved.command, 'agy')
  assert.equal(resolved.permissionMode.get(), 'accept-edits')
  assert.deepEqual(resolved.env, {})
  assert.equal(resolved.disposeGraceMs, 3000)
  assert.equal(resolved.autoDelegate.get(), false)
  assert.equal('model' in resolved, false)
  assert.equal('effort' in resolved, false)
  assert.equal('agent' in resolved, false)
})

test('Config rejects an unknown permission mode', () => {
  assert.throws(() => new Config({ permissionMode: 'bogus' }), /permissionMode|union|expected/i)
})

test('apply registers one provider with the out-of-process capability set', async () => {
  const { ctx, registrations, projections, disposers } = hostContext()
  await apply(ctx, new Config({ providerName: 'agy-prod', model: 'gemini-4-neon-high' }))
  assert.equal(registrations.length, 1)
  assert.equal(projections[0].key, 'antigravityStatus')
  assert.equal(disposers.has('subagent-antigravity.status-projection'), true)
  const provider = registrations[0]
  assert.equal(provider.name, 'agy-prod')
  assert.equal(provider.inheritsParentContext, false)
  assert.deepEqual(provider.capabilities, {
    agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false,
  })
  assert.equal(typeof provider.start, 'function')
  assert.equal(provider.config.permissionMode.get(), 'accept-edits')
})

test('autoDelegate follows live Config Form changes and registers an ordered delegation instruction', async () => {
  const { ctx, registrations, sections, listeners, disposers } = hostContext()
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

  enabled = false
  listeners.get('settings/document-updated')('subagent-antigravity', 1)
  assert.equal(sections.length, 0)
  enabled = true
  listeners.get('settings/document-updated')('subagent-antigravity', 2)
  assert.equal(sections.length, 1)

  disposers.get('subagent-antigravity.auto-delegation')()
  assert.equal(sections.length, 0)
})

test('autoDelegate false leaves the instruction absent but watches its volatile setting', async () => {
  const { ctx, sections, listeners, disposers } = hostContext()
  await apply(ctx, new Config({ autoDelegate: false }))
  assert.equal(sections.length, 0)
  assert.equal(typeof listeners.get('settings/document-updated'), 'function')
  disposers.get('subagent-antigravity.auto-delegation')()
  assert.equal(listeners.size, 0)
})

test('apply rejects a non-positive disposeGraceMs', async () => {
  const ctx = { subagents: { registerProvider() {} }, subprocess: {}, logger: { warn() {} } }
  await assert.rejects(() => apply(ctx, new Config({ disposeGraceMs: 0 })), /positive finite/)
})
