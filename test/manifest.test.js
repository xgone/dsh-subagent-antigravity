import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const bundlePatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

test('manifest declares runtime peers used by the provider and patch', () => {
  const peers = packageJson.peerDependencies
  for (const name of [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-subprocess',
    '@deepseek-ai/dsh-timeout',
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-storage-domain',
    '@deepseek-ai/schemastery',
  ]) {
    assert.equal(typeof peers?.[name], 'string', `missing peer dependency ${name}`)
    assert.ok(peers[name].length > 0, `empty peer range for ${name}`)
  }
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.deepEqual(packageJson.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
  ])
  assert.ok(packageJson.files.includes('src'))
  assert.ok(packageJson.files.includes('locale/*.json'))
  assert.ok(packageJson.files.includes('icon.svg'))
})

test('Agy quota status registers as an additive composer dock entry', () => {
  assert.match(clientSource, /name: 'conversation\.composer\.dock'/u)
  assert.match(clientSource, /id: 'xgone-antigravity-quota'/u)
  assert.match(clientSource, /api\/xgone\/agy-quota/u)
  // Mobile-friendly click trigger and the host dock's transparent resting pill.
  assert.match(clientSource, /'aria-haspopup': 'dialog'/u)
  assert.match(clientSource, /background: open \? 'var\(--dsw-alias-interactive-bg-hover\)' : 'transparent'/u)
  assert.match(clientSource, /role: 'dialog'/u)
  // Narrow panel, localized window names, next reset, and host-matched secondary font scale.
  assert.match(clientSource, /Math\.min\(240, Math\.max\(200, window\.innerWidth - 24\)\)/u)
  assert.match(clientSource, /quotaWindowLabel\(bucket, t\)/u)
  assert.match(clientSource, /quotaNextReset/u)
  assert.match(clientSource, /--dsh-content-font-size-secondary/u)
  assert.match(clientSource, /order: 999/u)
  assert.match(clientSource, /translateY\(-100%\)/u)
  // The child-session progress row is a keyed client tool view, because the web
  // client only classifies its own built-in tool names.
  assert.match(clientSource, /name: 'tool\.call\.toolview'/u)
  assert.match(clientSource, /key: 'agy_progress'/u)
  assert.match(clientSource, /quotaSignIn/u)
  // Narrow viewports collapse the quota reading to one tight percentage.
  assert.match(clientSource, /quotaMobile: 'Agy·\{percent\}%'/u)
  assert.match(clientSource, /NARROW_QUERY = '\(max-width: 480px\)'/u)
  assert.match(clientSource, /window\.matchMedia\(NARROW_QUERY\)/u)
})

test('bundle patch pins the child Agent route to the CLI adapter', () => {
  assert.match(bundlePatch, /provider: antigravity/u)
  assert.match(bundlePatch, /toolName: subagent_antigravity/u)
  assert.match(bundlePatch, /agentOptions:\n\s+provider: agy-stream\n\s+model: native/u)
})

test('bundle and client package identities match the public npm scope', () => {
  assert.equal(packageJson.name, '@xgone/dsh-subagent-antigravity')
  assert.equal(packageJson.publishConfig?.access, 'public')
  assert.equal(packageJson.private, undefined)
  assert.ok(bundlePatch.includes(`name: '${packageJson.name}'`))
  assert.ok(clientSource.includes(`id: '${packageJson.name}'`))
  assert.ok(clientSource.includes(`const PACKAGE = '${packageJson.name}'`))
  assert.ok(clientSource.includes("const LEGACY_PACKAGE = 'dsh-subagent-antigravity'"))
})
