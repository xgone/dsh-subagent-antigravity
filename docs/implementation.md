# Implementation notes

This page is for maintainers. User-facing setup, configuration and troubleshooting live in the [README](../README.md).

## What it plugs into

`@xgone/dsh-subagent-antigravity` is a plain-JS Profile bundle (no build step). It keeps DSH's own child Agent and child Session and drives one long-lived Antigravity CLI (`agy`) process per child over the CLI's native stream-json protocol. It uses these seams:

- `ctx.subagents` — named provider registry; registers `antigravity` as a **continuable** provider;
- `ctx.llm` — registers the `agy-stream` provider route whose `LlmAdapter` translates CLI events into child-session stream chunks;
- `ctx.tools` — registers the `agy_progress` proxy tool used to record native tool steps as durable child-session rows;
- `ctx.subprocess` — managed process range for each `agy` child;
- `ctx.storageDomain` — durable sidecar mapping a DSH child Session to its native `agy` conversation;
- `@deepseek-ai/dsh-tool-subagent` — model-facing scheduling, bound to `subagent_antigravity`;
- `ctx.sessionProjections` — parent-side state for the Session-header running indicator.

The bundle inserts two Host rows: `subagent-antigravity` (provider) and `tool-subagent-antigravity` (tool binding). The tool row pins the child Agent route with `agentOptions: { provider: agy-stream, model: native }`.

No ACP server is involved and no `@agentclientprotocol/sdk` dependency is needed.

## Two halves

1. **Provider (`src/index.js`)** — implements `prepareContinuable()` only. Its presence selects *local* activation: DSH reserves the child Session, creates the child Agent, owns prompt delivery, continuation, cold resume and disposal. The provider contributes no prompt and no agent loop; it only validates the child cwd.
2. **Transport (`src/session.js` + `src/adapter.js`)** — the child Agent's LLM route. One `agy` process per child Session, resumed by `--conversation` after a disposal.

## Turn flow

1. DSH delivers a user message to the child; the loop calls `stream()` on the adapter.
2. `ensureSession()` reuses the child's live CLI process, or spawns one with
   `agy --input-format stream-json --output-format stream-json --disable-slash-commands <mode flags> [--model/--effort/--agent] [--conversation <id>]`.
3. The adapter writes exactly one `{"event":"user","message":{"content":[…text…]}}` line and starts draining NDJSON events.
4. `step_update` events map onto DSH stream chunks:
   - `agent_response` + `text_delta` → `block-start`/`text-delta`;
   - `tool` `ACTIVE` → a `tool-call` block naming `agy_progress` (title/kind/parameters), then `finish {kind:'tool-calls'}`;
   - `tool` `DONE`/`ERROR` → recorded in the session, resolved to the waiting proxy call;
   - `result` → close the text block, emit `usage`, then `finish` (SUCCESS→`stop`; CANCELED/INTERRUPTED→`aborted`; ERROR/INVALID/WAITING/RUNNING→`error`).
5. `agy_progress` is a **record-only** tool: DSH executes it, it awaits the native tool's terminal event and returns the CLI's real output, so the child Session shows a pending→completed tool card without running a second command.

## Design decisions

- **One long-lived process per child Session.** A DSH child is a conversation; the CLI process is its runtime. Repeated turns reuse the process and its conversation, paying the ~10 s CLI startup once.
- **`init` is not a handshake.** The CLI emits `init` only when the first turn is submitted, so `open()` proves liveness by process survival, and the native conversation id is captured from the first `init` (and from every `result`) and persisted. A child that was interrupted mid-turn fails closed on reopen rather than replaying.
- **Resume over replay.** After a disposal (including cancellation) the next activation respawns with `--conversation <id>`, so a response the model already delivered is never rerun.
- **No per-turn cancel message.** The CLI's stdin accepts only `user` events; cancelling disposes the process. This is the one real loss versus an ACP child.
- **No interactive permission channel.** `permissionMode` selects static `agy` flags; an operation the CLI will not auto-approve is denied by the product (`result.denied_actions`), exactly as in headless print mode.
- **Native configuration is authoritative.** Authentication, `settings.json`, model catalog and workspace trust stay native; only `--model`/`--effort`/`--agent`, the mode flags and the `env` overlay are set here.
- **The header indicator is derived state.** A plugin-owned Session projection tracks `subagent_antigravity` start receipts until the durable `subagent-settled` notice; it is not the progress stream.
- **Settings that must change without a reload are volatile.** `permissionMode` and `autoDelegate` are editable in the Plugins form; the posture is read when a child process is spawned.

## Model Experience

**Child request.** The child Agent is a fresh, unseeded DSH session pinned to the `agy-stream`/`native` route. Its system prompt and tool declarations are DSH's own, but the CLI ignores them: the Antigravity agent performs its own planning and tool execution. The only DSH tool the child ever "calls" is the `agy_progress` recorder.

**Live progress.** Because the CLI streams, the child Session fills in while the work happens: assistant text types out, and every native tool step appears as a card with its real output. Reasoning text is not exposed by the CLI.

**Token effect.** Token usage comes from each turn's native `usage` block, mapped to DSH's disjoint counters (`input_tokens` folds cache hits, so `cacheReadTokens` is subtracted out). Child tokens never enter the parent's context.

**Parent scheduling and results.** Through `@deepseek-ai/dsh-tool-subagent`, the parent first receives a child id, then the child's completion notice with the selected answer or a failure notice. The parent can continue the same child with `send_message`, which reuses the CLI conversation.

## Source map

| File | Role |
|---|---|
| `src/index.js` | Plugin entry: Config schema, provider registration, adapter/tool/domain wiring, quota route, `apply`. |
| `src/stream-json.js` | Pure protocol mapping: argv, turn encoder, tool kind/title/output, usage, finish reasons. |
| `src/session.js` | One CLI child process: NDJSON feed, step bookkeeping, turn state, persistence, teardown. |
| `src/adapter.js` | `LlmAdapter` over the CLI: session reuse, chunk mapping, user-task extraction. |
| `src/progress-tool.js` | `agy_progress` record-only proxy and its card renderers. |
| `src/session-domain.js` | Durable child-Session → native conversation sidecar. |
| `src/antigravity.js` | Pinned CLI flags, NDJSON feed, terminal statuses, permission posture. |
| `src/status-projection.js` | Parent Session projection that drives the header running indicator. |
| `src/enforcement.js` | Agent-scoped restrictions and dispatch guard for built-in subagent tools while auto-delegate is on. |
| `src/client.js` | Browser half: Plugins configuration form, Session-header status action, quota dock, and the keyed `tool.call.toolview` row for `agy_progress` (the web client only classifies its own built-in tool names, so a custom recorder would otherwise render as a bare "tool call · name · id"). |
| `src/agy-quota.js` | Quota reader for the composer indicator. |
| `cordis.patch.yml` | Bundle layer: provider row and tool row (route pinned). |
| `docs/antigravity-cli-facts.md` | The pinned CLI contract, with sources. |

## Known limitations

- **Cancellation ends the CLI process.** There is no per-turn cancel event; the conversation is resumed on the next message, but an in-flight turn's partial work is not recoverable.
- **No incremental tool output.** The CLI reports `ACTIVE` then `DONE`; a long command shows a running card with no partial stdout.
- **No interactive approval.** Only static `permissionMode` flags; the product denies what headless mode cannot prompt for.
- **Progress rows are one group deep.** DSH groups a finished child turn under "已完成" and its tool calls under "已调用工具"; the row itself carries the command, state and full output, but the transcript still needs those two expansions.
- **Static instance selection** — Profile rows fix provider name, model/effort/agent and tool binding; a call cannot choose them dynamically.
- **Native auth and account state remain native** — the bundle supplies nothing for login; failures surface as a safe diagnostic plus Host stderr.
- **Requires `agy` on the host** — no vendored CLI; a missing executable fails the first delegation.
- **Automatic delegation has a bounded hard policy** — while `autoDelegate` is on, Agent-scoped `tools.restrict()` hides the inherited `subagent` and `subagent_fork` tools, and a dispatch guard blocks an in-flight call or same-named scoped shadow. The prompt asks the model to call `subagent_antigravity`; the plugin does not rewrite the Agent loop.
- **No wall-clock timeout or side-effect rollback** — the caller cancels; files changed before cancellation are not restored.
- **Pinned to the observed CLI contract** — a CLI upgrade that changes event names or `step_update` shapes must refresh this provider and its fixtures.

## Repository layout

```
.
├── src/                          runtime sources (plain ESM, no build step)
├── cordis.patch.yml              bundle layer: provider row + tool row
├── locale/{en,zh}.json           Plugins-page title and description
├── icon.svg                      package icon
├── docs/                         CLI contract, implementation notes, verification
├── scripts/
│   ├── link-dev-deps.mjs         link DSH peers for local tests
│   ├── probe-stream-session.mjs  drive one real CLI turn through the bridge
│   └── verify-release.mjs        refuse secrets / machine paths before publish
├── test/                         unit, manifest, session, adapter and projection tests
└── package.json                  bundle metadata and scripts
```

## Dev notes

- **Local testing.** `node scripts/link-dev-deps.mjs --checkout <deepseek-harness>` symlinks the `@deepseek-ai/*` packages this bundle imports into `node_modules` for direct unit tests. `npm test` runs protocol mapping tests, the session state machine against a fake CLI, adapter chunk tests, the progress proxy, manifest peer checks and the projection tests — no real `agy` needed.
- **Real-CLI probe.** `node scripts/probe-stream-session.mjs "<task>"` drives one real turn through session → adapter → progress tool without booting a Host. It needs an authenticated `agy` (`AGY_CLI` overrides the path).
- **Checks.** `npm run check` runs `node --check` on every runtime module; `npm run verify:release` refuses machine-local paths and credential-shaped strings before publishing.
- **Protocol facts.** See [`docs/antigravity-cli-facts.md`](antigravity-cli-facts.md) for the exact flags, event shapes and status values this package is written against.