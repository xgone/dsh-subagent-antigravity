/**
 * Profile-named Antigravity subagent provider. DSH owns a real child Agent and
 * Session; that child's LLM route talks to one long-lived Google Antigravity
 * CLI (`agy`) process over the product's native stream-json protocol, and each
 * native tool step becomes a durable progress row in the child Session.
 *
 * The CLI keeps native authentication, settings and execution; this provider
 * adds child-session continuity, live progress, result mapping and teardown.
 * No ACP server is involved: the CLI runs in its own `--print` stream-json mode.
 *
 * @module @xgone/dsh-subagent-antigravity
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  assertUsableCwd,
} from '@deepseek-ai/dsh-subagent'
import {
  ANTIGRAVITY_PERMISSION_MODES,
  DEFAULT_ANTIGRAVITY_PERMISSION_MODE,
  DEFAULT_DISPOSE_EOF_GRACE_MS,
  DEFAULT_DISPOSE_GRACE_MS,
} from './antigravity.js'
import { antigravityStatusProjection } from './status-projection.js'
import { installAutoDelegateRouting } from './enforcement.js'
import { createAgyQuotaReader } from './agy-quota.js'
import { AntigravityStreamLlmAdapter } from './adapter.js'
import { STREAM_MODEL, STREAM_PROVIDER } from './stream-json.js'
import { STREAM_SESSION_DOMAIN_SPEC } from './session-domain.js'
import { agyProgressToolActivation, createAgyProgressTool } from './progress-tool.js'

export const name = 'subagent-antigravity'
export const inject = [
  'subagents',
  'subprocess',
  'systemPrompt',
  'sessionProjections',
  'agents',
  'tools',
  'llm',
  'storageDomain',
]

const DEFAULT_PROVIDER_NAME = 'antigravity'
const DEFAULT_COMMAND = 'agy'
const AUTO_DELEGATE_SECTION_NAME = 'subagent-antigravity:auto-delegation'
const AGY_QUOTA_ROUTE_PATH = '/api/xgone/agy-quota'

/**
 * Startup failures stay behind fixed safe facts: the child Agent never sees a
 * raw path, environment value or protocol payload.
 * @param {unknown} cause
 * @returns {Error}
 */
function antigravityStartupFailure(cause) {
  return new Error('Antigravity child session could not start', {
    cause: cause instanceof Error ? cause : new Error(String(cause)),
  })
}

function installAgyQuotaRoute(ctx, config) {
  const quotaReader = createAgyQuotaReader({
    subprocess: ctx.subprocess,
    command: config.command,
    env: config.env,
    cwd: process.cwd(),
  })
  ctx.effect(() => async () => { await quotaReader.dispose() }, 'subagent-antigravity.agy-quota-reader')
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => connectionCtx.connection.fetch.register({
      path: AGY_QUOTA_ROUTE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.signal.aborted) return new Response(null, { status: 204 })
        try {
          const snapshot = await quotaReader.read(request.signal)
          if (request.signal.aborted) return new Response(null, { status: 204 })
          return Response.json(snapshot, { headers: { 'cache-control': 'no-store' } })
        } catch {
          if (request.signal.aborted) return new Response(null, { status: 204 })
          return Response.json({
            status: 'unavailable', reason: 'internal', groups: [], fetchedAt: new Date().toISOString(),
          }, { headers: { 'cache-control': 'no-store' } })
        }
      },
    }), 'subagent-antigravity.agy-quota-route')
  })
}

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
 * @property {number} [disposeEofGraceMs] - grace for the CLI to flush a session after stdin EOF.
 * @property {number} [disposeGraceMs] - grace between managed-range termination tiers.
 * @property {import('@deepseek-ai/cordis').Volatile<boolean>} autoDelegate - hide built-in DSH subagent tools for each live Agent and ask it to use `subagent_antigravity` for new user tasks.
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
  disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  autoDelegate: z.boolean().default(false).volatile(),
})

class AntigravityProvider {
  /** @param {string} providerName @param {import('@deepseek-ai/cordis').Context} ctx @param {Required<Omit<Config, 'model'|'effort'|'agent'>> & Pick<Config,'model'|'effort'|'agent'>} config */
  constructor(providerName, ctx, config) {
    this.name = providerName
    this.capabilities = Object.freeze({
      agentOptions: true,
      agentPreset: true,
      outputSchema: true,
      depthLimit: true,
    })
    this.inheritsParentContext = false
    this.agentRouteDefaults = Object.freeze({ provider: STREAM_PROVIDER, model: STREAM_MODEL })
    this.ctx = ctx
    this.config = config
  }

  /**
   * DSH owns the child Agent and its durable Session; this provider contributes
   * only a fresh, unseeded child. The child route is pinned to the CLI adapter
   * registered by this plugin, which keeps one `agy` process per child Session.
   *
   * @param {import('@deepseek-ai/dsh-subagent').ContinuableCreateRequest} request
   * @returns {Promise<import('@deepseek-ai/dsh-subagent').ContinuableCreateSpec>}
   */
  async prepareContinuable(request) {
    if (request.signal.aborted) {
      throw new Error('subagent-antigravity: request was aborted before child creation')
    }
    try {
      assertUsableCwd('subagent-antigravity', 'child cwd', request.cwd)
    } catch (error) {
      throw antigravityStartupFailure(error)
    }
    return {}
  }
}

/**
 * Register one Profile-named Antigravity provider.
 * @param {import('@deepseek-ai/cordis').Context} ctx - context carrying shared subagent, subprocess, LLM and storage services.
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
    disposeEofGraceMs: config.disposeEofGraceMs ?? DEFAULT_DISPOSE_EOF_GRACE_MS,
    disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
    autoDelegate: config.autoDelegate,
  }
  assertPositiveFinite('subagent-antigravity', 'disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('subagent-antigravity', 'disposeGraceMs', resolved.disposeGraceMs)
  if (resolved.disposeEofGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`subagent-antigravity: disposeEofGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`subagent-antigravity: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  installAgyQuotaRoute(ctx, resolved)
  const statusProjection = await ctx.sessionProjections.register(antigravityStatusProjection)
  ctx.effect(() => () => statusProjection.dispose(), 'subagent-antigravity.status-projection')

  const streamSessionDomain = await ctx.storageDomain.open(STREAM_SESSION_DOMAIN_SPEC)
  ctx.effect(() => () => streamSessionDomain.close(), 'subagent-antigravity.stream-session-domain')
  const adapter = new AntigravityStreamLlmAdapter(ctx, resolved, streamSessionDomain)
  ctx.llm.registerAdapter([STREAM_PROVIDER], adapter)
  ctx.tools.register(createAgyProgressTool(adapter), { when: agyProgressToolActivation })
  ctx.effect(() => () => adapter.disposeAll(), 'subagent-antigravity.stream-sessions')

  ctx.subagents.registerProvider(new AntigravityProvider(resolved.providerName, ctx, resolved))
  const routing = installAutoDelegateRouting(ctx)
  let disposeAutoDelegateSection
  const syncAutoDelegateSection = () => {
    const enabled = resolved.autoDelegate.get()
    routing.setEnabled(enabled)
    if (enabled) {
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
      routing.dispose()
      disposeAutoDelegateSection?.()
      disposeAutoDelegateSection = undefined
    }
  }, 'subagent-antigravity.auto-delegation')
}