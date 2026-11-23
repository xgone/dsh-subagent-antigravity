/**
 * Profile-named Antigravity one-shot subagent provider. Every accepted run
 * starts a fresh Google Antigravity CLI (`agy`) headless stream-json session in
 * the delegating Session's workspace and publishes only after the CLI reports
 * an established session. Native Antigravity authentication and settings stay
 * authoritative; this provider adds delegation, result mapping and teardown.
 *
 * @module dsh-subagent-antigravity
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  assertUsableCwd,
  NO_START_CAPABILITIES,
} from '@deepseek-ai/dsh-subagent'
import {
  ANTIGRAVITY_PERMISSION_MODES,
  DEFAULT_ANTIGRAVITY_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
} from './antigravity.js'
import { antigravityStatusProjection } from './status-projection.js'
import { antigravityStartupFailure, startAntigravityRun } from './run.js'

export const name = 'subagent-antigravity'
export const inject = ['subagents', 'subprocess', 'systemPrompt', 'sessionProjections']

const DEFAULT_PROVIDER_NAME = 'antigravity'
const DEFAULT_COMMAND = 'agy'
const AUTO_DELEGATE_SECTION_NAME = 'subagent-antigravity:auto-delegation'

/**
 * Prompt guidance used only when `autoDelegate` is enabled. DSH retains the
 * parent Session and one light scheduling/relay turn; Antigravity performs the
 * delegated work in its independent CLI session.
 */
export const AUTO_DELEGATE_INSTRUCTIONS = [
  'Automatic Antigravity delegation is enabled.',
  'For each new user task, call `subagent_antigravity` exactly once before doing any work yourself. Give a concise `description` and a self-contained `prompt` with the request and needed context; the child does not inherit this conversation. Omit `cwd` for the current workspace; set it only when the user chose another directory.',
  'A start acknowledgement is not the result. End your turn and wait for the completion notice; do not poll or start another child.',
  'When the child completion notice arrives, do not delegate it again. Relay the final answer or failure diagnostic faithfully. If the child failed, report the failure and stop; do not take over the task or retry it yourself unless the user explicitly asks for a fallback.',
  'If required image or attachment content is not available in the workspace, tell the user and ask for accessible text or a path.',
].join('\n')

/**
 * Deployment-owned model, permission, environment and process-release settings.
 * @typedef {object} Config
 * @property {string} [providerName] - registry name on `ctx.subagents` (default `antigravity`).
 * @property {string} [command] - `agy` executable name or absolute path resolved by the subprocess seam (default `agy`).
 * @property {string} [model] - native model slug passed as `--model`; omitted to inherit Antigravity settings.
 * @property {string} [effort] - native reasoning effort passed as `--effort`; omitted to inherit.
 * @property {string} [agent] - native custom agent passed as `--agent`; omitted to inherit.
 * @property {import('@deepseek-ai/cordis').Volatile<'default'|'accept-edits'|'auto'|'dangerously-skip-permissions'>} permissionMode - volatile permission posture exposed in the Plugins form.
 * @property {Record<string, string>} [env] - explicit child environment layered over the scrubbed parent environment.
 * @property {number} [disposeGraceMs] - grace between managed-range termination tiers.
 * @property {import('@deepseek-ai/cordis').Volatile<boolean>} autoDelegate - add a system-prompt policy that asks the parent DSH Agent to delegate every new user task to `subagent_antigravity` and relay its result.
 */

export const Config = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  command: z.string().min(1).default(DEFAULT_COMMAND),
  model: z.string().min(1),
  effort: z.string().min(1),
  agent: z.string().min(1),
  permissionMode: z.union([...ANTIGRAVITY_PERMISSION_MODES])
    .default(DEFAULT_ANTIGRAVITY_PERMISSION_MODE)
    .volatile(),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  autoDelegate: z.boolean().default(false).volatile(),
})

class AntigravityProvider {
  /** @param {string} providerName @param {import('@deepseek-ai/cordis').Context} ctx @param {Required<Omit<Config, 'model'|'effort'|'agent'>> & Pick<Config,'model'|'effort'|'agent'>} config */
  constructor(providerName, ctx, config) {
    this.name = providerName
    this.capabilities = NO_START_CAPABILITIES
    this.inheritsParentContext = false
    this.ctx = ctx
    this.config = config
  }

  /**
   * @param {import('@deepseek-ai/dsh-subagent').ResolvedSubagentStartRequest} request
   * @returns {Promise<import('@deepseek-ai/dsh-subagent').SubagentRun>}
   */
  async start(request) {
    let cwd
    try {
      cwd = assertUsableCwd('subagent-antigravity', 'child cwd', request.cwd)
    } catch (error) {
      if (request.signal.aborted) {
        throw new Error('subagent-antigravity: request was aborted before CLI startup')
      }
      throw antigravityStartupFailure(error)
    }

    /** @type {import('./run.js').AntigravityRunSpec} */
    const spec = {
      cwd,
      ...this.config.model === undefined ? {} : { model: this.config.model },
      ...this.config.effort === undefined ? {} : { effort: this.config.effort },
      ...this.config.agent === undefined ? {} : { agent: this.config.agent },
      permissionMode: this.config.permissionMode.get(),
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      command: this.config.command,
      resolveExecutable: (command, env, signal) => this.ctx.subprocess.resolveExecutable(command, env, signal),
      spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-antigravity "${this.name}": child run failed (${stopReason}): ${error.message}`,
        )
      },
    }
    return startAntigravityRun(request, spec)
  }
}

/**
 * Register one Profile-named Antigravity provider.
 * @param {import('@deepseek-ai/cordis').Context} ctx - context carrying shared subagent and subprocess services.
 * @param {Config} config - registry name, executable, model/effort/agent overrides, permission mode, env and disposal grace.
 */
export async function apply(ctx, config) {
  /** @type {Required<Omit<Config, 'model'|'effort'|'agent'>> & Pick<Config,'model'|'effort'|'agent'>} */
  const resolved = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    command: config.command ?? DEFAULT_COMMAND,
    ...config.model === undefined ? {} : { model: config.model },
    ...config.effort === undefined ? {} : { effort: config.effort },
    ...config.agent === undefined ? {} : { agent: config.agent },
    permissionMode: config.permissionMode,
    env: config.env ?? {},
    disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
    autoDelegate: config.autoDelegate,
  }
  assertPositiveFinite('subagent-antigravity', 'disposeGraceMs', resolved.disposeGraceMs)
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`subagent-antigravity: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const statusProjection = await ctx.sessionProjections.register(antigravityStatusProjection)
  ctx.effect(() => () => statusProjection.dispose(), 'subagent-antigravity.status-projection')
  ctx.subagents.registerProvider(new AntigravityProvider(resolved.providerName, ctx, resolved))
  let disposeAutoDelegateSection
  const syncAutoDelegateSection = () => {
    if (resolved.autoDelegate.get()) {
      if (disposeAutoDelegateSection === undefined) {
        disposeAutoDelegateSection = ctx.systemPrompt.section({
          name: AUTO_DELEGATE_SECTION_NAME,
          order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 10,
          text: AUTO_DELEGATE_INSTRUCTIONS,
          interpolate: false,
        })
      }
    } else if (disposeAutoDelegateSection !== undefined) {
      disposeAutoDelegateSection()
      disposeAutoDelegateSection = undefined
    }
  }
  ctx.effect(() => {
    const offSettings = ctx.on('settings/document-updated', syncAutoDelegateSection)
    syncAutoDelegateSection()
    return () => {
      offSettings()
      disposeAutoDelegateSection?.()
      disposeAutoDelegateSection = undefined
    }
  }, 'subagent-antigravity.auto-delegation')
}
