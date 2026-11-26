# Verification record

This file records what was actually exercised for this provider. It is written
for maintainers: identities, workspace paths and account details are redacted,
because the published record is engineering evidence, not a session transcript.

## Protocol and lifecycle checks

- `npm run check` parses every runtime module with `node --check`.
- `npm test`: 39 tests passed. Coverage includes Agy quota parsing, remaining/reset normalization, cache coalescing and cancellation, optional Connection route registration, the pure protocol helpers (argv construction, stdin event encoding, NDJSON framing, status classification and safe diagnostics), provider lifecycle, Agent-scoped subagent-tool restrictions, manifest peers, and Session status projection.
- `npm run verify:release` refuses machine-local paths and credential-shaped
  strings in every publishable file.

## Failure that motivated the streaming fallback

- One delegated review accepted by the provider ended with a terminal `result`
  whose `status` was `SUCCESS` but whose `response` was blank. The provider
  correctly refused to report success and the parent received a safe
  `invalid-result` diagnostic instead of an answer.
- Cause: the review ended after the assistant text had already streamed in
  `step_update` deltas, so the terminal envelope carried no final response.
- Fix: `NdjsonEventFeed.agentText` retains the last completed `agent_response`
  text, and the provider forwards it as partial error output when the terminal
  `response` is blank. The run is still reported as `invalid-result`; an
  incomplete result is never promoted to `completed`.
- The unattended permission posture used by that deployment could not answer
  approval prompts. `permissionMode` now exposes the posture in the Plugins
  form so an operator can choose a sandbox-safe or fully permissive mode
  deliberately; the default is now `default`.

## Regression: automatic delegation was only advisory

- Reported symptom: with automatic delegation on, the parent model still chose
  DSH's built-in `subagent` tool, so work went to a local child instead of Agy.
- Cause: the switch only added a system-prompt section. Tool declarations are
  provider-owned, so prompt guidance could not remove the built-in tools.
- Fix: while the switch is on, the plugin applies an Agent-scoped
  `tools.restrict({ deny })` for `subagent` and `subagent_fork`, re-applies it
  to Agents created later and to tools registered later, and disposes every
  restriction when the switch turns off or the plugin unloads. A `tools.guard`
  backstop blocks an in-flight call, or a same-named scope-local shadow that the
  inherited-tool mask cannot hide.
- Live check: with the switch on, the parent request's tool list contained
  `subagent_antigravity` and no `subagent`/`subagent_fork`; the Agy child ran,
  the header indicator appeared, and the completion notice relayed the result.
  With the switch off, `npm test` asserts both built-in names are visible again.

## End-to-end round trip

- A clean DSH Profile was created in an isolated harness home containing only
  the base bundle, the web app bundle, and this bundle.
- A Session was started through the Web app and a delegation was triggered.
- The real `agy` CLI ran a read-only shell command, exited `0`, and returned
  the workspace path plus an explicit completion marker.
- During the run the Session header showed the Antigravity running indicator
  and child count; after the completion notice, the indicator cleared and the
  parent turns relayed the child result.
- The parent model in that round trip was a deterministic local stub, so the
  test isolates provider behavior from model quality. The child process and
  the Session/status path were real.

## Agy quota indicator

- Live Slot inspection confirmed `conversation.composer.dock` is a session-scoped
  list below the composer card with no replacement risk. The existing `activity`
  and `usage` entries occupy orders 0 and 1; the plugin adds an independent Agy
  entry at order 2. `shell.bottom` is a single replacement slot and is not used.
- The Host queries the local CLI with
  `agy --print /usage --output-format json --print-timeout 30s`, reads
  `remaining_fraction` and `reset_time`, caches the result for 60 seconds, and
  serves it through the owner-authenticated Connection route
  `/api/xgone/agy-quota`. The browser reads the document-relative route and does
  not call Google APIs directly. The dock reading shows remaining percentages
  only; per-group details, reset times and the last refresh are in the hover
  title.
- Automated checks passed: 39 tests, `npm run check`, and
  `npm run verify:release`. Plugin Manager returned `restart-required` after the
  package was linked from its local directory. A live Slot query now shows the
  `xgone-antigravity-quota` entry at order 2, but the browser page is at the
  login screen and the Host quota response has not been exercised in this
  runtime. Restart DSH and authenticate before claiming a rendered/data-path
  verification.

## What this record does not claim

- It does not benchmark Antigravity model quality or compare models.
- It does not cover Windows hosts; the shipped path support is documented from
  the CLI's own installer layout.