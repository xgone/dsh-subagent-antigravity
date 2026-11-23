# Tests

`npm test` runs the suites in this directory with the Node test runner.

| File | Covers |
|---|---|
| `antigravity.test.js` | Pure protocol helpers: argv construction, stdin event encoding, NDJSON framing (chunk boundaries, split UTF-8), status classification, safe diagnostics. |
| `run.integration.test.js` | Run lifecycle against a fake managed-process handle: startup gate, terminal result mapping, cancellation and disposal, without spawning `agy`. |
| `status-projection.test.js` | The parent Session projection that drives the header running indicator. |
| `index.test.js` | Config defaults, provider registration, capability set, live `autoDelegate` updates. |
| `manifest.test.js` | Bundle metadata: peer set, patch path and published files. |

The runtime peers (`@deepseek-ai/*`) are not installed from npm by this
repository. Point them at a local DSH checkout first:

```bash
node scripts/link-dev-deps.mjs --checkout /path/to/deepseek-harness
npm test
```

## Manual end-to-end harness

`fixtures/mock-parent-model.mjs` is a deterministic Messages-compatible parent
model for manual round-trip checks. It answers the `subagent_antigravity` tool
call once, waits for the child receipt, and echoes a completion marker when the
child result arrives, so a real `agy` child can be exercised without depending
on a live model provider:

```bash
AGY_MOCK_PORT=0 node test/fixtures/mock-parent-model.mjs   # prints its URL
```

Point a throwaway Profile's parent model at that URL with a temporary
`--patch` overlay kept outside this repository, then drive one Session. The
child process, the provider and the Session status path are real; only the
parent model is scripted.

Any local-only overlay or machine-specific configuration belongs outside the
repository (see `.gitignore`).