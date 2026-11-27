# 更新记录（Changelog）

用户指南见 [README](README.md)；实现细节见 [docs/implementation.md](docs/implementation.md)；已实测的内容见 [docs/verification.md](docs/verification.md)。版本号遵循语义化版本，每条只记录对使用者可见的变化。

## 0.2.2（未发布）

- **「插件 → 已安装插件 → Antigravity 子智能体 → 配置」现在能改全部配置项**，不必再手写 `cordis.patch.yml`：`command`（agy 可执行文件）、`model`、`effort`、`agent`、`env`（键值行可增删）、`disposeEofGraceMs`、`disposeGraceMs`，与原有的「自动委派」开关和权限模式并列。
- 这些字段在 Config 中改为 `volatile`：保存写入的是 Profile 里同一配置行，并在**下一次**启动 Antigravity 子会话时生效——不重启插件，也不打断正在运行的委派。额度探测和子进程启动都在使用点读取实时值。
- 清空即恢复默认：清空可执行文件、模型、agent 或宽限值会移除对应键，回到 schema 默认（`agy`、6000、3000）。
- `providerName` 与 bundle 的工具行绑定，表单中只做只读展示；确需修改时仍编辑 Profile YAML。
- 新增测试：子进程启动时解析实时 volatile 值、额度读者接受 getter 形式的命令/环境。`npm test` 63 项。

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