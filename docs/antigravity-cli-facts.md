# Antigravity CLI facts this provider is pinned to

This file records the exact published CLI contract `@xgone/dsh-subagent-antigravity`
is written against, so a future CLI change can be diffed deliberately. Sources
are the official Google Antigravity documentation.

## Executable and installation

- Binary name: `agy`.
- macOS/Linux installer: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
  → default binary `~/.local/bin/agy`.
- Windows installers place `agy` under `%LOCALAPPDATA%\agy\bin`.
- Source: <https://antigravity.google/docs/getting-started> (Antigravity CLI section).

## Headless print mode

- `-p`, `--print`, `--prompt` — run a single prompt non-interactively.
- `--output-format` = `text` (default) | `json` | `stream-json`.
- `--input-format` = `text` (default) | `stream-json`.
- `--print-timeout 0s` — no time limit by default.
- `--disable-slash-commands` — disable slash/skill expansion in print mode.
- Source: <https://antigravity.google/docs/cli/headless>.

## Account quota

- The quota indicator runs `agy --print /usage --output-format json --print-timeout 30s` through the local DSH subprocess service.
- Structured output uses `command.name: "usage"`, `command.data.groups[]`, and bucket fields `remaining_fraction` and `reset_time`.
- DSH caches the result for 60 seconds and serves it through the authenticated `/api/xgone/agy-quota` Connection route. The browser reads this same-origin route; it does not execute the CLI or call a Google API directly.
- Source: the Agy CLI usage command and the observed `agy --print /usage --output-format json` response.

## stream-json over stdin (what this provider uses)

Spawn with `--input-format stream-json --output-format stream-json`, then write
one JSON object per line to stdin:

```json
{ "event": "user", "message": { "content": [{ "type": "text", "text": "…" }] } }
```

`content` accepts a string or a list of `text` blocks; any other block type ends
the session with an error. Output is NDJSON events:

| `event` | payload | emitted |
|---|---|---|
| `init` | `init` | once at stream start |
| `step_update` | `step_update` | per step transition / text delta |
| `result` | `result` | once at the end (same shape as `json`) |

Closing stdin ends the session gracefully; a written prompt followed by a close
still yields the final `result` first. `--input-format stream-json` **requires**
`--output-format stream-json`, and prompts must go over stdin (a `-p` flag is
dropped in this mode).

### `result` envelope

```json
{
  "conversation_id": "…",
  "status": "SUCCESS",
  "response": "…",
  "error": "…",            // only on failure
  "duration_seconds": 1.2,
  "num_turns": 1,
  "structured_output": {}, // only with --json-schema
  "usage": { "total_tokens": 123 }
}
```

### Terminal `status` values

| Status | Meaning | Provider stop reason |
|---|---|---|
| `SUCCESS` | completed and produced a response | `completed` (if `response` non-blank, else `error`/`invalid-result`) |
| `ERROR` | ended with an error | `error` / `product-error` |
| `CANCELED` | cancelled | `aborted` |
| `INTERRUPTED` | interrupted (e.g. SIGINT) | `aborted` |
| `INVALID` | reached an invalid state | `error` / `invalid-result` |
| `WAITING` | ended while waiting on input | `error` / `unknown` |
| `RUNNING` | did not reach a terminal state | `error` / `unknown` |

A successful run exits `0`; a run that fails to produce a response exits
non-zero and writes the reason to stderr. In `json`/`stream-json` mode the
failure also appears in `status` and `error`. Source: same headless page.

## Flags this provider may pass

| Flag | Used as |
|---|---|
| `--mode` | execution mode: `accept-edits`, `auto`, or `plan` |
| `--sandbox` | run commands under the terminal sandbox |
| `--dangerously-skip-permissions` | auto-approve all tool permission requests |
| `--model` | model slug (from `agy models`) |
| `--effort` | reasoning effort: `low`/`medium`/`high`/`xhigh`/`max` |
| `--agent` | custom agent (from `agy agents`) |
| `--disable-slash-commands` | always passed: a task whose text starts with `/model`, `/plan`, … must not be handled as a CLI slash command (which would ERROR and end the session) |

Execution modes and their approval behavior (and the `auto`-unavailable
fallback to `default` on business/enterprise accounts) are documented at
<https://antigravity.google/docs/cli/modes>. There is **no** `--permission-mode`
flag; use `--mode` for execution overrides.

## Authentication (native, never managed here)

- Cached credentials in the OS keyring after an interactive `agy` sign-in.
- `GEMINI_API_KEY` **plus** `modelProvider: "gemini"` in
  `~/.gemini/antigravity-cli/settings.json`.
- Google Cloud ADC via `AGY_ADC_AUTH=true` (with optional
  `GOOGLE_CLOUD_QUOTA_PROJECT`, `GOOGLE_CLOUD_LOCATION`).
- In a non-interactive environment with no terminal, an unauthenticated run
  exits with an authentication error instead of hanging.

Source: <https://antigravity.google/docs/install?tab=cli>.

> Antigravity is a third-party product. Its docs are the authority; this file
> only records the subset the provider depends on. There is no stable,
> versioned wire schema beyond the headless documentation above, so treat a CLI
> upgrade as a compatibility event and re-run the tests.
