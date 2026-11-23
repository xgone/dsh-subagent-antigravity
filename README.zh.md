---
description: "一次性 Google Antigravity CLI（agy）子智能体 Provider：一个 Profile bundle，通过无头 agy 会话提供 `subagent_antigravity` 工具。"
kind: "package-bundle"
---

# dsh-subagent-antigravity

[English](README.md) | 中文

## 概述

当被委派的工作需要在父 Session 的工作区里跑一次真正的、无人值守的 **Google Antigravity CLI**（`agy`）会话时，把 `dsh-subagent-antigravity` 装进某个 Profile。每次委派都会以 `--input-format stream-json / --output-format stream-json` 模式启动一个全新的 `agy` 无头进程，发送一个自包含的文本任务，只返回最终回答或安全失败诊断。

Antigravity 的原生认证与设置始终保持权威——本 bundle 不登录、不发现模型、也不改写 `settings.json`。`permissionMode` 决定无人值守会话可以在无人确认的情况下做多少事。

本包是纯 JS 的 Profile bundle（无需构建），参考 DSH 内置的 Codex 子智能体 Provider（`packages/subagent/subagent-codex`）改写，接入同一套 seam：`ctx.subagents`（具名 provider 注册表）、`ctx.subprocess`（受管进程范围）和 `@deepseek-ai/dsh-tool-subagent`（面向模型的调度）。

## 使用本包

### 前置条件

1. **安装 Antigravity CLI。** bundle 通过 subprocess seam 解析 `agy`，不内置 CLI。用官方安装脚本安装（macOS/Linux 默认二进制为 `~/.local/bin/agy`）：

   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   agy --version
   ```

   若 `agy` 不在 DSH 进程的 PATH 上，把 `command` 配成它的绝对路径。

2. **至少登录一次。** 无头模式使用缓存凭据（操作系统钥匙串）。在无终端的非交互环境里，未认证的 run 会以认证错误退出，而不是挂起。可选：交互式 `agy` 登录一次；或配置 `GEMINI_API_KEY` 且 `modelProvider: gemini`；或使用 Google Cloud ADC（`AGY_ADC_AUTH=true`）。本 Provider 从不管理认证。

### 安装 bundle

```bash
git clone https://github.com/xgone/dsh-subagent-antigravity.git
dsh plugin --profile <name> add "$(pwd)/dsh-subagent-antigravity"
```

或在会话里用 `plugin_manager` 工具（`action: install_bundle`，`target` 为上面的绝对目录）。bundle 插入两行 Host：

- `subagent-antigravity` —— 在 `ctx.subagents` 上注册 provider 名 `antigravity`；
- `tool-subagent-antigravity` —— 把 DSH 自带的 `@deepseek-ai/dsh-tool-subagent` 绑到该 provider，把 `subagent_antigravity` 暴露为全局工具。

在发生委派之前，bundle **不会**启动任何 `agy` 进程。若安装器提示需要重启，请重启。

> 以目录链接方式安装的 bundle 使用**该检出**的依赖。真实 DSH profile 里 `@deepseek-ai/*` 来自 DSH 安装本身；若要在本地对着源码检出开发，先运行 `node scripts/link-dev-deps.mjs --checkout /path/to/deepseek-harness`。

### 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `providerName` | `antigravity` | `ctx.subagents` 上的注册名；每个挂载实例需唯一。 |
| `command` | `agy` | `agy` 可执行文件名或绝对路径，由 subprocess seam 解析。 |
| `model` | 原生设置 | 可选模型 slug，作为 `--model` 传入（见 `agy models`）。省略则继承 Antigravity 设置。 |
| `effort` | 原生设置 | 可选推理强度（`low`…`max`，依模型而定），作为 `--effort` 传入。 |
| `agent` | 原生设置 | 可选自定义 agent，作为 `--agent` 传入（见 `agy agents`）。 |
| `permissionMode` | `accept-edits` | 无人值守姿态，见下表。 |
| `env` | `{}` | 显式子进程环境，叠加在已擦除凭据的父环境之上。要给子进程用的 API key 必须在这里提供。 |
| `disposeGraceMs` | `3000` | 受管范围终止各档之间的宽限毫秒数。 |
| `autoDelegate` | `false` | 提示 DSH 父 Agent 将每条新任务交给 `subagent_antigravity`，等待完成通知后转交结果。调度和转述仍由 DSH 模型完成；这是提示策略，不是强制路由器。 |

| `permissionMode` | `agy` 参数 | 原生行为 |
|---|---|---|
| `default` | `--sandbox` | 从不自动批准；命令留在终端沙箱内。无头模式下无法响应审批的文件编辑/命令实际被拒绝。 |
| `accept-edits` | `--mode=accept-edits --sandbox` | 自动批准工作区内文件创建/编辑；命令仍在沙箱内，可能需要审批。**编码类子智能体的安全默认。** |
| `auto` | `--mode=auto --sandbox` | 自动批准编辑与沙箱内/安全命令；不可逆动作仍会询问。需要终端沙箱与个人账号；商业/企业账号不可用，此时 `agy` 回落到 `default`。 |
| `dangerously-skip-permissions` | `--dangerously-skip-permissions` | 自动批准**所有**工具调用。仅在完全信任 prompt 与工作区时选择。 |

### 选择模型

模型是 provider 行的属性，而不是单次工具调用的参数。先列出 CLI 可提供的 slug，再把该 Profile 使用的那个写进配置：

```bash
agy models                         # 每行输出 "<slug><TAB><显示名>"
```

```yaml
- id: subagent-antigravity
  name: 'dsh-subagent-antigravity'
  config:
    command: /path/to/agy
    model: gemini-4-neon-high      # 原样传给 agy --model
    effort: high                   # 原样传给 agy --effort
```

`model` 与 `effort` 都可省略，省略时继承 Antigravity 原生设置。部分 slug 已自带变体与强度，只有所选模型提供可选等级时才需要单独设置 `effort`。错误的 slug 不会在本地校验：CLI 会拒绝它，本次 run 以 Provider 的安全 `product-error` 诊断结束。

该 Profile 的每次委派都使用这个模型。若要让不同任务使用不同模型，可多次挂载 bundle（`providerName`/`model` 各不相同，并各配一行工具且 `toolName` 唯一），或修改 Profile 行后重启。本 Provider 不支持逐次选择模型：DSH 通用工具的 `modelSelection` 选择的是 DSH LLM 路由，与 Antigravity slug 属于不同命名空间。

### 暴露工具

bundle 把 `tool-subagent-antigravity` 作为 Host 行插入，`subagent_antigravity` 对每个 preset 都是全局工具；同名 preset 工具会遮蔽它。在 Web 的 **Plugins → Installed plugins → dsh-subagent-antigravity** 中选择 `subagent-antigravity` 行并点击**配置**，即可切换**自动将新任务交给 Antigravity**；更改会立即保存到当前 Profile。开启后，DSH 父 Agent 会为每条新用户任务调用该工具，等待完成通知并转交结果；子智能体不会继承此前的对话历史。此模式通过系统提示引导模型，不会硬拦截 DSH 主模型循环。

同一页面也可以设置 **Antigravity 权限模式**。`accept-edits` 自动允许工作区文件编辑，但终端命令仍可能要求人工批准；无头子智能体无法回应审批。`auto` 会在账号支持时审核沙箱内的安全命令。`dangerously-skip-permissions` 会跳过所有审批和沙箱，仅在完全信任任务和工作区时选择。

Antigravity 子任务运行期间，当前 Session 顶部会显示 AGY 运行指示和数量；DSH 记录子任务完成通知后指示消失。首版显示生命周期状态，不显示 CLI 的逐步进度。

若不想选中 bundle 层，可在 `cordis.patch.yml` 插入同样的行：

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

### 得到什么

完成通知包含选中的 `agy` 回答，或停止原因与可选的安全诊断。产品侧推理、工具活动、原始 stderr 与工作区 diff 不会进入父 Session；父日志保留外部任务身份与终态结果。被取消的 run 结算为 `aborted`。

### 失败与恢复

`agy` 找不到、非交互环境未认证、平台或模型不支持——本次 run 以安全诊断 `Product subagent failure (product: Antigravity; stage: …; category: …)` 失败，产品自身消息保留在 Host stderr。没有宿主回落，也不托管登录。

## 实现要点

- **每次 run 一个全新进程、一个回合**：以 stream-json 启动 `agy`，发一个 `user` 事件，读一个 `result` 事件，然后关闭 stdin。不做续聊、resume、池化或产品会话持久化。
- **原生配置权威**：认证、`settings.json`、模型目录、工作区信任都保持原生；本 Provider 只覆盖可选的 `--model`/`--effort`/`--agent` 与 `permissionMode` 参数。
- **终态 `result` 事件是唯一权威**：仅当 `status === "SUCCESS"` 且 `response` 非空才算 `completed`；其余状态映射为 `aborted` 或 `error`。
- **为什么用 stdin 的 stream-json 而非 `agy -p "<task>"`**：`-p` 把任务放在命令行（受 ARG_MAX、shell 引号限制，且无增量事件）；`--input-format stream-json` 走 stdin、发 `init`/`step_update`/`result` 事件、stdin 关闭即优雅结束——与 Codex Provider 的“管道上的产品协议”同构。固定加 `--disable-slash-commands`，避免任务文本以 CLI 斜杠命令开头时被当成命令执行。

源文件：[`src/index.js`](src/index.js)、[`src/run.js`](src/run.js)、[`src/antigravity.js`](src/antigravity.js)、[`src/status-projection.js`](src/status-projection.js)、[`src/client.js`](src/client.js)、[`cordis.patch.yml`](cordis.patch.yml)。协议事实见 [`docs/antigravity-cli-facts.md`](docs/antigravity-cli-facts.md)。

## 已知限制

- 每次 run 一个全新进程、一个回合，无续聊/进度流/会话持久化。
- 静态实例选择：Profile 行固定 provider 名、model/effort/agent 与工具绑定，调用时不可动态选择。
- 认证与账号状态保持原生；失败以安全诊断 + Host stderr 呈现。
- 需要宿主上有 `agy`；除 `command` 外无 PATH 回落，缺失时首次委派即失败。
- 无人工审批通道；`permissionMode` 只决定无人值守姿态。
- `autoDelegate` 属于提示策略：它要求父模型把每条新任务交给 Antigravity，但不硬拦截 DSH 模型循环；自定义完整系统提示可能覆盖全局提示，模型也可能不遵循该要求。
- 助手载荷仅最终 `response`；推理、工具输出、usage、stderr、diff 不进入父 Session。
- 不支持可选共享能力（`agentPreset`/`agentOptions`/`outputSchema`/深度限制），本 Provider 声明为不支持。
- 无墙钟超时、无副作用回滚。
- 绑定已发布的无头/stream-json 契约；CLI 若改动信封或事件名需同步刷新本 Provider。

## 开发说明

- 本地测试：`node scripts/link-dev-deps.mjs --checkout <deepseek-harness>` 把本 bundle 导入的 `@deepseek-ai/*` 包软链到 `node_modules`，然后 `npm test` 跑协议单测、manifest peer 检查和假 CLI 生命周期集成测试（`test/run.integration.test.js`），后者用真实 `settleRunResult`/`subprocessRunHandle` 但不真正启动 `agy`。另用干净副本（没有 `node_modules`）通过 DSH Profile resolver 的 `--dump-config-schema` 检查了加载。在 DSH 端到端 smoke 中，父模型由本地固定回复服务模拟、子任务由真实 `agy` 执行；DSH 收到了包含子智能体精确答案的完成通知。
- 检查：`npm run check` 对每个运行时模块跑 `node --check`；`npm run verify:release` 在发布前拒绝机器本地路径与凭据形态的字符串。

## 模型体验

**子请求。** 子进程在全新的 `agy` 会话里收到一回合独立文本；工作区是选定的子工作目录，Provider 实例固定配置中的模型、强度、agent、环境与权限姿态。CLI 版本与认证来自宿主 `agy`。

**Token 影响。** 子智能体消耗独立的 Antigravity 上下文，子 token 不进入父上下文。

**父侧调度与结果。** 通过 `@deepseek-ai/dsh-tool-subagent`，父会话先收到子 id，随后收到选定回答或带停止原因的安全失败通知。推理、工具流量、stderr 与 diff 不会复制进父 Session；本 Provider 不额外向父模型添加工具 schema。

## 仓库结构

```
.
├── src/               运行时源码（纯 ESM，无构建步骤）
├── cordis.patch.yml   bundle 层：provider 行 + tool 行
├── locale/            Plugins 页标题与描述（英文/中文）
├── docs/              CLI 契约事实与验证记录
├── scripts/           本地依赖链接与发布前检查
├── test/              协议、manifest、生命周期与投影测试
└── package.json       bundle 元数据与脚本
```

## 许可

MIT，见 [LICENSE](LICENSE)。
