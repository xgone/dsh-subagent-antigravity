---
description: "Let your DSH agent hand a single task to the Google Antigravity CLI (agy) and get the result back."
kind: "package-bundle"
---

# Antigravity Subagent for DeepSeek Harness

English | [中文](README.zh.md)

Give your DSH agent a second pair of hands: it can hand one self-contained task to the **Google Antigravity CLI** (`agy`), which runs it in its own fresh session inside your workspace and reports the final answer back. You keep talking to DSH; Antigravity does the work.

Typical uses: a long review or research pass, a task that should not clutter your main conversation, or a job you want isolated in its own working directory.

Antigravity keeps its own login and settings. This plugin never stores credentials, never logs in, and never changes your Antigravity configuration.

## Install

**1. Install the Antigravity CLI** (once, if you have not already):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy --version
```

**2. Sign in once** in a normal terminal, so the headless child can reuse the cached credential:

```bash
agy
```

**3. Add this bundle to a DSH Profile:**

```bash
git clone https://github.com/xgone/dsh-subagent-antigravity.git
dsh plugin --profile <your-profile> add "$(pwd)/dsh-subagent-antigravity"
```

Restart DSH if the installer asks you to. No `agy` process starts until you actually delegate a task.

## Configure

Open **Plugins → Installed plugins → Antigravity 子智能体** and click **Configure**. Two things are editable there:

- **Automatically delegate new tasks to Antigravity** — when on, DSH hides its built-in subagent tools and asks the model to send each new task to Antigravity, then relays the answer. The model may still answer directly or use other tools.
- **Antigravity permission mode** — how much the unattended session may do without asking you. The default `default` mode keeps command execution sandboxed and does not auto-approve actions. Choose `accept-edits` when workspace edits should be automatic; `dangerously-skip-permissions` runs everything without approvals or sandboxing and should only be used for workspaces you fully trust.

Everything else is set per Profile in `cordis.patch.yml`:

```yaml
- id: subagent-antigravity
  name: 'dsh-subagent-antigravity'
  config:
    command: /path/to/agy        # only needed if agy is not on PATH
    model: gemini-4-neon-high    # optional, see below
    effort: high                 # optional
```

| Setting | What it does | Default |
|---|---|---|
| `command` | Where the `agy` executable lives | `agy` from `PATH` |
| `model` | Antigravity model for every task from this Profile | Antigravity's own setting |
| `effort` | Reasoning effort, if the model supports levels | Antigravity's own setting |
| `permissionMode` | `default` / `accept-edits` / `auto` / `dangerously-skip-permissions` | `default` |
| `autoDelegate` | Send every new task to Antigravity automatically | `false` |
| `env` | Extra environment for the child process | `{}` |

### Use a different model

Run `agy models` to see the slugs your account can use, then put one in `model`:

```bash
agy models
```

```yaml
model: claude-sonnet-5-5-high
```

The model applies to every delegation from that Profile. DSH's generic "model selection" option is for DSH's own models, not for Antigravity slugs. If you need different tasks on different models, install the bundle twice under different provider names (each with its own row and tool name), or change the row and restart.

## Using it

- **Automatic:** with automatic delegation on, send a normal message — the local DSH subagent tools are hidden for that Agent, and the model is asked to call `subagent_antigravity` and relay its result. The model can still answer directly or use other tools.
- **Manual:** ask your agent to use `subagent_antigravity` for a specific task.
- **While it runs:** the Session header shows a running indicator and the number of active tasks. It disappears when the task finishes, and the result arrives as a normal reply in the conversation.

## FAQ

**Nothing happens when I send a task.**
Check that the bundle is enabled in Plugins and that `agy --version` works in a terminal. If `agy` is not on DSH's `PATH`, set `command` to the absolute path.

**I get a "Product subagent failure … agy not found" message.**
DSH could not find the CLI. Install it, or point `command` at the binary.

**I get an authentication error.**
Run `agy` once in an interactive terminal to sign in. On machines without a terminal you can instead provide `GEMINI_API_KEY` (with `modelProvider: gemini`) or use Google Cloud ADC (`AGY_ADC_AUTH=true`).

**The task starts but commands are refused.**
That is the permission mode. Raise it to `auto`, or to `dangerously-skip-permissions` for trusted work only.

**My model name is rejected.**
Slugs must match `agy models` exactly. A wrong slug fails at run time with a safe error rather than being silently replaced.

**I only got the final answer, not the step-by-step work.**
That is intentional: the child's reasoning, tool calls and terminal output stay in Antigravity and never enter your DSH conversation. You get the answer, or a clear failure message.

**Can I continue the same Antigravity session later?**
No. Each delegation is one fresh, one-shot `agy` run.

**Does this store my API keys?**
No. It reuses Antigravity's own authentication. Any credential you deliberately pass to the child goes through the `env` setting in your own Profile file.

**Why does the header indicator sometimes not appear?**
It only shows while a task is actually running. If a task is very short, you may miss it; the result still arrives in the conversation.

## More

- [Implementation notes](docs/implementation.md) — how it works, and why.
- [Antigravity CLI facts](docs/antigravity-cli-facts.md) — the exact CLI contract this is built against.
- [Verification record](docs/verification.md) — what has actually been tested.

## License

MIT — see [LICENSE](LICENSE).
