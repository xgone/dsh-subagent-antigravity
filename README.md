---
description: "The one-shot Google Antigravity CLI (agy) subagent provider: a Profile bundle that adds a `subagent_antigravity` tool backed by headless `agy` sessions."
kind: "package-bundle"
---

# dsh-subagent-antigravity

English | [中文](README.zh.md)

## Summary

Install `dsh-subagent-antigravity` into a Profile when delegated work should run in a genuine, unattended **Google Antigravity CLI** (`agy`) session in the parent Session's workspace. Each delegation starts one fresh `agy` headless process in `--input-format stream-json / --output-format stream-json` mode, sends one self-contained text task, and returns only the final answer or a safe failure diagnostic.

Native Antigravity authentication and settings stay authoritative — the bundle does not log in, discover models, or rewrite `settings.json`. `permissionMode` selects how much the unattended session may do without a human.

This package is a plain-JS Profile bundle (no build step), adapted from DSH's built-in Codex subagent provider (`packages/subagent/subagent-codex`). It plugs into the same seams: `ctx.subagents` (named provider registry), `ctx.subprocess` (managed process range) and `@deepseek-ai/dsh-tool-subagent` (model-facing scheduling).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known limitations](#known-limitations)
- [Dev note](#dev-note)
- [Repository layout](#repository-layout)
- [License](#license)

-----

<a id="use-this-package"></a>
## Use this package

### Prerequisites

1. **Install the Antigravity CLI.** The bundle resolves the `agy` executable through the subprocess seam; it does not vendor the CLI. Install it with the official installer for your platform (default binary `~/.local/bin/agy` on macOS/Linux):

   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   agy --version
   ```

   If `agy` is not on the PATH of the DSH process, set `command` to its absolute path.

2. **Authenticate at least once.** Headless mode uses cached credentials (OS keyring). In a non-interactive environment with no terminal, an unauthenticated run exits with an authentication error instead of hanging. Options include an interactive `agy` sign-in once, a `GEMINI_API_KEY` with `modelProvider: gemini`, or Google Cloud ADC (`AGY_ADC_AUTH=true`). This provider never manages auth.

### Installing the bundle

Clone this repository, then install the checkout as a bundle:

```bash
git clone https://github.com/xgone/dsh-subagent-antigravity.git
dsh plugin --profile <name> add "$(pwd)/dsh-subagent-antigravity"
```

Or, in a session, install it with the `plugin_manager` tool (`action: install_bundle`, `target` = the absolute directory above). The bundle inserts two Host rows:

- `subagent-antigravity` — registers provider name `antigravity` on `ctx.subagents`;
- `tool-subagent-antigravity` — binds the shipped `@deepseek-ai/dsh-tool-subagent` to that provider, exposing `subagent_antigravity` as a global tool.

The bundle starts **no** `agy` process until a delegation happens. Restart if the installer reports that a restart is required.

> The manifest declares the DSH runtime packages as peers so the launcher resolves them from its installed runtime. A linked directory bundle otherwise uses that checkout's dependencies; for direct local imports and unit tests against a source checkout, run `node scripts/link-dev-deps.mjs --checkout /path/to/deepseek-harness` first. The bundle was also copied without `node_modules` into a clean test Profile; `dsh --profile <test-profile> --dump-config-schema` loaded its Config through the real DSH resolver.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `antigravity` | Non-empty registry name on `ctx.subagents`; each mounted instance needs a unique value. |
| `command` | `agy` | `agy` executable name or absolute path, resolved by the subprocess seam. |
| `model` | native settings | Optional model slug passed as `--model` (see `agy models`). Omitted → inherit Antigravity settings. |
| `effort` | native settings | Optional reasoning effort (`low`…`max`, model-dependent) passed as `--effort`. |
| `agent` | native settings | Optional custom agent passed as `--agent` (see `agy agents`). |
| `permissionMode` | `accept-edits` | Unattended posture; see the table below. |
| `env` | `{}` | Explicit child environment layered over the credential-scrubbed parent environment. An API key intended for the child must be supplied here. |
| `disposeGraceMs` | `3000` | Grace between managed-range termination tiers. |
| `autoDelegate` | `false` | Add guidance telling the parent DSH Agent to delegate every new user task to `subagent_antigravity`, wait for the completion notice, then relay the child result. The DSH model still schedules and relays; this is prompt policy, not a hard execution router. |

| `permissionMode` | `agy` flags | Native behavior |
|---|---|---|
| `default` | `--sandbox` | Never auto-approve; commands stay in the terminal sandbox. File edits and commands that need approval cannot be approved in headless mode and are effectively declined. |
| `accept-edits` | `--mode=accept-edits --sandbox` | Auto-approve workspace file creations/edits; commands still run under the sandbox and may need approval. **Safe default for a coding subagent.** |
| `auto` | `--mode=auto --sandbox` | Auto-approve edits and sandboxed/safe commands; irreversible actions still prompt. Requires the terminal sandbox and a personal account; unavailable on business/enterprise accounts, where `agy` falls back to `default` mode. |
| `dangerously-skip-permissions` | `--dangerously-skip-permissions` | Auto-approve **all** tool calls. Select only when the prompt and workspace are fully trusted. |

### Choosing the model

The model is a property of the provider row, not of an individual tool call. List the slugs the CLI can serve, then set the one this Profile should use:

```bash
agy models                         # prints "<slug><TAB><display name>" per line
```

```yaml
- id: subagent-antigravity
  name: 'dsh-subagent-antigravity'
  config:
    command: /path/to/agy
    model: gemini-4-neon-high      # passed verbatim as agy --model
    effort: high                   # passed verbatim as agy --effort
```

`model` and `effort` are optional; omit either to inherit the native Antigravity settings. Some slugs already embed a variant and effort, so set `effort` only when the chosen model exposes selectable levels. A bad slug is not validated locally: the CLI rejects it and the run settles with the provider's safe `product-error` diagnostic.

Every delegation from that Profile uses this model. To route different tasks to different models, mount the bundle more than once with distinct `providerName`/`model` values plus a tool row per provider (`toolName` must also be distinct), or edit the Profile row and restart. Per-call model selection is not part of this provider: the shared DSH tool's `modelSelection` option chooses a DSH LLM route, which is a different namespace from Antigravity slugs.

### Exposing the tool

The bundle inserts `tool-subagent-antigravity` as a Host row, so `subagent_antigravity` is a global tool visible to every preset. A preset that registers its own tool with the same name shadows it. Open **Plugins → Installed plugins → dsh-subagent-antigravity**, select the `subagent-antigravity` row, and click **Configure**. **Automatically delegate new tasks to Antigravity** saves immediately to the active Profile. When enabled, the parent DSH Agent uses the tool for new user tasks, waits for its completion notice, and relays the result; the child still receives no earlier conversation history. This prompt policy guides the model but does not technically force the model to call the tool.

The same page lets you change **Antigravity permission mode**. `accept-edits` approves workspace edits but terminal commands may still require a human; a headless subagent cannot answer prompts. `auto` reviews safe sandbox commands when the signed-in account supports it. `dangerously-skip-permissions` bypasses all approvals and the sandbox; choose it only when you trust every task and workspace.

While an Antigravity child is active, the current Session header shows an AGY running indicator and count. It clears when DSH records the child's settlement notice. The first version reports lifecycle state, not step-by-step CLI progress.

To mount the provider and tool without selecting the bundle layer, insert the same rows in a `cordis.patch.yml`: 

```yaml
- insert:
    - id: subagent-antigravity
      name: 'dsh-subagent-antigravity'
    - id: tool-subagent-antigravity
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: antigravity
        toolName: subagent_antigravity
        maxDepth: provider-managed
```

### What you get

The completion notice contains the selected `agy` answer, or the stop reason and an optional safe diagnostic. Product reasoning, tool activity, raw stderr and workspace diffs do not enter the parent Session; the parent log retains the external task identity and terminal result. A cancelled run settles as `aborted`.

### Failure and recovery

`agy` not found, unauthenticated in a non-interactive environment, unsupported platform or model name — the run fails with a safe `Product subagent failure (product: Antigravity; stage: …; category: …)` diagnostic and the product's own messages remain on Host stderr. There is no host fallback and no managed login.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

- **One fresh process and one turn per run.** Every run spawns `agy` in stream-json mode, sends exactly one `user` event, reads exactly one `result` event, then closes stdin. No continuation, resume, pooling or product-session persistence.
- **Native configuration is authoritative.** Authentication, `settings.json`, model catalog and workspace trust stay native. The provider overrides only optional `--model`/`--effort`/`--agent` and the `permissionMode` flags.
- **Unattended by design.** No interaction channel is created; whatever the posture auto-approves runs, everything else is denied/hidden behind the sandbox.
- **The terminal `result` event is the authority.** A run completes only when `status === "SUCCESS"` and `response` is non-blank; other statuses map to `aborted` or `error`.

### Source map

| File | Role |
|---|---|
| [`src/index.js`](src/index.js) | Plugin entry: Config schema, provider registration, `apply`. |
| [`src/run.js`](src/run.js) | Run lifecycle: resolve executable, spawn, startup gate, result mapping, dispose. |
| [`src/antigravity.js`](src/antigravity.js) | Pure protocol: argv, user-event encoding, NDJSON feed, status classification, diagnostics. |
| [`src/status-projection.js`](src/status-projection.js) | Parent Session projection that drives the header running indicator. |
| [`src/client.js`](src/client.js) | Browser half: Plugins configuration form and Session header status action. |
| [`cordis.patch.yml`](cordis.patch.yml) | Profile layer that registers the provider and the delegation tool. |
| [`docs/antigravity-cli-facts.md`](docs/antigravity-cli-facts.md) | The documented CLI facts this provider is pinned to, with sources. |

### Run flow

1. Validate the task: only non-empty text blocks; capture the child cwd.
2. Resolve `command` through `ctx.subprocess.resolveExecutable`.
3. Spawn `agy --input-format stream-json --output-format stream-json --disable-slash-commands <mode flags> [--model/--effort/--agent]` with piped stdio and the credential-scrubbed environment plus `env`.
4. Write one `{"event":"user","message":{"content":[…text blocks…]}}` line to stdin.
5. **Publish the run only after the CLI emits `init`** (session established). A `result` before `init` or an early process exit fails `start()` with a safe startup diagnostic.
6. Await the `result` event. `SUCCESS` + non-blank response → `completed`; `CANCELED`/`INTERRUPTED` → `aborted`; `ERROR`/`INVALID`/`WAITING`/`RUNNING`/missing → `error` with a safe category.
7. Dispose: close stdin, terminate the managed range, wait for whole-tree exit.

### Why stream-json over stdin, not `agy -p "<task>"`

`-p` puts the task on the command line (ARG_MAX limits, shell quoting, and no incremental events). The documented `--input-format stream-json` mode carries the prompt on stdin, emits `init`/`step_update`/`result` events, and closes a session cleanly when stdin ends — the same "product protocol over pipes" shape the Codex provider uses. `--disable-slash-commands` keeps a task whose text begins with a CLI slash command from being interpreted as one.

</details>

-----

<a id="model-experience"></a>
## Model Experience

**Child request.** The child receives the standalone text blocks as one turn in a fresh `agy` session. Its workspace is the selected child cwd; the Provider instance fixes any configured model, effort, agent, environment and permission posture. The CLI version and authentication come from the host `agy`.

**Token effect.** The child pays for an independent Antigravity context. Child tokens do not enter the parent's context.

**Parent scheduling and results.** Through `@deepseek-ai/dsh-tool-subagent`, the parent first receives a child id, then the selected answer or a failure notice with stop reason and safe diagnostic. Reasoning, tool traffic, stderr and diffs are not copied into the parent Session. This provider adds no parent tool schema by itself.

## Known limitations

<a id="known-limitations"></a>

- **One fresh process and one turn per run** — no continuation, resume, pooling, progress stream or product-session persistence.
- **Static instance selection** — Profile rows fix provider name, model/effort/agent and tool binding; a call cannot choose them dynamically.
- **Native auth and account state remain native** — the bundle supplies nothing for login; configuration and authentication failures surface as a safe `unknown`/`product-error` diagnostic plus Host stderr.
- **Requires `agy` on the host** — no vendored CLI and no `PATH` fallback beyond `command`; a missing executable fails the first delegation.
- **No human approval path** — `permissionMode` chooses an unattended posture; nothing creates a DSH interaction channel.
- **Automatic delegation is prompt guidance** — `autoDelegate` asks the parent model to route every new task to Antigravity, but does not hard-intercept the DSH model loop. A preset with a complete custom system prompt may replace global sections; the model may also choose not to follow the instruction.
- **Assistant payload is the final `response` only** — reasoning, tool output, usage, stderr and diffs stay outside the parent Session.
- **No optional shared capabilities** — `agentPreset`, `agentOptions`, `outputSchema` and harness depth enforcement are rejected by the shared service for this provider (it advertises none).
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work; files changed before cancellation are not restored.
- **Pinned to the documented CLI contract** — behavior follows the published headless/stream-json contract; a CLI change that alters the envelope or event names must refresh this provider.

<a id="dev-note"></a>
## Dev note

- **Local testing.** `node scripts/link-dev-deps.mjs --checkout <deepseek-harness>` symlinks the `@deepseek-ai/*` packages this bundle imports into `node_modules` for direct unit tests. `npm test` runs pure protocol tests, manifest peer checks, and fake-CLI lifecycle integration tests (`test/run.integration.test.js`) that exercise real `settleRunResult`/`subprocessRunHandle` without spawning `agy`. Separately, a clean copy with no `node_modules` was loaded through the real DSH profile resolver with `--dump-config-schema`. A manual DSH round-trip smoke used a local deterministic parent model and the real `agy` child, confirming the completion notice returns to DSH with the child's exact answer.
- **Checks.** `npm run check` runs `node --check` on every runtime module; `npm run verify:release` refuses machine-local paths and credential-shaped strings before publishing.
- **Protocol facts.** See [`docs/antigravity-cli-facts.md`](docs/antigravity-cli-facts.md) for the exact flags, event shapes and status values this package is written against.

<a id="repository-layout"></a>
## Repository layout

```
.
├── src/                          runtime sources (plain ESM, no build step)
│   ├── index.js                  plugin entry: Config, provider class, apply
│   ├── run.js                    run lifecycle and result mapping
│   ├── antigravity.js            pure protocol helpers (argv, NDJSON, status)
│   ├── status-projection.js      parent Session projection for the header status
│   └── client.js                 browser half (config form, header status action)
├── cordis.patch.yml              bundle layer: provider row + tool row
├── locale/{en,zh}.json           Plugins-page title and description
├── icon.svg                      package icon
├── docs/
│   ├── antigravity-cli-facts.md  the pinned CLI contract
│   └── verification.md           what was actually exercised
├── scripts/
│   ├── link-dev-deps.mjs         link DSH peers for local tests
│   └── verify-release.mjs        refuse secrets / machine paths before publish
├── test/                         unit, manifest, lifecycle and projection tests
└── package.json                  bundle metadata and scripts
```

<a id="license"></a>
## License

MIT — see [LICENSE](LICENSE).
