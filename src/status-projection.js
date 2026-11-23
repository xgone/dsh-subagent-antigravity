import { z } from 'zod'

const activeRunSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
}).strict()

const stateSchema = z.object({
  inheritedEventCount: z.number().int().nonnegative(),
  pendingCallIds: z.array(z.string()),
  activeRuns: z.array(activeRunSchema),
}).strict()

const viewSchema = z.object({ count: z.number().int().nonnegative() }).strict()

function toolText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

function startedChildId(text) {
  const match = /^started subagent\s+([A-Za-z0-9._-]+)$/u.exec(text.trim())
  return match?.[1]
}

/** Session-log projection for active Antigravity executions in one parent Session. */
export const antigravityStatusProjection = {
  key: 'antigravityStatus',
  stateSchema,
  init(_header, inheritedEventCount) {
    return { inheritedEventCount, pendingCallIds: [], activeRuns: [] }
  },
  apply(state, event) {
    if (event.seq < state.inheritedEventCount) return state
    if (event.type === 'tool/call' && event.data.name === 'subagent_antigravity') {
      const callId = event.data.callId
      if (state.pendingCallIds.includes(callId)) return state
      return { ...state, pendingCallIds: [...state.pendingCallIds, callId] }
    }
    if (event.type === 'tool/result') {
      const callId = event.data.message?.toolCallId ?? event.data.message?.source?.callId
      if (typeof callId !== 'string' || !state.pendingCallIds.includes(callId)) return state
      const pendingCallIds = state.pendingCallIds.filter(id => id !== callId)
      const childId = startedChildId(toolText(event.data.message))
      if (childId === undefined || state.activeRuns.some(run => run.id === childId)) {
        return { ...state, pendingCallIds }
      }
      return {
        ...state,
        pendingCallIds,
        activeRuns: [...state.activeRuns, { id: childId, startedAt: event.time }],
      }
    }
    if (event.type === 'user/message' && event.data.source.kind === 'subagent-settled') {
      const childId = event.data.source.senderSessionId
      if (!state.activeRuns.some(run => run.id === childId)) return state
      return { ...state, activeRuns: state.activeRuns.filter(run => run.id !== childId) }
    }
    return state
  },
  stateVersion: 1,
  wire: {
    viewSchema,
    view: state => ({ count: state.activeRuns.length }),
  },
}
