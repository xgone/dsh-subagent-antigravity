# Verification record

This file records what was actually exercised for this provider. It is written
for maintainers: identities, workspace paths and account details are redacted,
because the published record is engineering evidence, not a session transcript.

## Protocol and lifecycle checks

- `npm run check` parses every runtime module with `node --check`.
- `npm test` covers the pure protocol helpers (argv construction, stdin event
  encoding, NDJSON framing including split UTF-8 and chunk boundaries, status
  classification, safe diagnostics), the provider lifecycle against a fake
  managed-process handle, the manifest peer set, and the Session status
  projection.
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
  deliberately; the default remains `accept-edits`.

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

## What this record does not claim

- It does not benchmark Antigravity model quality or compare models.
- It does not cover Windows hosts; the shipped path support is documented from
  the CLI's own installer layout.