/**
 * Pure, dependency-free helpers for the long-lived Antigravity CLI (`agy`)
 * stream-json child session.
 *
 * The provider keeps one `agy` process per DSH child Session and speaks the
 * product's own NDJSON protocol over stdin/stdout:
 *
 *   stdin   one `{event:'user'}` line per DSH turn
 *   stdout  `init` → `step_update`* → `result` per turn
 *
 * Everything in this module is unit-testable without spawning a process:
 * argv construction, the turn encoder, the step→progress mapping, token
 * accounting and terminal-status classification.
 *
 * @module @xgone/dsh-subagent-antigravity/stream-json
 */

import { permissionModeArgs } from './antigravity.js'

/** Provider route owned by the stream-json child-session adapter. */
export const STREAM_PROVIDER = 'agy-stream'

/** Single advertised model id: Antigravity keeps its own native settings. */
export const STREAM_MODEL = 'native'

/** DSH child-session tool that records one Antigravity tool step. */
export const PROGRESS_TOOL_NAME = 'agy_progress'

/** `agy` token counters fold cache hits into `input_tokens`. */
const MAX_PROGRESS_TEXT = 12_000

/** Tool-card kinds understood by the built-in subagent UI. */
const TOOL_KINDS = new Set(['read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch'])

/**
 * Native `agy` tool name → UI card kind. Executed tool names differ from the
 * names advertised in `init.tools` (e.g. `view_file` runs as `read_file`), so
 * both vocabularies are mapped.
 */
const TOOL_KIND_BY_NAME = new Map([
  ['run_command', 'execute'],
  ['command_status', 'execute'],
  ['send_command_input', 'execute'],
  ['execute_browser_javascript', 'execute'],
  ['run_workflow', 'execute'],
  ['notebook_execution', 'execute'],
  ['read_file', 'read'],
  ['view_file', 'read'],
  ['list_dir', 'read'],
  ['list_browser_pages', 'read'],
  ['read_browser_page', 'read'],
  ['browser_get_dom', 'read'],
  ['browser_get_network_request', 'read'],
  ['browser_list_network_requests', 'read'],
  ['capture_browser_screenshot', 'read'],
  ['capture_browser_console_logs', 'read'],
  ['read_resource', 'read'],
  ['list_permissions', 'read'],
  ['read_url_content', 'fetch'],
  ['grep_search', 'search'],
  ['find_by_name', 'search'],
  ['search_web', 'search'],
  ['search_marketplace', 'search'],
  ['list_resources', 'search'],
  ['write_to_file', 'edit'],
  ['replace_file_content', 'edit'],
  ['multi_replace_file_content', 'edit'],
  ['sed_file', 'edit'],
  ['notebook_edit', 'edit'],
  ['delete_file', 'delete'],
])

/** Parameters that name the thing a tool acts on, in display priority order. */
const PRIMARY_PARAM_KEYS = [
  'CommandLine',
  'command',
  'cmd',
  'Path',
  'path',
  'file_path',
  'FilePath',
  'DirectoryPath',
  'url',
  'Url',
  'query',
  'Query',
  'pattern',
  'Pattern',
  'agent_id',
  'description',
]

/**
 * Collapse one product string into a bounded single line.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
export function oneLine(value, max = 160) {
  if (typeof value !== 'string') return ''
  const collapsed = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

/**
 * Serialize arbitrary JSON for a proxy-tool argument, bounded and never throwing.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
export function safeJson(value, max = 4_000) {
  if (value === undefined || value === null) return ''
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    return ''
  }
  if (typeof text !== 'string') return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Build the argv of one long-lived `agy` child session.
 * @param {string} executable - resolved absolute path to `agy`.
 * @param {{permissionMode: string, model?: string, effort?: string, agent?: string}} config
 * @param {string} [conversationId] - resume the CLI conversation a disposed child was using.
 * @returns {string[]} argv passed verbatim to the subprocess seam (no shell).
 */
export function buildStreamArgv(executable, config, conversationId) {
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new Error('subagent-antigravity: an executable path is required')
  }
  const argv = [
    executable,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    // A task whose text starts with `/model`, `/plan`, … must never be treated
    // as a CLI slash command; that ends the session with a product error.
    '--disable-slash-commands',
    ...permissionModeArgs(config.permissionMode),
  ]
  if (config.model !== undefined) argv.push('--model', config.model)
  if (config.effort !== undefined) argv.push('--effort', config.effort)
  if (config.agent !== undefined) argv.push('--agent', config.agent)
  if (typeof conversationId === 'string' && conversationId.length > 0) {
    argv.push('--conversation', conversationId)
  }
  return argv
}

/**
 * Encode one DSH turn as the single newline-delimited `user` event the CLI
 * reads from stdin.
 * @param {string} text - non-empty task text.
 * @returns {string} one JSON line, including the trailing newline.
 */
export function encodeUserTurn(text) {
  return `${JSON.stringify({ event: 'user', message: { content: [{ type: 'text', text }] } })}\n`
}

/**
 * Map a native tool name to a UI card kind.
 * @param {unknown} name
 * @returns {'read'|'edit'|'delete'|'move'|'search'|'execute'|'fetch'|'other'}
 */
export function toolKind(name) {
  if (typeof name !== 'string') return 'other'
  const kind = TOOL_KIND_BY_NAME.get(name)
  return kind !== undefined && TOOL_KINDS.has(kind) ? kind : 'other'
}

/**
 * Human title for one tool step: the acted-on value for commands, otherwise
 * `<tool> <primary argument>`.
 * @param {unknown} name - native tool name.
 * @param {unknown} parameters - native `tool_info.parameters`.
 * @returns {string}
 */
export function toolTitle(name, parameters) {
  const params = parameters !== null && typeof parameters === 'object' ? parameters : {}
  const label = oneLine(name) || 'Antigravity tool'
  const key = PRIMARY_PARAM_KEYS.find(candidate => typeof params[candidate] === 'string' && params[candidate].trim() !== '')
  const primary = key === undefined ? '' : oneLine(params[key])
  if (primary === '') return label
  return toolKind(name) === 'execute' ? primary : `${label} ${primary}`
}

/**
 * The text a completed tool step reports: native output, else the failure text.
 * @param {unknown} toolInfo - native `tool_info`.
 * @returns {string}
 */
export function toolOutputText(toolInfo) {
  if (toolInfo === null || typeof toolInfo !== 'object') return ''
  const output = typeof toolInfo.output === 'string' ? toolInfo.output : ''
  if (output !== '') return output.length > MAX_PROGRESS_TEXT ? output.slice(0, MAX_PROGRESS_TEXT) : output
  const error = toolInfo.error
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') {
    return error.message.length > MAX_PROGRESS_TEXT ? error.message.slice(0, MAX_PROGRESS_TEXT) : error.message
  }
  return ''
}

/**
 * Exit code reported inside a native command result, when present.
 * @param {unknown} outputText
 * @returns {number | undefined}
 */
export function parseExitCode(outputText) {
  if (typeof outputText !== 'string') return undefined
  const match = /exited with code (-?\d+)/i.exec(outputText) ?? /exit code[: ]+(-?\d+)/i.exec(outputText)
  if (match === null) return undefined
  const code = Number(match[1])
  return Number.isInteger(code) ? code : undefined
}

/**
 * Absolute path a file-oriented native tool acted on.
 * @param {unknown} parameters - native `tool_info.parameters`.
 * @returns {string | undefined}
 */
export function toolPath(parameters) {
  if (parameters === null || typeof parameters !== 'object') return undefined
  for (const key of ['Path', 'path', 'file_path', 'FilePath', 'AbsolutePath', 'DirectoryPath', 'TargetFile']) {
    const value = parameters[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Translate a native usage block into DSH token accounting.
 *
 * `agy` reports `input_tokens` including cache hits, while DSH counts cached
 * input separately and accepts only disjoint fields.
 * @param {unknown} usage - native `usage`.
 * @returns {import('@deepseek-ai/dsh-llm').TokenUsage | undefined}
 */
export function toTokenUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
  const input = count(usage.input_tokens)
  const output = count(usage.output_tokens)
  const cacheRead = count(usage.cache_read_tokens)
  const reasoning = count(usage.thinking_tokens)
  if (input === 0 && output === 0 && cacheRead === 0) return undefined
  const total = count(usage.total_tokens) || input + output
  return {
    inputTokens: Math.max(0, input - cacheRead),
    outputTokens: output,
    totalTokens: total,
    ...cacheRead > 0 ? { cacheReadTokens: cacheRead } : {},
    ...reasoning > 0 ? { reasoningTokens: reasoning } : {},
  }
}

/**
 * Map the native terminal `status` onto a DSH stream finish reason. Messages are
 * fixed: a product string never reaches model-visible text.
 * @param {unknown} status - native `result.status`.
 * @returns {import('@deepseek-ai/dsh-llm').FinishReason}
 */
export function streamFinishReason(status) {
  switch (status) {
    case 'SUCCESS':
      return { kind: 'stop' }
    case 'CANCELED':
    case 'INTERRUPTED':
      return {
        kind: 'aborted',
        failure: { message: 'Antigravity CLI turn was cancelled', code: 'AGY_CANCELLED' },
      }
    case 'INVALID':
      return {
        kind: 'error',
        failure: { message: 'Antigravity CLI reached an invalid state', code: 'AGY_INVALID' },
      }
    case 'ERROR':
      return {
        kind: 'error',
        failure: { message: 'Antigravity CLI ended the turn with an error', code: 'AGY_ERROR' },
      }
    case 'WAITING':
    case 'RUNNING':
      return {
        kind: 'error',
        failure: { message: 'Antigravity CLI ended without settling the turn', code: 'AGY_UNSETTLED' },
      }
    default:
      return {
        kind: 'error',
        failure: { message: 'Antigravity CLI reported an unknown terminal status', code: 'AGY_STATUS' },
      }
  }
}

/**
 * Native conversation id carried by `init`/`result`, used to resume a disposed
 * child's CLI session.
 * @param {unknown} event - one parsed NDJSON event.
 * @returns {string | undefined}
 */
export function conversationIdOf(event) {
  if (event === null || typeof event !== 'object') return undefined
  if (typeof event.conversation_id === 'string' && event.conversation_id.length > 0) {
    return event.conversation_id
  }
  const payload = event.init ?? event.result
  if (payload !== null && typeof payload === 'object'
    && typeof payload.conversation_id === 'string' && payload.conversation_id.length > 0) {
    return payload.conversation_id
  }
  return undefined
}
