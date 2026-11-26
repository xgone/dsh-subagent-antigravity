# Verification record

This file records what was actually exercised for this provider. It is written
for maintainers: identities, workspace paths and account details are redacted,
because the published record is engineering evidence, not a session transcript.

## Protocol and lifecycle checks

- `npm run check` parses every runtime module with `node --check`.
- `npm test`: 62 tests passed. Coverage includes Agy quota parsing and cancellation, the pure stream-json mapping (argv, turn encoder, tool kind/title/output, disjoint token accounting, finish reasons), the child-session state machine against a fake CLI (lazy `init`, tool ACTIVE→DONE, persisted conversation resume, interrupted-turn fail-closed, cancellation), the LLM adapter chunk contract, the `agy_progress` proxy, continuable provider wiring, Agent-scoped subagent-tool restrictions, manifest peers, and Session status projection.
- `node scripts/probe-stream-session.mjs "<task>"` drives one real `agy 1.5.18` turn through session → adapter → progress tool. Observed: a `tool-calls` finish for `printf stream-ok`, the proxy returning the real command output, then streamed text and `finish {kind:'stop'}` with usage.
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

## End-to-end round trip (stream-json child Session)

- An isolated Profile (`agy-stream-test`) was created from the shipped web
  template and contained only the base bundle, the web app bundle and this
  bundle. It shares the operator's DSH home, so it reuses the real model
  credentials; it has no remote-auth bundle.
- A Session was started through the Web app and the model was asked to delegate
  one task with `subagent_antigravity`.
- Result: the parent received a child id, then the completion notice; the
  parent relayed the child's answer (`dsh-ok`) and did not run the command
  itself. The child appeared in the header tree as `1 个子智能体` → a
  continuable child ("可继续") with 14.6K child tokens.
- The child Session log shows the exact bridge: step 1 is an assistant
  `agy_progress` tool-call (`callId s2`, title `printf dsh-ok`, kind `execute`,
  `rawInput {CommandLine:"printf dsh-ok"}`); its tool result is the CLI's real
  tool output (`Created At … Command output:\ndsh-ok`); step 2 is the assistant
  text `dsh-ok` with mapped usage; `turn/end` is `completed`.
- Opened from the header tree, the child transcript renders the task prompt and
  the streamed answer; the DSH step summary reads `1 轮 2 步`.

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
  only; clicking or tapping the pill opens a narrow panel with the next reset
  time and one progress bar per quota bucket (window names follow the active
  locale), plus the last refresh. The pill shares the host dock’s transparent
  resting background and its secondary font scale. The pill uses a flex
  `order` above the shipped dock entries so it renders to the right of the
  hard-coded ContextMeter at the row end. The click panel anchors its bottom
  edge above the pill (translateY(-100%)) with a space-derived max height, so a
  taller rendered panel cannot overlap the dock.
- Automated checks passed: `npm test`, `npm run check`, and
  `npm run verify:release`. Plugin Manager returned `restart-required` after the
  package was linked from its local directory. A live Slot query now shows the
  `xgone-antigravity-quota` entry at order 2, but the browser page is at the
  login screen and the Host quota response has not been exercised in this
  runtime. Restart DSH and authenticate before claiming a rendered/data-path
  verification.

## Child-session progress rows in the web UI

- First observation: the child transcript rendered each Antigravity step as a
  bare `工具调用 · agy_progress · s2` row. Cause: the web client classifies tool
  names against its own built-in map (`classifyTool` → `TOOL_VARIANTS`) and has
  no use for Host-side `presentCall`; an unknown name falls back to the generic
  row, so command and output were invisible.
- Fix: the plugin registers a keyed client tool view
  (`tool.call.toolview`, key `agy_progress`) that renders the command, its state
  (`preparing`/`running`/`done`/`failed`) and the CLI's real output in an
  expandable block (auto-expanded on failure).
- Verified in the isolated profile: expanding `已完成 → 已调用工具` now shows
  `▸ printf UI-CARD-OK  done  show output`, and expanding shows the CLI's own
  `Created At … Command output: UI-CARD-OK`.
- Remainder: DSH still groups a finished turn and its tool calls into two
  collapse levels; the row itself is now informative but the transcript needs
  those expansions.
- Second pass added the row's native-like detail: kind glyph, duration, exit
  code, an openable workspace path (via the tool view's `openFile`), and the raw
  arguments in the expanded body. Verified in the isolated profile with a
  `run_command` row (`$ printf ROW2  done  1.6s  exit 0`) and a `read_file` row
  (path + `. /antigravity-subagent/cordis.patch.yml` link).
- Continuation verified end to end: after the child settled, a new message in
  the child session answered `ROW2` from the earlier turn — the CLI process had
  already exited, so this exercised the `--conversation` resume path. The child's
  Trajectory tab showed both turns and all four steps.

## Quota probe must never open a login window

- Reported: with `agy` signed out, the composer quota probe repeatedly opened
  the Google OAuth page, because `agy --print /usage` starts an interactive
  login (`open <accounts.google.com…>`) when it has no credentials, and the
  browser requested the route on a one-minute interval.
- Reproduced with a scrubbed `HOME` and a stubbed `open`: the CLI invoked the
  opener and then printed `Authentication required` to stderr (JSON stdout:
  `status: ERROR`, `error: authentication failed or timed out`, exit 1).
- No CLI knob disables it: `AGY_CLI_NONINTERACTIVE_HEADLESS`, `CI`, `BROWSER`,
  and unknown `--settings` keys either still opened the browser or were
  rejected.
- Fix, three parts: (1) the probe process gets a private PATH whose
  `open`/`xdg-open`/`sensible-browser`/`x-www-browser` shims exit immediately,
  so a desktop window can never appear; (2) stderr is polled at 200 ms so the
  stable `auth` state is reported and the process torn down immediately; (3)
  an `auth` result is cached for ten minutes and the pill says the user must
  sign in from a terminal.
- Verified with a real CLI and a scrubbed home: `reason: auth` in 210 ms,
  **zero opener invocations**.

## What this record does not claim

- It does not benchmark Antigravity model quality or compare models.
- It does not cover Windows hosts; the shipped path support is documented from
  the CLI's own installer layout.