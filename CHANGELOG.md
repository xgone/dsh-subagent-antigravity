# 更新记录（Changelog）

用户指南见 [README](README.md)；实现细节见 [docs/implementation.md](docs/implementation.md)；已实测的内容见 [docs/verification.md](docs/verification.md)。版本号遵循语义化版本，每条只记录对使用者可见的变化。

## 0.2.3 (2026-11-27)

- 文档：README 的「Agy 账号额度」压缩为简述，并新增「工作原理与账号风险」一节，明确本插件是对官方 `agy` CLI 的薄封装，同时提示自动化驱动 CLI 可能带来的限流/封号风险。仅文档变更，无代码改动。

## 0.2.2 (2026-11-27)

- **「插件 → 已安装插件 → Antigravity 子智能体 → 配置」现在能改全部配置项**，不必再手写 `cordis.patch.yml`：`command`（agy 可执行文件）、`model`、`effort`、`agent`、`env`（键值行可增删）、`disposeEofGraceMs`、`disposeGraceMs`，与原有的「自动委派」开关和权限模式并列。
- 这些字段在 Config 中改为 `volatile`：保存写入的是 Profile 里同一配置行，并在**下一次**启动 Antigravity 子会话时生效——不重启插件，也不打断正在运行的委派。额度探测和子进程启动都在使用点读取实时值。
- 清空即恢复默认：清空可执行文件、模型、agent 或宽限值会移除对应键，回到 schema 默认（`agy`、6000、3000）。
- `providerName` 与 bundle 的工具行绑定，表单中只做只读展示；确需修改时仍编辑 Profile YAML。
- 新增测试：子进程启动时解析实时 volatile 值、额度读者接受 getter 形式的命令/环境。`npm test` 63 项。
- **按 agy 代码评审修复状态机缺陷**（详见 [docs/code-review-2026-11-27.md](docs/code-review-2026-11-27.md)）：
  - 取消/中断后可恢复：`cancelPrompt()/dispose()` 在进程退出后复位持久化的 `promptInFlight`；`open()` 允许以 `--conversation` 重开，仅对重放被中断的那条消息 fail-closed。修复前取消一次即永久锁死子会话。
  - 工具步之后 `result` 先到时不再误判「already completed」：`promptEndConsumed` 只由真正消费 `prompt-end` 的一方置真。
  - `waitForToolCall()` 中止时先等待进程静默再 reject，取消不会再被当成成功。
  - 空闲/异常退出的 `agy` 进程不再被复用；非 `stop` 结束会释放进程，下一轮按 `--conversation` 重启。
  - 工具失败态现在会投影到 UI（`presentationMeta.status`），失败行自动展开；仅命令类工具解析退出码。
  - 额度探测超时走 `stale` 降级与失败退避缓存，不再因组合信号短路。
  - 中文词典补齐 9 个缺失键；保存失败提示改用 `saveFailed`；新增 en/zh 键集合一致性测试。
  - 空白 `SUCCESS` 响应映射为 error（`AGY_INVALID`），符合既有 `invalid-result` 契约。
  - 宽限值增加 schema/表单上限与使用点钳位；`link-dev-deps` 补 `dsh-llm`、`dsh-storage-domain`。
  - 文档改为「单 Profile 单实例；换模型改配置项即可」。
- **额度读取的耐久缓存与低频轮询**：成功快照写入新的 `xgone_antigravity_quota` 存储域；Host 重启后先返回上次读数（标记 stale / 「缓存数据」）并同时后台探测，客户端 15 秒后补一次读取拿到新值。前端轮询从 60 秒改为 **5 分钟**，且**只在页面可见时**轮询（切走/最小化停止，回到页面立即刷新）。
- `npm test` 84 项。

## 0.2.1 (2026-11-27)

- **委派改为真正的 DSH 子智能体**：DSH 创建子 Agent 与子 Session，插件的 `LlmAdapter` 用 `agy` 原生 stream-json 协议驱动一个常驻 CLI 进程。不使用 ACP，也不引入 ACP SDK 依赖。每个原生工具步骤都会在子会话里成为持久的 `agy_progress` 进度行。
- 子会话工具行信息补齐：命令/目标、类型图标、状态、耗时、退出码、可点击打开的文件路径、原始参数和真实输出。由于 Web 客户端只按自己的内置工具名分类，插件注册了 keyed `tool.call.toolview` 来渲染这一行。
- 子会话可续聊：空闲后可继续对话；CLI 进程已退出时用 `--conversation` 恢复同一个会话（已实测跨进程续聊能记住上一轮上下文）。
- 取消一轮会结束 CLI 进程（会话可恢复，未完成的轮次不保留）；无交互式审批通道；agy 不输出推理文本。
- **移除插件自己的顶部「正在运行」徽标**：委派现在拥有真子会话，会话头部的「N 个子智能体」就是状态入口。
- **窄屏额度条收成单值**：视口小于 480px 时显示 `Agy·99%`（取最紧的额度窗口），完整读数保留在 `aria-label`、悬停标题和展开面板里。
- **额度探测不再弹出登录页**：未登录时 `agy --print /usage` 会自行拉起浏览器走 OAuth。现在探测进程带浏览器启动器空壳、200ms 内识别未登录并结束进程、未登录结果缓存 10 分钟，额度条提示「需在终端登录 agy」。
- 版本 `0.2.0 → 0.2.1`，通过 GitHub OIDC Trusted Publishing 发布到 npm（带 provenance）。

## 0.2.0 (2026-11-26)

- 新增 Agy 账号额度指示：输入框下方显示剩余比例，点击展开面板（下次重置时间、各额度窗口进度条、上次刷新时间）。Host 通过本机 CLI 读取 `/usage` 并缓存 60 秒，浏览器只访问同源路由 `/api/xgone/agy-quota`，不直接请求 Google API。
- 新增 npm 发布工作流 `publish.yml`：由 GitHub Release 或手动 dispatch 触发，使用 `id-token: write` 与 `npm publish --provenance`，不再需要长期 token。
- 版本 `0.1.0 → 0.2.0`。

## 0.1.0

- 首个版本：`agy` 一次性委派提供方，包含权限模式与自动委派开关。