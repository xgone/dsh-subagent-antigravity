import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('manifest declares runtime peers used by the provider and patch', () => {
  const peers = packageJson.peerDependencies
  for (const name of [
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-subprocess',
    '@deepseek-ai/dsh-timeout',
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/schemastery',
  ]) {
    assert.equal(typeof peers?.[name], 'string', `missing peer dependency ${name}`)
    assert.ok(peers[name].length > 0, `empty peer range for ${name}`)
  }
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(packageJson.files.includes('src'))
  assert.ok(packageJson.files.includes('locale/*.json'))
  assert.ok(packageJson.files.includes('icon.svg'))
})
