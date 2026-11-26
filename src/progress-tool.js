import { defineTool } from '@deepseek-ai/dsh-tools'
import { callResultText } from './adapter.js'
import { PROGRESS_TOOL_NAME, STREAM_PROVIDER, oneLine, parseExitCode, toolPath } from './stream-json.js'

function parseJson(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try { return JSON.parse(value) } catch { return undefined }
}

function commandOf(raw, fallback) {
  const command = raw?.CommandLine ?? raw?.command ?? raw?.cmd
  return typeof command === 'string' && command.trim() !== '' ? oneLine(command) : fallback
}

/**
 * DSH child-session proxy tool. The Antigravity CLI already executed the tool;
 * this call only gives the child Session a durable pending/result row so the
 * built-in subagent UI can show its live state.
 *
 * @param {import('./adapter.js').AntigravityStreamLlmAdapter} adapter
 */
export function createAgyProgressTool(adapter) {
  return defineTool({
    name: PROGRESS_TOOL_NAME,
    description: 'Internal Antigravity progress bridge. This tool records a child-session progress event for a tool the Antigravity CLI already ran; it does not execute a second command.',
    parameters: {
      callId: { type: 'string', required: true },
      title: { type: 'string', required: true },
      kind: { type: 'string' },
      rawInputText: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          callId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          status: { type: 'string', required: true },
          outputText: { type: 'string', required: true },
          exitCode: { type: 'integer' },
          durationSeconds: { type: 'number' },
          path: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.outputText }],
      // The child transcript reads these through the client tool view; they are
      // cheap display facts, never model-visible result content.
      presentationMeta(args, value) {
        return {
          kind: typeof args.kind === 'string' ? args.kind : 'other',
          ...typeof value.exitCode === 'number' ? { exitCode: value.exitCode } : {},
          ...typeof value.durationSeconds === 'number' ? { durationSeconds: value.durationSeconds } : {},
        }
      },
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('Antigravity progress bridge requires its child Agent')
      const call = await adapter.waitForToolCall(agent.session.id, args.callId, exec.signal)
      const outputText = callResultText(call)
      const exitCode = parseExitCode(outputText)
      const path = toolPath(call.rawInput)
      return {
        callId: args.callId,
        title: oneLine(call.title) || args.title || 'Antigravity tool',
        status: typeof call.status === 'string' ? call.status : 'unknown',
        outputText,
        ...exitCode === undefined ? {} : { exitCode },
        ...typeof call.durationSeconds === 'number' ? { durationSeconds: call.durationSeconds } : {},
        ...path === undefined ? {} : { path },
      }
    },
    presentCall(args) {
      const title = oneLine(args.title) || 'Antigravity tool'
      const raw = parseJson(args.rawInputText)
      if (args.kind === 'execute') {
        const command = commandOf(raw, title)
        return {
          card: 'terminal',
          title: command,
          ...typeof raw?.cwd === 'string' ? { cwd: raw.cwd } : {},
        }
      }
      return {
        card: 'generic',
        title,
        kind: args.kind ?? 'other',
        ...args.rawInputText ? { rawInput: args.rawInputText } : {},
      }
    },
    presentResult(args, result) {
      const title = oneLine(args.title) || 'Antigravity tool'
      const outputText = Array.isArray(result.content)
        ? result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        : ''
      if (args.kind === 'execute') {
        const raw = parseJson(args.rawInputText)
        return { card: 'terminal', title: commandOf(raw, title), output: outputText }
      }
      return {
        card: 'generic',
        title,
        content: outputText === '' ? [] : [{ type: 'text', text: outputText }],
      }
    },
  })
}

/** Register the proxy only in child Agents routed through the CLI adapter. */
export const agyProgressToolActivation = ({ modelSelection }) => modelSelection?.provider === STREAM_PROVIDER