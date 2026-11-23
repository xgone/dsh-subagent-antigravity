# Implementation notes

This page is for maintainers. User-facing setup, configuration and troubleshooting live in the [README](../README.md).

## What it plugs into

`dsh-subagent-antigravity` is a plain-JS Profile bundle (no build step), adapted from DSH's built-in Codex subagent provider (`packages/subagent/subagent-codex`). It uses the same seams:

- `ctx.subagents` — named provider registry; registers `antigravity`;
- `ctx.subprocess` — managed process range for the `agy` child;
- `@deepseek-ai/dsh-tool-subagent` — model-facing scheduling, bound to `subagent_antigravity`;
- `ctx.sessionProjections` — parent-side state for the Session-header running indicator.

The bundle inserts two Host rows: `subagent-antigravity` (provider) and `tool-subagent-antigravity` (tool binding). Nothing spawns until a delegation happens.

## Run flow

1. Validate the task: only non-empty text blocks; capture the child cwd.
2. Resolve `command` through `ctx.subprocess.resolveExecutable`.
3. Spawn `agy --input-format stream-json --output-format stream-json --disable-slash-commands <mode flags> [--model/--effort/--agent]` with piped stdio and the credential-scrubbed environment plus `env`.
4. Write one `{"event":"user","message":{"content":[…text blocks…]}}` line to stdin.
5. **Publish the run only after the CLI emits `init`.** A `result` before `init`, or an early exit, fails `start()` with a safe startup diagnostic.
6. Await the `result` event. `SUCCESS` with a non-blank response → `completed`; `CANCELED`/`INTERRUPTED` → `aborted`; `ERROR`/`INVALID`/`WAITING`/`RUNNING`/missing → `error` with a safe category.
7. Dispose: close stdin, terminate the managed range, wait for whole-tree exit.

### Why stream-json over stdin, not `agy -p "<task>"`

`-p` puts the task on the command line (ARG_MAX limits, shell quoting, no incremental events). `--input-format stream-json` carries the prompt on stdin, emits `init`/`step_update`/`result`, and closes cleanly when stdin ends. `--disable-slash-commands` keeps task text that begins with a CLI slash command from being interpreted as one.

## Design decisions

- **One fresh process and one turn per run** — no continuation, resume, pooling, progress stream or product-session persistence.
- **Native configuration is authoritative** — authentication, `settings.json`, model catalog and workspace trust stay native. Only `--model`/`--effort`/`--agent` and the `permissionMode` flags are overridden.
- **The terminal `result` is the only authority** — a run completes only when `status === "SUCCESS"` and `response` is non-blank. Other statuses map to `aborted` or `error`. When the terminal response is blank but assistant text streamed earlier, that text is forwarded as partial error output; the run is still reported as `invalid-result` rather than promoted to success.
- **The header indicator is derived state** — a plugin-owned Session projection tracks `subagent_antigravity` start receipts until the durable `subagent-settled` notice, and a header action renders the count. It is not a progress stream.
- **Settings that must change without a reload are volatile** — `permissionMode` and `autoDelegate` are editable in the Plugins form. A switch change updates both the prompt section and the live tool policy.

## Model Experience

**Child request.** The child receives the standalone text blocks as one turn in a fresh `agy` session. Its workspace is the selected child cwd; the provider instance fixes any configured model, effort, agent, environment and permission posture. The CLI version and authentication come from the host `agy`.

**Token effect.** The child pays for an independent Antigravity context. Child tokens do not enter the parent's context.

**Parent scheduling and results.** Through `@deepseek-ai/dsh-tool-subagent`, the parent first receives a child id, then the selected answer or a failure notice with stop reason and safe diagnostic. Reasoning, tool traffic, stderr and diffs are not copied into the parent Session. This provider adds no parent tool schema by itself.

## Source map

| File | Role |
|---|---|
| `src/index.js` | Plugin entry: Config schema, provider registration, `apply`. |
| `src/run.js` | Run lifecycle: resolve executable, spawn, startup gate, result mapping, dispose. |
| `src/antigravity.js` | Pure protocol: argv, user-event encoding, NDJSON feed, status classification, diagnostics. |
| `src/status-projection.js` | Parent Session projection that drives the header running indicator. |
| `src/enforcement.js` | Agent-scoped restrictions and dispatch guard for built-in subagent tools while auto-delegate is on. |
| `src/client.js` | Browser half: Plugins configuration form and Session-header status action. |
| `cordis.patch.yml` | Bundle layer: provider row and tool row. |
| `docs/antigravity-cli-facts.md` | The pinned CLI contract, with sources. |

## Known limitations

- **One fresh process and one turn per run** — no continuation, resume, pooling, progress stream or product-session persistence.
- **Static instance selection** — Profile rows fix provider name, model/effort/agent and tool binding; a call cannot choose them dynamically.
- **Native auth and account state remain native** — the bundle supplies nothing for login; configuration and authentication failures surface as a safe `unknown`/`product-error` diagnostic plus Host stderr.
- **Requires `agy` on the host** — no vendored CLI and no `PATH` fallback beyond `command`; a missing executable fails the first delegation.
- **No human approval path** — `permissionMode` chooses an unattended posture; nothing creates a DSH interaction channel.
- **Automatic delegation has a bounded hard policy** — while `autoDelegate` is on, Agent-scoped `tools.restrict()` hides the inherited `subagent` and `subagent_fork` tools, and a dispatch guard blocks an in-flight call or same-named scoped shadow. The prompt asks the model to call `subagent_antigravity`. The model can still answer directly or use unrelated tools; the plugin does not rewrite the Agent loop.
- **Assistant payload is the final `response` only** — reasoning, tool output, usage, stderr and diffs stay outside the parent Session.
- **No optional shared capabilities** — `agentPreset`, `agentOptions`, `outputSchema` and harness depth enforcement are rejected by the shared service for this provider.
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work; files changed before cancellation are not restored.
- **Pinned to the documented CLI contract** — a CLI change that alters the envelope or event names must refresh this provider.

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
│   └── verify-release.mjs        refuse secrets / machine paths before publish
├── test/                         unit, manifest, lifecycle and projection tests
└── package.json                  bundle metadata and scripts
```

## Dev note

- **Local testing.** `node scripts/link-dev-deps.mjs --checkout <deepseek-harness>` symlinks the `@deepseek-ai/*` packages this bundle imports into `node_modules` for direct unit tests. `npm test` runs protocol tests, manifest peer checks, fake-CLI lifecycle integration tests (`test/run.integration.test.js`, no real `agy`), and the projection tests.
- **Checks.** `npm run check` runs `node --check` on every runtime module; `npm run verify:release` refuses machine-local paths and credential-shaped strings before publishing.
- **Protocol facts.** See [`docs/antigravity-cli-facts.md`](antigravity-cli-facts.md) for the exact flags, event shapes and status values this package is written against.
