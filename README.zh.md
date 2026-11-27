# Antigravity 子智能体（DeepSeek Harness）

<p align="center">
  <a href="https://www.npmjs.com/package/@xgone/dsh-subagent-antigravity"><img src="https://img.shields.io/npm/v/%40xgone%2Fdsh-subagent-antigravity?logo=npm&label=npm" alt="npm 版本" /></a>
  <a href="https://www.npmjs.com/package/@xgone/dsh-subagent-antigravity"><img src="https://img.shields.io/npm/dm/%40xgone%2Fdsh-subagent-antigravity?logo=npm&label=下载量" alt="npm 月下载量" /></a>
  <a href="https://github.com/xgone/dsh-subagent-antigravity/actions/workflows/ci.yml"><img src="https://github.com/xgone/dsh-subagent-antigravity/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI 状态" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/xgone/dsh-subagent-antigravity?label=license" alt="MIT 许可" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <strong>中文</strong></p>

<p align="center">
  <img src="assets/banner.svg" alt="Antigravity 子任务委派主题横幅" width="100%" />
</p>

<p align="center"><strong>把任务交给 Antigravity，让主 DSH 对话保持清爽。</strong></p>

给你的 DSH 智能体多一双手：它可以把一个自包含的任务交给 **Google Antigravity CLI**（`agy`），由后者在你的工作区里、在一个**真正的 DSH 子会话**中执行——你可以打开这个子会话，实时看它思考、打字、跑工具——然后把答案回报给父会话。你始终和 DSH 对话，具体干活的是 Antigravity。

常见场景：一次较长的代码审查或资料调研、不希望弄乱主对话的任务，或者你希望隔离在独立工作目录里跑的工作。

Antigravity 的登录与设置完全由它自己管理。本插件不保存任何凭据、不代你登录，也不修改你的 Antigravity 配置。

## Agy 账号额度

打开 DSH 对话后，输入框下方会显示简短的 Agy 额度读数——取最紧的额度窗口，例如 `Agy·99%`。点击可查看各窗口进度条、下次重置时间和上次刷新时间。读数来自本机 CLI 自己的 `/usage` 命令（本插件不直接调用 Google API），带缓存，切换会话不会重新查询。

## 工作原理与账号风险

本插件是 **对官方 `agy` CLI 的薄封装**：DSH 负责子会话与调度，模型请求、工具执行和登录全部留在你已安装并已登录的 Antigravity CLI 内部。插件不逆向协议、不保存凭据，也不直接请求 Google API。

> **账号风险提示。** 用脚本或自动化方式驱动厂商 CLI，仍然受 Antigravity / Google 服务条款约束。使用本插件在原理上可能导致限流、功能限制，甚至**账号被停用**。请自行承担风险：保持正常的使用量级、考虑使用独立账号，如果无法接受该风险请停止使用。

## 安装

**1. 安装 Antigravity CLI**（已安装可跳过）：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy --version
```

**2. 先登录一次**，让无头子进程能复用缓存凭据：

```bash
agy
```

**3. 把 npm 包加到某个 DSH Profile：**

```bash
dsh plugin --profile <你的 Profile> add @xgone/dsh-subagent-antigravity
```

也可以从本地源码检出安装：

```bash
git clone https://github.com/xgone/dsh-subagent-antigravity.git
dsh plugin --profile <你的 Profile> add "$(pwd)/dsh-subagent-antigravity"
```

安装器提示需要重启时重启 DSH。对话输入框出现时，额度条会启动一次简短的本机 `agy --print /usage` 查询；只有真正委派任务时，才会启动完整的 Antigravity 子任务。

## 配置

打开 **Plugins → Installed plugins → Antigravity 子智能体**，点击**配置**，所有部署配置项都能在这里改，不需要手写 YAML：

- **自动将新任务交给 Antigravity** —— 开启后，DSH 会隐藏内置本地子智能体工具，并提示模型把每条新任务交给 Antigravity，再转交结果。主模型仍可直接回答或使用其他工具。
- **Antigravity 权限模式** —— 无人值守会话在不询问你的情况下能做多少事。默认 `default` 使用沙箱且不会自动批准；需要自动允许工作区文件编辑时可选 `accept-edits`。`dangerously-skip-permissions` 会跳过全部审批与沙箱，只在完全信任的任务和目录里使用。
- **高级设置** —— `agy` 可执行文件、模型标识、推理强度、自定义 agent、环境变量（可增删行）以及两级退出宽限。

保存写的是 Profile 里同一个配置行（与 `cordis.patch.yml` 等价），并对**之后启动**的 Antigravity 子会话生效：不会重启插件，也不会打断正在运行的委派。Profile YAML 仍可用于自动化；provider 名称与 bundle 的工具行绑定，表单里只做只读展示。

| 配置项 | 作用 | 默认 |
|---|---|---|
| `command` | `agy` 可执行文件位置 | 从 `PATH` 找 `agy` |
| `model` | 该 Profile 所有任务使用的 Antigravity 模型 | 沿用 Antigravity 自身设置 |
| `effort` | 推理强度（模型支持等级时） | 沿用 Antigravity 自身设置 |
| `agent` | Antigravity 自定义 agent 名称 | 沿用 Antigravity 自身设置 |
| `permissionMode` | `default` / `accept-edits` / `auto` / `dangerously-skip-permissions` | `default` |
| `autoDelegate` | 自动把每条新任务交给 Antigravity | `false` |
| `env` | 给子进程的额外环境变量 | `{}` |
| `disposeEofGraceMs` | stdin EOF 后等待 CLI 刷新的宽限（毫秒） | `6000` |
| `disposeGraceMs` | 进程终止分级之间的宽限（毫秒） | `3000` |

### 换用其它模型

先运行 `agy models` 查看你账号可用的模型标识，再把其中一个写进 `model`：

```bash
agy models
```

```yaml
model: claude-sonnet-5-5-high
```

模型对整个 Profile 的所有委派生效。DSH 通用的「模型选择」选的是 DSH 自己的模型，不是 Antigravity 的模型标识。单个 Profile 只支持一个本插件实例；换模型直接修改配置项，保存即生效、无需重启。

## 使用

- **自动模式**：开启后发普通消息即可；当前 Agent 看不到 DSH 内置的 `subagent` / `subagent_fork` 工具，主模型会被提示调用 `subagent_antigravity` 并转交结果。主模型仍可直接回答或使用其他工具。
- **手动模式**：要求智能体对某个任务使用 `subagent_antigravity`。
- **运行期间**：会话顶部的「N 个子智能体」就是状态入口（插件不再单独加运行徽标）；子会话本身是实时流式的——助手文本逐字出现，Antigravity 的每一次工具调用都会变成一张带真实输出的卡片——你还可以用 `send_message` 继续和这个子会话对话，延续同一个 Antigravity 会话。

## 常见问题

**发任务后没有反应？**
确认插件已在 Plugins 中启用，并且终端里 `agy --version` 可用。若 `agy` 不在 DSH 的 `PATH` 上，用 `command` 配置绝对路径。

**提示 “Product subagent failure … agy not found”？**
DSH 找不到 CLI。装好它，或把 `command` 指向可执行文件。

**提示认证失败？**
先在交互式终端里运行一次 `agy` 完成登录。没有终端的机器上，可改用 `GEMINI_API_KEY`（配合 `modelProvider: gemini`）或 Google Cloud ADC（`AGY_ADC_AUTH=true`）。

**任务开始了，但命令被拒绝？**
这是权限模式限制。可提高到 `auto`；仅在完全信任的工作里才用 `dangerously-skip-permissions`。

**模型名被拒绝？**
标识必须与 `agy models` 完全一致。写错会在运行时以安全错误失败，而不是被悄悄替换。

**在哪里看过程？**
在子会话里：打开会话顶部的「N 个子智能体」，点开正在运行的那个子会话。它的对话会实时打字输出；展开子会话里的「已调用工具」可以看到每一步的命令、状态、耗时、退出码、可点击打开的文件路径和真实输出（都是 agy 实际执行的）；子会话的「轨迹」页同样有完整的轮次/步骤视图。父对话仍然只收到最终答案或一条清晰的失败说明。

**之后能继续同一个 Antigravity 会话吗？**
可以。再给子会话发一条消息（或让父会话发），插件会复用同一个 `agy` 会话——子会话打开期间 CLI 进程常驻，重启后用 `--conversation` 恢复。取消一轮会结束 CLI 进程，下一条消息会恢复该会话。

**会保存我的 API key 吗？**
不会。它复用 Antigravity 自己的认证。你主动传给子进程的凭据只通过你自己 Profile 文件里的 `env` 配置。


## 更多

- [实现说明](docs/implementation.md) —— 工作原理与设计取舍。
- [Antigravity CLI 事实](docs/antigravity-cli-facts.md) —— 本插件依据的 CLI 契约。
- [验证记录](docs/verification.md) —— 实际验证过的内容。
- [更新记录](CHANGELOG.md) —— 每个版本的用户可见变化。

## 许可

MIT，见 [LICENSE](LICENSE)。
