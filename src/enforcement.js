const BUILT_IN_SUBAGENT_TOOLS = ['subagent', 'subagent_fork']
const AGY_TOOL_NAME = 'subagent_antigravity'

/**
 * Hide DSH's built-in child-agent tools from every live Agent while automatic
 * Antigravity delegation is enabled. The Agent-scoped restriction removes the
 * schemas and revalidates dispatch; the guard is a backstop for a call already
 * in flight when the setting changes.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context with tools and agents services.
 * @returns {{ setEnabled(enabled: boolean): void; dispose(): void }} switch and teardown controls.
 */
export function installAutoDelegateRouting(ctx) {
  const targetedAgents = new Set()
  /** @type {Map<object, Map<string, () => void>>} */
  const restrictions = new Map()
  let enabled = false
  let refreshing = false

  const warn = (message, error) => {
    const reason = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`subagent-antigravity: ${message}: ${reason}`)
  }

  const restrictAgent = (agent) => {
    targetedAgents.add(agent)
    let agentRestrictions = restrictions.get(agent)
    if (agentRestrictions === undefined) {
      agentRestrictions = new Map()
      restrictions.set(agent, agentRestrictions)
    }
    for (const toolName of BUILT_IN_SUBAGENT_TOOLS) {
      if (agentRestrictions.has(toolName)) continue
      try {
        // The DSH tool registry validates that each denied name is inherited
        // by this Agent. A same-named scoped tool is still blocked by guard().
        if (ctx.tools.get(toolName, agent) === undefined) continue
        const dispose = agent.ctx.tools.restrict({ deny: [toolName] })
        agentRestrictions.set(toolName, dispose)
      } catch (error) {
        warn(`could not hide built-in tool ${JSON.stringify(toolName)} for Agent ${agent.id}`, error)
      }
    }
  }

  const refresh = () => {
    if (!enabled || refreshing) return
    refreshing = true
    try {
      for (const agent of ctx.agents.list()) restrictAgent(agent)
    } catch (error) {
      warn('could not refresh built-in subagent restrictions', error)
    } finally {
      refreshing = false
    }
  }

  const offCreated = ctx.on('agent/created', ({ agent }) => {
    if (!enabled) return
    try {
      restrictAgent(agent)
    } catch (error) {
      // A listener failure would fail Agent creation, so enforcement errors are
      // contained and the dispatch guard remains active for this Agent.
      targetedAgents.add(agent)
      warn(`could not restrict newly created Agent ${agent.id}`, error)
    }
  })

  const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
    // Agent scope disposal has already released its restrictions.
    restrictions.delete(agent)
    targetedAgents.delete(agent)
  })

  const offToolsChange = ctx.on('tools/change', refresh)
  const offGuard = ctx.tools.guard((execution) => {
    if (!enabled || execution.agent === undefined || !targetedAgents.has(execution.agent)) return undefined
    if (!BUILT_IN_SUBAGENT_TOOLS.includes(execution.name)) return undefined
    return `Automatic Antigravity delegation is enabled. Use ${AGY_TOOL_NAME} instead of ${execution.name}.`
  })

  const releaseRestrictions = () => {
    for (const agentRestrictions of restrictions.values()) {
      for (const dispose of agentRestrictions.values()) {
        try {
          dispose()
        } catch (error) {
          warn('could not release a built-in subagent restriction', error)
        }
      }
    }
    restrictions.clear()
    targetedAgents.clear()
  }

  return {
    setEnabled(next) {
      if (enabled === next) return
      enabled = next
      if (enabled) refresh()
      else releaseRestrictions()
    },
    dispose() {
      enabled = false
      releaseRestrictions()
      offCreated()
      offDisposed()
      offToolsChange()
      offGuard()
    },
  }
}
