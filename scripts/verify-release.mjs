#!/usr/bin/env node
/**
 * Public-release guard: fail when a file that would be committed contains a
 * credential-shaped string or one operator's machine-local path.
 *
 * Runs without dependencies so it can gate a pull request before install.
 * Synthetic fixtures under `test/` keep their intentionally fake values; the
 * operator-home rule is scoped to real personal roots rather than every
 * absolute path, because documentation demonstrates absolute install paths.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP = new Set(['node_modules', '.git'])
const RULES = [
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  // Assembled from pieces so this source line cannot itself match the rule.
  { name: 'Anthropic-style key', pattern: new RegExp('\\bs' + 'k-[A-Za-z0-9-]{20,}') },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'Bearer credential', pattern: /\bBearer\s+[A-Za-z0-9._-]{24,}/ },
  { name: 'operator home path', pattern: /\/Users\/gone\b|C:\\Users\\(?!alice\b)[^\\\s]+/ },
]

/** Every regular file below the repository root, skipping dependency trees. */
function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (statSync(path).isFile()) yield path
  }
}

const findings = []
for (const path of walk(ROOT)) {
  const name = relative(ROOT, path)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  if (text.includes('\u0000')) continue
  text.split('\n').forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) findings.push(`${name}:${index + 1}  ${rule.name}`)
    }
  })
}

if (findings.length > 0) {
  console.error('verify-release: refusing to publish machine-local or credential-shaped content:\n')
  for (const finding of findings) console.error(`  ${finding}`)
  console.error('\nRephrase the text, or move the local value into an ignored file such as *.local.yml.')
  process.exit(1)
}
console.log('verify-release: no credential-shaped or operator-home content found')