#!/usr/bin/env node
/**
 * Link the runtime packages this bundle imports into a local `node_modules`
 * so it can be loaded, unit-tested or `node --check`ed from this
 * checkout without a registry round-trip.
 *
 * A linked (directory) bundle "uses that checkout's dependencies and peers", so
 * for local development the harness packages must be reachable through this
 * package's own `node_modules`. In a real profile install those same packages
 * come from the DSH installation.
 *
 * Usage:
 *   node scripts/link-dev-deps.mjs [--checkout /abs/path/to/deepseek-harness]
 *
 * Idempotent. Never writes outside this package's node_modules.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** package name -> path relative to the harness checkout root. */
const PACKAGES = {
  '@deepseek-ai/schemastery': 'vendor/schemastery',
  '@deepseek-ai/dsh-agent': 'packages/core/agent',
  '@deepseek-ai/dsh-tools': 'packages/core/tools',
  '@deepseek-ai/dsh-llm': 'packages/llm/llm',
  '@deepseek-ai/dsh-storage-domain': 'packages/storage/storage-domain',
  '@deepseek-ai/dsh-subagent': 'packages/subagent/subagent',
  '@deepseek-ai/dsh-subprocess': 'packages/subprocess/subprocess',
  '@deepseek-ai/dsh-timeout': 'packages/util/timeout',
  'zod': 'node_modules/zod',
}

function parseCheckout(argv) {
  const index = argv.indexOf('--checkout')
  if (index !== -1) return resolve(argv[index + 1] ?? '')
  if (process.env.DSH_CHECKOUT) return resolve(process.env.DSH_CHECKOUT)
  // Best-effort default: the sibling deepseek-harness checkout of this workspace.
  const fallback = resolve(ROOT, '../../../deepseek/deepseek-harness')
  return fallback
}

function main() {
  const checkout = parseCheckout(process.argv.slice(2))
  if (!existsSync(checkout)) {
    console.error(`link-dev-deps: checkout not found: ${checkout}`)
    console.error('pass --checkout /abs/path/to/deepseek-harness or set DSH_CHECKOUT')
    process.exit(1)
  }

  const scopeDir = join(ROOT, 'node_modules', '@deepseek-ai')
  mkdirSync(scopeDir, { recursive: true })

  let linked = 0
  for (const [pkg, rel] of Object.entries(PACKAGES)) {
    const target = join(checkout, rel)
    if (!existsSync(join(target, 'package.json'))) {
      console.error(`link-dev-deps: missing package at ${target}`)
      process.exit(1)
    }
    const linkPath = pkg.startsWith('@deepseek-ai/')
      ? join(scopeDir, pkg.slice('@deepseek-ai/'.length))
      : join(ROOT, 'node_modules', pkg)
    mkdirSync(dirname(linkPath), { recursive: true })
    if (existsSync(linkPath) || isSymlink(linkPath)) {
      const current = readLink(linkPath)
      if (current === target) { linked += 1; continue }
      rmSync(linkPath, { recursive: true, force: true })
    }
    symlinkSync(target, linkPath, 'dir')
    console.log(`linked  ${pkg} -> ${target}`)
    linked += 1
  }
  console.log(`\nlink-dev-deps: ${linked} package(s) available under ${scopeDir}`)
}

function isSymlink(path) {
  try { return lstatSync(path).isSymbolicLink() } catch { return false }
}

function readLink(path) {
  try { return resolve(dirname(path), readlinkSync(path)) } catch { return undefined }
}

main()
