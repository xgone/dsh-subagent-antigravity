import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const bundlePatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
const quotaDomainSource = readFileSync(new URL('../src/quota-domain.js', import.meta.url), 'utf8')
const readmeEn = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const readmeZh = readFileSync(new URL('../README.zh.md', import.meta.url), 'utf8')
const linkDevDepsSource = readFileSync(new URL('../scripts/link-dev-deps.mjs', import.meta.url), 'utf8')

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
  assert.ok(packageJson.files.includes('CHANGELOG.md'))
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
  // The Plugins form must cover every deployment setting, not just two.
  assert.match(clientSource, /advancedTitle/u)
  assert.match(clientSource, /commandLabel|agy 可执行文件/u)
  assert.match(clientSource, /envAdd/u)
  assert.match(clientSource, /graceEof/u)
  assert.match(clientSource, /'disposeEofGraceMs'|'disposeGraceMs'/u)
  // Narrow viewports collapse the quota reading to one tight percentage.
  assert.match(clientSource, /quotaMobile: 'Agy·\{percent\}%'/u)
  // Slow remote fact: poll rarely, only while visible, and revalidate a restored snapshot once.
  assert.match(clientSource, /AGY_QUOTA_REFRESH_MS = 5 \* 60_000/u)
  assert.match(clientSource, /visibilitychange/u)
  assert.match(clientSource, /AGY_QUOTA_REVALIDATE_MS/u)
  assert.match(clientSource, /NARROW_QUERY = '\(max-width: 480px\)'/u)
  assert.match(clientSource, /window\.matchMedia\(NARROW_QUERY\)/u)
})

test('every form-editable Config field is volatile', () => {
  for (const field of [
    'command: z.string().min(1).default(DEFAULT_COMMAND).volatile()',
    'model: z.string().min(1).volatile()',
    'effort: z.string().min(1).volatile()',
    'agent: z.string().min(1).volatile()',
    'env: z.dict(z.string()).default({}).volatile()',
    'disposeEofGraceMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISPOSE_EOF_GRACE_MS).volatile()',
    'disposeGraceMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_DISPOSE_GRACE_MS).volatile()',
    'permissionMode: z.union([...ANTIGRAVITY_PERMISSION_MODES])',
    'autoDelegate: z.boolean().default(false).volatile()',
  ]) {
    assert.ok(indexSource.includes(field), `missing volatile declaration: ${field}`)
  }
})

test('quota snapshots persist and restore through the durable domain', () => {
  assert.match(quotaDomainSource, /name: 'xgone_antigravity_quota'/u)
  assert.match(indexSource, /QUOTA_DOMAIN_SPEC/u)
  assert.match(indexSource, /seed: quotaSeed/u)
  assert.match(indexSource, /quotaTable\.put\('last'/u)
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

function loadClientPlugin() {
  let loaded
  const stateValues = []
  let stateCursor = 0
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const idx = stateCursor++
      if (!(idx in stateValues)) stateValues[idx] = typeof initial === 'function' ? initial() : initial
      const setState = (next) => {
        stateValues[idx] = typeof next === 'function' ? next(stateValues[idx]) : next
      }
      return [stateValues[idx], setState]
    },
    useEffect() {},
    useRef(current) { return { current } },
  }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(mod) { loaded = mod },
      },
    },
  }
  vm.runInNewContext(clientSource, sandbox)
  const plugin = loaded.factory((id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected require: ${id}`)
  })
  const locales = {}
  const slots = new Map()
  plugin.apply({
    effect(fn) { fn() },
    locale: {
      register(_ns, lang, dict) { locales[lang] = dict },
    },
    slots: {
      inject(_name, fn) { fn() },
      register(meta, component) { slots.set(meta.key ?? meta.id ?? meta.name, component) },
    },
  })
  return {
    locales,
    slots,
    resetHooks() { stateCursor = 0 },
    clearState() { stateValues.length = 0; stateCursor = 0 },
  }
}

test('client en and zh dictionaries have identical keys and every t()/setFeedback() key exists', () => {
  const { locales } = loadClientPlugin()
  const enKeys = Object.keys(locales.en).sort()
  const zhKeys = Object.keys(locales.zh).sort()
  assert.deepEqual(zhKeys, enKeys)
  for (const key of enKeys) {
    assert.equal(typeof locales.en[key], 'string')
    assert.ok(locales.en[key].length > 0, `empty en translation for ${key}`)
    assert.equal(typeof locales.zh[key], 'string')
    assert.ok(locales.zh[key].length > 0, `empty zh translation for ${key}`)
    const enVars = [...locales.en[key].matchAll(/\{(\w+)\}/gu)].map(m => m[1]).sort()
    const zhVars = [...locales.zh[key].matchAll(/\{(\w+)\}/gu)].map(m => m[1]).sort()
    assert.deepEqual(zhVars, enVars, `placeholder mismatch for ${key}`)
  }

  const referenced = new Set()
  for (const match of clientSource.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/gu)) {
    referenced.add(match[1])
  }
  for (const match of clientSource.matchAll(/\bsetFeedback\(\s*'([A-Za-z0-9_]+)'/gu)) {
    referenced.add(match[1])
  }
  for (const match of clientSource.matchAll(/\btextField\(\s*'[^']+'\s*,\s*'([A-Za-z0-9_]+)'\s*,\s*'([A-Za-z0-9_]+)'/gu)) {
    referenced.add(match[1])
    referenced.add(match[2])
  }
  for (const key of ['summaryOn', 'summaryOff', 'toolStatePreparing', 'toolStateRunning', 'toolStateDone', 'toolStateFailed']) {
    referenced.add(key)
  }
  assert.ok(referenced.size > 20)
  for (const key of referenced) {
    assert.ok(Object.hasOwn(locales.en, key), `missing en dictionary key: ${key}`)
    assert.ok(Object.hasOwn(locales.zh, key), `missing zh dictionary key: ${key}`)
  }
  assert.doesNotMatch(clientSource, /setFeedback\(\s*'failed'\s*\)/u)
})

test('AgyProgressRow renders failed state with auto-expansion from meta.status and prefers meta.path', () => {
  const { locales, slots, clearState } = loadClientPlugin()
  const AgyProgressRow = slots.get('agy_progress')
  const t = (key, vars = {}) => locales.en[key].replace(/\{(\w+)\}/gu, (_, name) => String(vars[name] ?? ''))

  clearState()
  const failedRow = AgyProgressRow({
    phase: 'result',
    cwd: '/workspace',
    openFile() {},
    t,
    block: {
      isError: false,
      meta: { kind: 'edit', status: 'failed', path: '/workspace/src/app.js' },
      args: { text: name => name === 'rawInputText' ? '{"Path":"/truncated' : name === 'title' ? 'write_to_file' : '' },
      content: [{ type: 'text', text: 'permission denied' }],
    },
  })
  assert.equal(failedRow.props['data-state'], 'failed')
  assert.equal(failedRow.children[0].props['aria-expanded'], true)
  // File open button uses meta.path even when rawInputText was truncated invalid JSON.
  const openBtn = failedRow.children[1]
  assert.equal(openBtn.type, 'button')
  assert.deepEqual(openBtn.children, ['./src/app.js'])

  clearState()
  const okRow = AgyProgressRow({
    phase: 'result',
    cwd: '/workspace',
    t,
    block: {
      isError: false,
      meta: { kind: 'execute', status: 'completed' },
      args: { text: name => name === 'title' ? 'ls' : '' },
      content: [{ type: 'text', text: 'file.txt' }],
    },
  })
  assert.equal(okRow.props['data-state'], 'done')
  assert.equal(okRow.children[0].props['aria-expanded'], false)
})

test('client form enforces MAX_TIMER_DELAY_MS upper bound on grace fields', () => {
  assert.match(clientSource, /MAX_TIMER_DELAY_MS\s*=\s*2_147_483_647/u)
  assert.match(clientSource, /value > MAX_TIMER_DELAY_MS/u)
  assert.match(clientSource, /max:\s*MAX_TIMER_DELAY_MS/u)
})

test('README documents single instance per Profile and link-dev-deps includes llm and storage-domain', () => {
  assert.doesNotMatch(readmeEn, /install the bundle twice/iu)
  assert.match(readmeEn, /only one instance/iu)
  assert.doesNotMatch(readmeZh, /挂载两次/u)
  assert.match(readmeZh, /单个 Profile 只支持一个/u)
  assert.match(linkDevDepsSource, /'@deepseek-ai\/dsh-llm':\s*'packages\/llm\/llm'/u)
  assert.match(linkDevDepsSource, /'@deepseek-ai\/dsh-storage-domain':\s*'packages\/storage\/storage-domain'/u)
})
