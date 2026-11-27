# 代码评审记录：antigravity-subagent 0.2.2 之前

- **日期**：2026-11-27
- **评审者**：本插件自己的 `agy` 子智能体会话（Antigravity CLI 1.5.18，模型 Gemini 4 Neon High；子会话 id `58f75fea-64c7-4fbc-b6c1-b180ffaef6a2`）
- **方式**：只读评审。指令明确禁止修改/移动/删除文件、禁止 git 操作、禁止联网。先读 `docs/implementation.md`、`docs/antigravity-cli-facts.md`、`docs/verification.md`、`CHANGELOG.md`，再逐文件阅读 `src/*`、`test/*`、`cordis.patch.yml`、`package.json`、`scripts/*`，并对照 `node_modules/@deepseek-ai/*` 的类型契约。
- **范围**：`feature/agy-stream-json-session` 分支（提交 `ead6b32`）的源码，不含 DSH 本体。

## 维护者复核结论（本文件由维护者整理）

对报告逐条按源码复核后的状态：

| 编号 | 结论 | 说明 |
|---|---|---|
| P0-1 `promptEndConsumed` 过早置真 | **确认** | `handleResult()` 里多写了一行 `this.promptEndConsumed = true`（移植 ACP 分支时引入）；工具步后 `result` 先到会让下一次 `stream()` 直接抛「already completed」，丢掉最终回复。 |
| P0-2 取消后 `promptInFlight` 永不清除 | **确认** | 只有成功 `result` 才复位；`cancelPrompt()/dispose()` 从不复位，`open()` 又对 `promptInFlight: true` 一律 fail-closed，于是取消一次就永久锁死该子会话，与文档承诺的「取消后可用 `--conversation` 恢复」矛盾。 |
| P1-3 `waitForToolCall` 中止竞态 | **确认** | `onAbort` 先 `void cancelPrompt()`（同步走到 `failPendingTools` 并 resolve），随后才 `reject`；`Promise.race` 被已 resolve 的分支胜出，取消被当成成功。 |
| P1-4 空闲退出进程被复用 | **确认** | `ensureSession()` 只看 `disposed`，不看进程是否已退出；`prompt-end` 分支无条件 `keepSession = true`，非 `stop` 结束也不释放进程。 |
| P1-5 工具失败态显示为 done | **确认** | `presentationMeta` 未投影 `status`，客户端只看 `block.isError`（`agy_progress` 正常返回，`isError` 恒为 false）。 |
| P1-6 额度超时短路 | **确认** | `.then()` 的 `if (signal.aborted)` 用了含 `timeoutSignal` 的组合信号，超时也命中，导致既不保 `stale` 也不写退避缓存。 |
| P1-7 i18n 缺键/错键 | **确认** | 中文词典缺 9 个键（`quotaSignIn`、5 个 `toolState*`、`toolExpand/toolCollapse`、`toolArguments/toolExitCode`），且 `setFeedback('failed')` 引用不存在的键（应为 `saveFailed`）。 |
| P1-8 空白 SUCCESS 被放行 | **确认** | `streamFinishReason('SUCCESS')` 恒为 `stop`，与文档写的 `invalid-result` 契约不一致。 |
| P1-9 多实例文档与实现冲突 | **确认（按文档修）** | 路由/域/工具名/行 id 均为单例；同一 Profile 挂第二个实例必崩。决定修正文档为「单实例，换模型改配置项即可」，不做多实例化。 |
| P2-12 宽限值缺运行时上限 | **确认** | 表单只校验正整数，schema 无 `max`，使用点未钳位。 |
| P2-18 `link-dev-deps` 缺两个包 | **确认** | 缺 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-storage-domain`，干净检出跑 `npm test` 会失败。 |
| 其余 P2/P3 | 代码结构上成立，未逐条复现 | 主要是防御性加固与清理项。 |

## 评审报告原文

以下是针对 [antigravity-subagent](file://<operator-home>) 的只读代码评审报告（基于当前源码、`docs/*`、`CHANGELOG.md`、`test/*` 及 `node_modules/@deepseek-ai/*` 类型契约核对）。

---

## P0 崩溃 / 数据损坏

### 1. `handleResult` 过早将 `promptEndConsumed` 置为 `true`，导致工具步后正常轮次崩溃并丢弃最终回复
- **位置**：[src/session.js:394-414](src/session.js#L394-L414)、[src/adapter.js:150-154](src/adapter.js#L150-L154)、[src/adapter.js:193-194](src/adapter.js#L193-L194)
- **问题描述**：`handleResult()` 在收到 CLI 的 `result` 事件并向 `this.events` 入队 `prompt-end` 时，同步把 `this.promptActive = false` **以及 `this.promptEndConsumed = true`**（[src/session.js:400-401](src/session.js#L400-L401)），使 `markPromptEndConsumed()` 完全失去意义。
- **触发条件**：一个轮次包含至少一次原生工具调用；`adapter.stream()` 在产出 `agy_progress` 工具调用与 `finish { kind: 'tool-calls' }` 后返回；在 DSH 执行 `agy_progress` 并再次进入 `adapter.stream()` 之前，CLI 已发出 `result`（常见于：`default` 权限模式下工具被拒绝后立即发 `tool ERROR` + `result ERROR`、快速连续多工具调用、或模型短回复快于 DSH 日志写入）。此时下一次 `adapter.stream()` 命中 `!state.promptActive && state.lastPromptMessageId === prompt.id && state.promptEndConsumed`，直接抛出 `Antigravity CLI has already completed or failed this child task`，丢弃队列中尚未消费的助手文本/结果并触发 `finally` 杀掉健康的 CLI 进程。
- **建议修法**：删除 [src/session.js:401](src/session.js#L401) 的 `this.promptEndConsumed = true`，只保留 `adapter.stream()` 真正消费到 `prompt-end` 时调用 `state.markPromptEndConsumed()`（[src/adapter.js:194](src/adapter.js#L194)）。同时在 `test/adapter.test.js` 中补写真实 `StreamJsonChildSession` + `AntigravityStreamLlmAdapter` 的联调用例。

### 2. `cancelPrompt()` / `dispose()` 从未清理持久化的 `promptInFlight: true`，导致任意一次取消或失败后子会话永久锁死
- **位置**：[src/session.js:209-212](src/session.js#L209-L212)、[src/session.js:462](src/session.js#L462)、[src/session.js:529-563](src/session.js#L529-L563)、[src/adapter.js:221](src/adapter.js#L221)
- **问题描述**：`startPrompt()` 会在写入 stdin 前把 `{ promptInFlight: true, lastDshMessageId }` 写入 `sessionDomain`。当用户取消轮次（或轮次因 `process-exit` / `error` 中断）时，`cancelPrompt()` 调用 `disposeOwnedProcess()`：它先置 `this.disposed = true`（丢弃后续可能到来的 `result`），随后终止进程，但**从未将持久化记录里的 `promptInFlight` 复位**。下一次给该子会话发**全新消息**时，`ensureSession()` 重建 `StreamJsonChildSession` 并调用 `open()`，在 [src/session.js:210](src/session.js#L210) 无条件抛出 `cannot safely replay a child turn interrupted before completion`。该子会话即使跨 Host 重启也永远无法再恢复。
- **触发条件**：任意子会话在轮次执行期间被取消（`AbortSignal`）、消费者提前退出迭代器、或 CLI 进程异常退出；随后用户或父 Agent 向该子会话发送下一条消息。与 [docs/implementation.md:42](docs/implementation.md#L42)、[docs/implementation.md:78](docs/implementation.md#L78)、[README.md:121](README.md#L121) 及 [CHANGELOG.md:18](CHANGELOG.md#L18) 承诺的「取消结束 CLI 进程，下一条消息用 `--conversation` 恢复会话」直接冲突。
- **建议修法**：
  1. 在 `cancelPrompt()` 确认子进程彻底退出后（`disposeOwnedProcess()` 结束 `done` 之后），将 `promptInFlight` 显式更新为 `false`（同时保留 `lastDshMessageId` 以继续阻止重放被取消的同一条消息）。
  2. 区分「崩溃后重放同一 `lastDshMessageId`（应 fail-closed）」与「发来一条全新 `message.id` 续聊（进程已死且已有 `conversationId` 时允许 `--conversation` 恢复）」：不要在 `open()` 中一刀切永久拒绝新消息，可将防重放检查与 `prompt.id === previous.lastDshMessageId` 关联。

---

## P1 功能错误

### 3. `waitForToolCall` 等待期间中止时因 `Promise.race` 顺序错误返回成功，且未等待进程退出静默
- **位置**：[src/session.js:503-523](src/session.js#L503-L523)、[src/session.js:545](src/session.js#L545)
- **问题描述**：`waitForToolCall(callId, signal)` 在 `onAbort` 中先执行 `void this.cancelPrompt()`（[src/session.js:515](src/session.js#L515)），再执行 `reject(abortError(signal))`（[src/session.js:516](src/session.js#L516)）。然而 `cancelPrompt()` → `dispose()` → `disposeOwnedProcess()` 在遇到第一个 `await` 之前会**同步**执行 `this.failPendingTools(...)` → `call.result.resolve(call)`。于是 `call.result.promise` 先于 `aborted` 落地且在 `Promise.race([call.result.promise, aborted])` 中排第一位，`waitForToolCall` 会**resolve 返回一个 `failed` 对象而不是抛出中止异常**。此外 `void this.cancelPrompt()` 未被 `await`，违反了 DSH `ToolDefinition.execute` 的静默契约（`dsh-tools` 要求在拥有资源静默后才 settle）。
- **触发条件**：`agy_progress` 正在等待一个运行中的原生工具步骤时，调用方取消 `exec.signal`。`agy_progress.execute()` 会正常返回（`isError: false`），使 DSH 循环误以为工具成功完成并继续调用下一轮 `adapter.stream()`，同时后台 CLI 进程仍在长达 6s+3s 的终止宽限中。
- **建议修法**：不用 `Promise.race` 与 `void cancelPrompt()`；在 `onAbort` 中先标记已中止、`await this.cancelPrompt().catch(() => {})` 等待进程退出静默，然后 reject `abortError(signal)`；且 `call.result.promise` 的 `.then()` 分支需判断 `if (!aborted)` 才 resolve，避免被 `failPendingTools()` 抢跑。

### 4. CLI 进程在空闲期或非 `stop` 结束后退出时，`ensureSession` 复用已死亡进程导致下一轮必败
- **位置**：[src/session.js:255-263](src/session.js#L255-L263)、[src/adapter.js:207](src/adapter.js#L207)、[src/adapter.js:232-246](src/adapter.js#L232-L246)
- **问题描述**：`ensureSession()` 仅凭 `!existing.disposed` 判断会话是否可复用（[src/adapter.js:235](src/adapter.js#L235)）。当 CLI 进程在轮次之间（空闲时）因超时、OOM、外部信号退出，或在 `ERROR`/`CANCELED`/`INVALID` 之后退出（注意 [src/adapter.js:207](src/adapter.js#L207) 在 `finish.kind !== 'stop'` 时仍然设 `keepSession = true`！）时，`process.done` 仅向 `this.events` 推入 `{ kind: 'process-exit' }`，但 `this.disposed` 仍是 `false`。
- **触发条件**：子 Agent 保持常驻，期间底层 `agy` 进程退出（或上一轮返回 `ERROR` 后进程自行退出）；用户发送下一条消息。`ensureSession()` 返回已死实例，`startPrompt()` 写入 `promptInFlight: true` 并往已死管道写入，`adapter.stream()` 立刻消费到旧的 `process-exit` 事件而报错，并连带触发 P0 #2 锁死会话。
- **建议修法**：
  1. 在 `StreamJsonChildSession` 维护 `this.exited = false`，`process.done` 落地时置 `this.exited = true`（空闲退出时无需塞入毒丸 `process-exit`）；`ensureSession()` 在 `existing.disposed || existing.exited` 时自动清理旧实例并以 `--conversation` 重启。
  2. 在 [src/adapter.js:207](src/adapter.js#L207) 改为 `keepSession = event.finish.kind === 'stop'`，使 `ERROR`/`INVALID`/`WAITING`/`RUNNING`/`CANCELED` 结束后主动释放进程。

### 5. 原生工具执行失败时，Web UI 永远将其渲染为 `done` 且不会自动展开错误输出
- **位置**：[src/progress-tool.js:49-72](src/progress-tool.js#L49-L72)、[src/client.js:871-877](src/client.js#L871-L877)、[src/client.js:906](src/client.js#L906)
- **问题描述**：当 `agy` 原生工具步骤进入 `state: 'ERROR'`（如权限拒绝或工具报错）时，`session.js` 将 `call.status` 设为 `'failed'`，但 `agy_progress.execute()` 仍正常返回对象而不抛错，因此 DSH 记录的 `tool/result` 中 `isError` 为 `false`。同时 `presentationMeta()` 只投影了 `kind`/`exitCode`/`durationSeconds`，没有投影 `status`。浏览器端 `AgyProgressRow` 仅通过 `block && block.isError ? 'failed' : 'done'` 判定失败态，导致原生工具失败在界面上全部显示为 `done` 且不自动展开。
- **触发条件**：Antigravity CLI 中任意工具调用返回 `state: 'ERROR'`（例如 `default` 模式下被拒绝执行的命令）。与 [docs/verification.md:107-108](docs/verification.md#L107-L108) 描述的失败态与自动展开行为不符。
- **建议修法**：在 `progress-tool.js` 的 `presentationMeta(args, value)` 中透出 `status: value.status`（或 `failed: value.status === 'failed'`），并在 `client.js` 中判定 `const failed = Boolean(block?.isError) || meta?.status === 'failed'`。

### 6. `agy-quota.js` 查询超时时被 `if (signal.aborted)` 短路，丢失 `stale` 降级与失败缓存退避
- **位置**：[src/agy-quota.js:184-187](src/agy-quota.js#L184-L187)、[src/agy-quota.js:238](src/agy-quota.js#L238)、[src/agy-quota.js:253-266](src/agy-quota.js#L253-L266)
- **问题描述**：`beginQuery()` 用 `AbortSignal.any([lifetime.signal, controller.signal, timeoutSignal])` 构造组合信号 `signal`。当 `timeoutMs`（35s）超时触发时，`runAgyQuotaQuery` 的 `catch` 分支捕获到 `timeoutSignal.aborted === true` 并返回 `unavailable('timeout', now)`；但紧接着 `.then()` 第一行执行 `if (signal.aborted) return snapshot`（[src/agy-quota.js:254](src/agy-quota.js#L254)）——此时因 `timeoutSignal` 已中止，`signal.aborted` 恒为 `true`！结果既不会保留 `lastGood` 作为 `stale` 返回，也不会写入 `cached`/`cacheUntil`（`FAILURE_REFRESH_MS` 退避失效）。
- **触发条件**：本机 `agy --print /usage` 卡死或网络慢超过 35s。原本正常的额度条会被直接清空成不可用，且多个标签页/下一次轮询无退避地连续拉起新的超时子进程。
- **建议修法**：将 [src/agy-quota.js:254](src/agy-quota.js#L254) 改为 `if (lifetime.signal.aborted || controller.signal.aborted) return snapshot`，仅在读者取消或 reader 卸载时跳过缓存更新，超时则走正常的 `stale` + `failureRefreshMs` 分支。

### 7. `client.js` 保存失败使用了错误的 i18n 键 `'failed'`，且中文词典缺失 9 个键
- **位置**：[src/client.js:23](src/client.js#L23)、[src/client.js:28-36](src/client.js#L28-L36)、[src/client.js:84-145](src/client.js#L84-L145)、[src/client.js:228](src/client.js#L228)、[src/client.js:236](src/client.js#L236)、[src/client.js:503-510](src/client.js#L503-L510)
- **问题描述**：
  1. `AutoDelegateConfig` 在保存被拒绝或异常时调用 `setFeedback('failed')`，渲染层直接执行 `t(feedback)` 即 `t('failed')`；但中英文词典中定义的键名都是 **`saveFailed`**，根本没有 `'failed'` 键，导致两种语言下保存失败都会显示裸键名或回退异常。
  2. `dictionaries.zh` 缺失 9 个英文词典中已有的键：`quotaSignIn`（与 [CHANGELOG.md:21](CHANGELOG.md#L21) 声称的「需在终端登录 agy」不符）、`toolStatePreparing`、`toolStateRunning`、`toolStateDone`、`toolStateFailed`、`toolExpand`、`toolCollapse`、`toolArguments`、`toolExitCode`。
- **触发条件**：配置页保存失败时（全语言）；中文界面下 `agy` 未登录或展开子会话 `agy_progress` 工具行时。
- **建议修法**：将 `setFeedback('failed')` 及对应条件判断统一改为 `'saveFailed'`；补齐 `dictionaries.zh` 中缺失的 9 个键；并在 `test/manifest.test.js` 中增加中英文词典键集合相等性断言。

### 8. 空白 `SUCCESS` 响应被静默放行为正常结束，违背文档化的 `invalid-result` 契约
- **位置**：[src/stream-json.js:264-267](src/stream-json.js#L264-L267)、[src/adapter.js:193-209](src/adapter.js#L193-L209)
- **问题描述**：[docs/antigravity-cli-facts.md:126](docs/antigravity-cli-facts.md#L126) 和 [docs/verification.md:15-26](docs/verification.md#L15-L26) 明确约定：当 `result.status === 'SUCCESS'` 但 `response` 为空白且没有最终助手文本时，绝不能提升为成功，必须报告错误（`invalid-result`）。但当前 `streamFinishReason('SUCCESS')` 无条件返回 `{ kind: 'stop' }`，`adapter.js:197-208` 在既未流式输出文本、`event.response` 又为空白时，直接产出 0 个 content block + `{ type: 'finish', reason: { kind: 'stop' } }`。
- **触发条件**：CLI 返回 `{ event: 'result', result: { status: 'SUCCESS', response: '' } }` 且本步未产生非空 `text_delta`。
- **建议修法**：跟踪当前轮次（跨工具步的整个 turn）是否产出了非空助手文本；若 `event.status === 'SUCCESS'` 且整轮无非空文本且 `event.response.trim() === ''`，将 `finish` 映射为 `{ kind: 'error', failure: { message: 'Antigravity CLI completed without producing a response', code: 'AGY_INVALID' } }`（或在确认新协议允许空尾步时同步更新文档契约）。

### 9. 文档宣称支持按不同 `providerName` 挂载多实例，但四处全局标识硬编码导致第二实例启动必崩
- **位置**：[src/index.js:48](src/index.js#L48)、[src/index.js:205-214](src/index.js#L205-L214)、[src/stream-json.js:21](src/stream-json.js#L21)、[src/stream-json.js:27](src/stream-json.js#L27)、[src/session-domain.js:18](src/session-domain.js#L18)、[README.md:92](README.md#L92)、[README.zh.md:92](README.zh.md#L92)
- **问题描述**：README 明确指导用户可在同一 Profile 下以不同 `providerName` 挂载两次本 bundle 以使用不同模型。但 `apply()` 中 `STREAM_SESSION_DOMAIN_SPEC` 域名称（`xgone_antigravity_stream_sessions`）、`STREAM_PROVIDER`（`agy-stream`）、`PROGRESS_TOOL_NAME`（`agy_progress`）、`/api/xgone/agy-quota` 路由路径、`AUTO_DELEGATE_SECTION_NAME`、`enforcement.js` 的 `AGY_TOOL_NAME` 及 `client.js` 的 `ROW_ID` 全部为硬编码单例，第二实例在 `storageDomain.open()` / `llm.registerAdapter()` / `tools.register()` 会立刻抛出 `already-open` / `DUPLICATE_ADAPTER` / 重复工具错误。
- **触发条件**：按 README 文档在同一 Profile 中配置第二个不同 `providerName` 的插件实例。
- **建议修法**：要么将上述文档修正为「单 Profile 仅支持单实例（换模型直接修改配置项，无需重启）」；要么真正按 `providerName` 派生路由/域/工具名并共享单一份全局 quota 路由与 `agy_progress` 代理。

---

## P2 隐患 / 竞态

### 10. `handleResult` 未等待 `persistRecord({ promptInFlight: false })` 落盘即推送 `prompt-end`，存在重开竞态与异步错误毒化下一轮
- **位置**：[src/session.js:284-291](src/session.js#L284-L291)、[src/session.js:303-310](src/session.js#L303-L310)、[src/session.js:408-422](src/session.js#L408-L422)
- **问题描述**：
  1. 根据 `@deepseek-ai/dsh-storage-domain` 契约，`table.put()` 先等待后端持久化再更新内存快照。`handleResult()` 先同步向 `this.events` 推入 `prompt-end`，再 fire-and-forget 调用 `persistRecord({ promptInFlight: false })`（甚至 [test/session.test.js:156](test/session.test.js#L156) 和 `:350` 都被迫插入 `setImmediate` 才能读到 `false`）。若 `adapter.stream()` 刚结束就触发子 Agent 回收与冷恢复，`open()` 的同步 `table.get()` 会读到尚未刷新的 `promptInFlight: true` 而误报中断失败。
  2. 若 `handleEvent('init')` 或 `handleResult()` 的异步 `persistRecord()` 失败，`.catch()` 会在 `prompt-end` 已被消费后往 `this.events` 塞入 `{ kind: 'error' }`，留在队列中毒化**下一次**正常轮次。
  3. `persistRecord()` 使用非原子的 `table.get()` + `table.put()`，在有未落盘写操作排队时读到的仍是旧内存快照（虽然当前 `conversationId` 会从实例属性回填，但若未来增加字段极易覆盖丢更新）。
- **触发条件**：后端存储写入有毫秒级延迟时，轮次结束后立即释放并重开子会话；或磁盘写入偶尔失败。
- **建议修法**：记录一个单调串行的 `persistPromise` 链（或仅在已有记录时使用 `table.update()`），并在 `adapter.stream()` 收到 `prompt-end` 产出 `finish` 之前 `await state.flushPersistence()`（同时在 `disposeOwnedProcess()` 中等待其完成），把持久化错误归属到当前轮次而不是事后塞入队列。

### 11. `ensureSession` 无并发去重、重复注册 `agent.ctx.effect`，且不支持并行/steer 期间的队列隔离
- **位置**：[src/adapter.js:150-158](src/adapter.js#L150-L158)、[src/adapter.js:232-247](src/adapter.js#L232-L247)
- **问题描述**：
  1. `ensureSession()` 在 `await state.open(signal)`（至少 100ms）期间未占位，若同一 `sessionId` 并发调用两次 `stream()`，会启动两个 `agy` 进程，后者覆盖 `this.sessions` 导致前者永久孤立泄漏。
  2. 同一 `agent` 每次重开 CLI 进程时，[src/adapter.js:245](src/adapter.js#L245) 都会向 `agent.ctx` 重复注册新的 `effect` 而不清理旧 `effect`。
  3. 若在子会话某轮工具步间隙通过 `delivery: 'steer'` 注入新消息 `msg-2`：若上一轮 `promptActive` 仍为 `true`，`msg-2` 会被静默忽略；若上一轮刚好 `promptActive === false` 但 `prompt-end` 仍在队列中未消费，`adapter.js:150` 会直接写入 `msg-2` 并把上一轮未消费的 `prompt-end` 错当成 `msg-2` 的回复返回。
- **触发条件**：同一 `sessionId` 并发 `stream()`；同一常驻 Agent 多次重启 CLI；子会话工具执行期间被 `sendMessage`/`prompt(steer)` 插入新消息。
- **建议修法**：为 `ensureSession` 增加 `openingSessions: Map<string, Promise<...>>` 防并发重入，并用 `WeakSet` 记录已绑定 `agent.ctx.effect` 的 Agent；在 `adapter.stream()` 层面限制同一 `sessionId` 同时只允许一个活跃消费者，且在存在未消费 `prompt-end`（`!state.promptEndConsumed`）时先排空旧轮次或明确拒绝并发新 prompt。

### 12. `disposeGraceMs` / `disposeEofGraceMs` 变为 `volatile` 后缺少运行时边界校验，过大或非法值会绕过启动检查
- **位置**：[src/index.js:134-135](src/index.js#L134-L135)、[src/index.js:195-204](src/index.js#L195-L204)、[src/session.js:236](src/session.js#L236)、[src/session.js:550-553](src/session.js#L550-L553)、[src/client.js:308-312](src/client.js#L308-L312)
- **问题描述**：`apply()` 仅在插件启动时校验一次两个宽限值在 `(0, MAX_TIMER_DELAY_MS]` 内。但在 Config schema 中仅写了 `z.number().default(...).volatile()`，前端表单仅校验了 `Number.isInteger(value) && value > 0`（无上限），`session.js:236` 直接把 `volatileValue(this.config.disposeGraceMs)` 传给 `ctx.subprocess.spawn({ graceMs })`，`session.js:553` 对 `disposeEofGraceMs` 也未校验 `<= MAX_TIMER_DELAY_MS`。
- **触发条件**：用户在配置表单或 YAML 中将宽限值改为超过 `2147483647`（或通过 YAML 改为 `0`/负数），不重启插件直接发起委派。`subprocess.spawn()` 会同步抛错使所有后续委派失败，或 `AbortSignal.timeout()` 溢出回绕为 `1ms`。
- **建议修法**：在 `Config` schema 上直接约束 `.min(1).max(MAX_TIMER_DELAY_MS)`；在 `client.js` 表单校验上限 `<= 2147483647`；在 `session.js` 的 `open()` 和 `disposeOwnedProcess()` 使用点统一对两个宽限值做安全钳位/兜底。

### 13. `handleStep` 对 `step_index` 缺失、非终态状态及长期缓存处理不严谨
- **位置**：[src/session.js:341-389](src/session.js#L341-L389)
- **问题描述**：
  1. `step.step_index` 缺失或非数字时，`callId` 固定生成为 `'sunknown'`；同会话内第二个无 `step_index` 的工具会命中 `if (this.toolCalls.has(callId)) return`（[src/session.js:350](src/session.js#L350)）而被静默丢弃。
  2. [src/session.js:349](src/session.js#L349) 和 `:378` 把除 `'ACTIVE'` 之外的**一切** `state`（包括空字符串、未来可能出现的 `PENDING`/`QUEUED` 等）直接当作 `'completed'` 结算，随后真正携带 `output` 的 `DONE`/`ERROR` 会被 `if (call.result.settled) return` 丢弃。
  3. `this.toolCalls` 跨多轮从不清理：既保留每一步最多 12KB 输出与 `rawInput` 导致长会话内存单调增长，又在 CLI 任意版本若按轮次重置 `step_index` 时引发 `callId` 碰撞丢步。
- **触发条件**：CLI 事件缺少 `step_index`、新增中间态、或长驻多轮会话运行大量工具步骤。
- **建议修法**：无 `step_index` 时使用递增本地计数器生成唯一 `callId`；仅在 `state === 'DONE' || state === 'ERROR'` 时结算工具调用；结合 `turnEpoch` 区分 `callId` 或在确认 `agy_progress` 消费后清理历史已结算条目（或做 LRU/按轮次清理）。

### 14. `progress-tool.js` 对非命令工具误提取 `exitCode`，且 `rawInputText` 截断导致客户端丢失可点击文件路径
- **位置**：[src/progress-tool.js:49-63](src/progress-tool.js#L49-L63)、[src/stream-json.js:111-120](src/stream-json.js#L111-L120)、[src/stream-json.js:210-216](src/stream-json.js#L210-L216)、[src/client.js:885-890](src/client.js#L885-L890)
- **问题描述**：
  1. `parseExitCode(outputText)` 对所有工具无条件执行，而非仅限 `kind === 'execute'`。当 Antigravity 用 `read_file` 或 `grep_search` 读取包含 `"exited with code 2"` / `"exit code: 1"` 字样的源码或日志（例如本仓库的 `test/stream-json.test.js`）时，工具卡片会错误显示红色 `exit 2` 徽标。另建议 `Number.isSafeInteger` 替代 `Number.isInteger` 防止大整数溢出。
  2. `adapter.js` 经由 `safeJson(call.rawInput, 4_000)` 截断参数为不完整 JSON 字符串；`progress-tool.js` 虽然从完整的 `call.rawInput` 提取了 `path` 并放进 `value.path`，但 `presentationMeta()` 并未传出 `path`，导致 `client.js` 重新 `JSON.parse(rawInputText)` 失败而丢失文件打开按钮（例如 `write_to_file` 写入 >4KB 内容时）。
- **触发条件**：读取/搜索包含退出码文本的文件；或写文件工具参数序列化长度超过 4000 字符。
- **建议修法**：仅当 `call.kind === 'execute'`（或 `args.kind === 'execute'`）时解析 `exitCode`；将 `value.path` 纳入 `presentationMeta` 并在 `client.js` 优先读取 `meta?.path`。

### 15. `agy-quota.js` 缓存失效、未登录正则误杀、卸载静默与临时目录泄漏隐患
- **位置**：[src/agy-quota.js:22](src/agy-quota.js#L22)、[src/agy-quota.js:30-48](src/agy-quota.js#L30-L48)、[src/agy-quota.js:183-194](src/agy-quota.js#L183-L194)、[src/agy-quota.js:278-303](src/agy-quota.js#L278-L303)、[src/index.js:62-70](src/index.js#L62-L70)
- **问题描述**：
  1. **配置更新不失效缓存**：当 CLI 未登录触发 10 分钟 `auth` 缓存后，用户在配置页修改 `command` 或 `env`（如填入 `GEMINI_API_KEY` / `AGY_ADC_AUTH`），`quotaReader` 不会清缓存，界面会在长达 10 分钟内一直卡在旧状态。
  2. **正则过宽易误杀**：`AUTH_PATTERN = /authenticat|.../i` 会匹配 `"Authenticated as ..."` 等正常调试/信息日志；200ms 轮询一旦匹配就会强杀健康进程并缓存 10 分钟未登录态。
  3. **中止/卸载未等子进程退出**：`runAgyQuotaQuery` 在 `signal.aborted` 分支直接返回/抛出而未等待 `child.waitForExit()` / `child.done`，导致 `dispose()` 在子进程尚未退出时就删除了 `openerNeutralizer` 临时目录并提前返回。
  4. **临时目录部分创建泄漏**：`createOpenerNeutralizer()` 中若 `mkdtempSync` 成功而后续 `writeFileSync` 抛错，`catch` 直接 `return undefined` 未清理已创建的 `dir`。此外 Windows 平台（`win32`）未做任何启动器屏蔽，若支持 Windows 仍可能弹浏览器。
  5. **未登录时被旧 `lastGood` 掩盖**：若此前成功拉取过额度，之后账号登出，[src/agy-quota.js:261-263](src/agy-quota.js#L261-L263) 返回 `{ ...lastGood, status: 'stale', reason: 'auth' }`，但 [src/client.js:545-593](src/client.js#L545-L593) 在 `stale` 态忽略 `reason === 'auth'`，导致 10 分钟内看不到登录提示。
- **触发条件**：修改配置后立刻查看额度；CLI stderr 输出包含 `authenticated` 字样；插件热重载/卸载期间正好有探针在跑；账号登出后继续观察额度条。
- **建议修法**：在 `quotaReader` 监听 `settings/document-updated`（或按解析后的 `command`/`env` 指纹失效缓存）；收紧 `AUTH_PATTERN` 为负面语义（如 `/authentication\s+(?:required|failed|error|timed\s+out)|unauthenticated|not\s+logged\s+in|login\s+required|please\s+(?:visit|sign\s+in)/i`）；在 `signal.aborted` 分支也 `await child.waitForExit().catch(() => false)` 再抛出/返回；`createOpenerNeutralizer()` 的 `catch` 中清理 `dir`；`reason === 'auth'` 时不沿用 `lastGood` 或在前端显式展示登录提示。

### 16. `client.js` 表单状态覆盖、极端视口定位溢出与交互边界缺陷
- **位置**：[src/client.js:193-197](src/client.js#L193-L197)、[src/client.js:224-232](src/client.js#L224-L232)、[src/client.js:700-756](src/client.js#L700-L756)、[src/client.js:777](src/client.js#L777)、[src/client.js:891-893](src/client.js#L891-L893)、[src/client.js:906](src/client.js#L906)
- **问题描述**：
  1. **草稿丢失与提示闪消**：`useEffect([state?.revision])` 会同时清空 `draft`、`advancedDraft` 和 `feedback`。用户正在编辑高级设置时若点了顶部的自动委派开关或权限模式，所有未保存的高级输入瞬间被清空；而保存成功后若 Host 异步推来新 `revision`，`saved` 提示也会被该 effect 立刻清掉。
  2. **Escape 仅绑在按钮上**：[src/client.js:718](src/client.js#L718) 注释称支持 `Escape` 关闭面板，但只写在 pill 按钮的 `onKeyDown` 上（`:755`），未在打开态的 `document` 上监听 `keydown`；焦点移入 Portal 面板后按 `Escape` 无效。
  3. **空数据点击仍置 `open=true`**：`rowsLength === 0`（加载中/不可用/未登录）时点击 pill，不会渲染 `panel`（`:777`），但仍置 `open = true` 与 `aria-expanded="true"`，按钮卡在激活高亮态。
  4. **极端视口溢出**：`place()` 中 `width = Math.min(240, Math.max(200, window.innerWidth - 24))` 在宽度 `< 216px` 时强行 200px 导致右侧溢出；向下展开（`!above`）时 `maxHeight = Math.max(120, window.innerHeight - rect.bottom - 16)` 在极矮视口会超出底部可视区导致内容截断不可滚动。
  5. **失败工具行无法折叠**：[src/client.js:906](src/client.js#L906) `const expanded = open || state === 'failed'` 导致失败行点击 `hide output` 按钮毫无效果。
  6. **工作区路径前缀误判**：[src/client.js:891-892](src/client.js#L891-L892) 用 `path.startsWith(cwd)` 截断相对路径：当 `cwd` 为 `/work/app` 而 `path` 为 `/work/app-other/a.js` 时会误显示为 `.-other/a.js`；当 `cwd` 末尾自带 `/` 时会拼出 `.a.js`。
- **触发条件**：表单混合编辑；窄/矮分屏窗口；焦点在额度面板内按 Esc；无额度时点击额度条；同前缀兄弟目录文件。
- **建议修法**：拆分 `draft` 与 `advancedDraft` 的重置时机、不随 `revision` 清除刚刚产生的 `saved` 反馈；在 `open` 的 `useEffect` 中监听 `document` `keydown(Escape)`；`rowsLength === 0` 时不切换 `open`（或弹出含 `quotaUnavailableHelp` 的提示面板）；`width` 取消 200 下限钳位、向下 `maxHeight` 不强行 `>= 120`；失败行用 `const [open, setOpen] = useState(null); const expanded = open ?? (state === 'failed')`；路径前缀校验边界分隔符（`path === cwd || path.startsWith(normalizedCwd + '/')`）。

### 17. `stdout` EOF 但进程未退出时流会永久挂起，且空字符串 `message.id` 可能损坏持久域加载
- **位置**：[src/session.js:248-251](src/session.js#L248-L251)、[src/adapter.js:87](src/adapter.js#L87)、[src/session-domain.js:8](src/session-domain.js#L8)
- **问题描述**：
  1. `stdout` 的 `end`/`error` 仅调用 `this.feed?.end()`，不向 `this.events` 推入任何终止事件。若子进程或其衍生孙进程关闭了 stdout 但进程本身挂死未退出，`adapter.stream()` 会在 `state.events.next()` 永久挂起。
  2. `extractDshUserMessage()` 使用 `message.id ?? ...`，若传入 `message.id === ''` 会原样持久化；`dsh-storage-domain` 在写入时不校验 zod，但下次启动 `loadAll` 时会因违背 `z.string().min(1)` 导致整个域以 `invalid-record` 启动失败（`STREAM_SESSION_DOMAIN_SPEC` 未配置 `invalidRecords: 'backup-and-skip'`）。
- **触发条件**：异常子进程提前关闭 stdout 但未退出；或非标准调用方传入空字符串 `message.id`。
- **建议修法**：在 `onEnd` 中当 `this.promptActive && !this.disposed` 时推入 stdout-eof 错误事件（或触发 `error`）；`extractDshUserMessage` 改为 `typeof message.id === 'string' && message.id.length > 0 ? message.id : ...`；并考虑在 `STREAM_SESSION_DOMAIN_SPEC` 评估是否启用 `invalidRecords: 'backup-and-skip'` 以提高抗损坏能力。

### 18. `scripts/link-dev-deps.mjs` 缺少两个核心 peer 依赖，全新本地检出无法运行测试
- **位置**：[scripts/link-dev-deps.mjs:24-32](scripts/link-dev-deps.mjs#L24-L32)
- **问题描述**：`PACKAGES` 映射表遗漏了 `@deepseek-ai/dsh-llm`（`packages/llm/llm`）和 `@deepseek-ai/dsh-storage-domain`（`packages/storage/storage-domain`）。按 [docs/implementation.md:108](docs/implementation.md#L108) 执行 `link-dev-deps.mjs` 后直接跑 `npm test` 会因找不到这两个模块而失败。
- **触发条件**：在干净的克隆环境中首次运行 `node scripts/link-dev-deps.mjs && npm test`。
- **建议修法**：在 `PACKAGES` 中补齐 `@deepseek-ai/dsh-llm` 和 `@deepseek-ai/dsh-storage-domain`。

---

## P3 建议

### 19. 清理 v0.1.0 遗留死代码、多余 peer 声明与过时文档
- **位置**：[src/antigravity.js:65-392](src/antigravity.js#L65-L392)、[package.json:54](package.json#L54)、[src/session.js:189](src/session.js#L189)、[src/session.js:226](src/session.js#L226)、[src/index.js:9](src/index.js#L9)、[src/client.js:27](src/client.js#L27)、[src/client.js:393](src/client.js#L393)、[src/client.js:974-1018](src/client.js#L974-L1018)、[test/README.md:8](test/README.md#L8)、[README.md:105](README.md#L105)
- **问题描述**：
  - `src/antigravity.js` 中 `buildArgv`、`encodeUserEvent`、`classifyResult`、`failureDiagnostic`、`ANTIGRAVITY_EFFORTS`、`ANTIGRAVITY_TERMINAL_STATUSES` 以及 `NdjsonEventFeed.waitFor`/`agentText`/`init`/`result` 已不再被运行时引用，仅剩单元测试覆盖。
  - `package.json` 仍声明了未使用的 `@deepseek-ai/dsh-session-projection` peer；`session.js` 中的 `this.promptEpoch` 只增不读、`open()` 传给 `buildStreamArgv` 的 `command` 字段未被读取。
  - `src/index.js:9` 注释仍写 `--print` stream-json（实际未传 `--print`）；`README.md:105` / `README.zh.md:105` FAQ 仍引用已不存在的 `"Product subagent failure … agy not found"`；`test/README.md` 仍写已删除的 `run.integration.test.js` 且缺 `session`/`adapter`/`stream-json` 测试说明。
  - `client.js` 中 `providerName` 因非 volatile 在表单快照里始终为 `undefined`，会一直回退显示 `antigravity`；`AgyProgressRow` 同时在行内和下一行按钮渲染了两遍文件 `summary`；`quotaUnavailableHelp`/`quotaRemaining` 翻译键未使用。
- **建议修法**：删除无用遗留代码与冗余 peer，同步更新 README/FAQ/注释与 `test/README.md`，精简 `AgyProgressRow` 重复路径展示。

### 20. 若干小细节健壮性与隐私 hygiene 改进
- **位置**：[scripts/verify-release.mjs:25](scripts/verify-release.mjs#L25)、[src/session.js:218](src/session.js#L218)、[src/session.js:270](src/session.js#L270)、[src/session.js:474](src/session.js#L474)、[src/stream-json.js:146-148](src/stream-json.js#L146-L148)、[src/client.js:413](src/client.js#L413)、[src/client.js:570](src/client.js#L570)、[package.json:86](package.json#L86)
- **问题描述**：
  - `scripts/verify-release.mjs` 被打包进 npm 发布物（`package.json` `files` 包含 `scripts`），其第 25 行正则字面硬编码了发布者的真实用户名，建议改为通用模式或从环境变量/配置读取。
  - `session.js:218` 调用 `resolveExecutable(command, env)` 未透传第 3 参数 `signal`（`agy-quota.js:136` 已正确透传）；`open()` 的 100ms 启动定时器在进程提前退出时未 `clearTimeout`；`promptAbortListener` 中 `void this.cancelPrompt()` 建议加 `.catch(() => {})` 兜底。
  - `buildStreamArgv` 对外部来源的 `conversationId` 建议校验不以 `-` 开头且不含控制字符（纵深防御）。
  - `client.js` 中 `envRows` 使用数组 `index` 作 `key`（删除中间行会导致输入焦点错位），`QuotaBarRow` 的 `key` 在同名 bucket 时可能碰撞（建议始终拼上 `index`）；`npm run check` 可一并纳入 `scripts/probe-stream-session.mjs` 与 `scripts/link-dev-deps.mjs`。
- **建议修法**：按上述逐项小幅加固即可。

### 21. 建议优先补充的测试覆盖缺口
当前 63 项单测主要隔离测试单个模块，以下关键路径缺失覆盖（也直接导致上述 P0/P1 逃逸）：
1. **端到端状态机联测**：真实 `StreamJsonChildSession` + `AntigravityStreamLlmAdapter` + `createAgyProgressTool` 跨「工具 `ACTIVE` → 快速 `DONE` + `result` → 第二次 `adapter.stream()`」场景。
2. **取消后恢复闭环**：`startPrompt(msg-1)` → 中途 `cancelPrompt()` → 新建 session `open()` → `startPrompt(msg-2)` 验证 `--conversation` 恢复不报错。
3. **`waitForToolCall` 等待中取消**：验证 `signal` 中途触发时必须 **reject** 中止异常且等待进程静默退出。
4. **空闲进程死亡恢复**：Turn 1 完成 → 模拟子进程意外退出 → Turn 2 自动 `--conversation` 重启成功。
5. **额度探针超时与配置变更**：验证 `timeoutMs` 触发时返回 `stale` + 启用退避缓存，以及 `command`/`env` 变更后失效 `auth` 缓存。
6. **客户端词典完整性与键有效性**：解析/校验 `client.js` 中 `en`/`zh` 键完全一致，且所有 `t('...')` 与 `setFeedback(...)` 均引用已存在的键。
7. **工具失败展示与非命令输出**：验证原生工具 `ERROR` 投影到 `presentationMeta` 触发失败态，以及 `read_file` 输出含 `"exit code: 1"` 时不产出 `exitCode`。

---

## 未发现问题的关键不变量

以下不变量已逐行对照源码与 DSH 接口契约核验，确认实现正确：

1. **正常流式路径下的 DSH `StreamChunk` 顺序**：[src/adapter.js:160-210](src/adapter.js#L160-L210) 严格遵守 `block-start → deltas → block-end`，在切入 `tool-call` 块前会先闭合已开启的文本块并递增 `blockIndex`，`usage` 总在 `finish` 之前发出，`finish` 后立即 `return` 不再产出任何 chunk。
2. **Disjoint Token 核算契约**：[src/stream-json.js:240-256](src/stream-json.js#L240-L256) `toTokenUsage()` 正确从 `input_tokens` 减去 `cache_read_tokens` 并用 `Math.max(0, ...)` 防下溢，完全符合 `@deepseek-ai/dsh-llm` 的 disjoint `TokenUsage` 契约。
3. **`agy_progress` 严格只读代理语义与作用域隔离**：[src/progress-tool.js:57-73](src/progress-tool.js#L57-L73) 仅等待原生工具结果，绝不二次执行任何命令或写操作；`when: agyProgressToolActivation` 确保只有 `agy-stream` 子 Agent 可见该工具；`output.schema`（含 `additionalProperties: false`）与返回值字段完全一致。
4. **无命令注入与凭据泄露防线**：所有子进程调用（[src/session.js:222](src/session.js#L222)、[src/agy-quota.js:138](src/agy-quota.js#L138)、[scripts/probe-stream-session.mjs:42](scripts/probe-stream-session.mjs#L42)）均以 `argv` 数组直接 exec，不经 shell；`streamFinishReason()` 与 `agy-quota.js` 均采用固定安全错误枚举，不向模型或浏览器泄露路径、环境变量或原始凭据。
5. **`dispose()` 幂等与 `EPIPE` 防护**：[src/session.js:534-537](src/session.js#L534-L537) 通过 `this.disposePromise ??= ...` 保证并发/重复 `dispose` 幂等；[src/session.js:254](src/session.js#L254) 挂接了 `stdin.on('error', () => {})` 避免对端关闭管道导致 Host 进程崩溃。
6. **NDJSON 帧切分与多字节 UTF-8 安全**：[src/antigravity.js:273-305](src/antigravity.js#L273-L305) 使用 `StringDecoder('utf8')` 正确处理跨 chunk 切分的多字节 UTF-8 字符及 EOF 无换行尾行；长驻会话传入 `store: false` 避免事件历史无限增长。
7. **`AsyncEventQueue` 与 `agy-quota` 请求合并/取消清理**：[src/session.js:81-151](src/session.js#L81-L151) 在 `push`/`close`/`abort` 各路径均正确解绑 `AbortSignal` 监听；[src/agy-quota.js:278-290](src/agy-quota.js#L278-L290) 的 `readers` 引用计数准确保证单读者取消不误杀同批次其他读者、全员取消才中止子进程，且 `authPoll` 定时器在 `finally` 中必然清理。
8. **前端无 DOM XSS 风险与资源清理到位**：[src/client.js](src/client.js) 全程通过 `React.createElement` 渲染纯文本子节点，未使用 `dangerouslySetInnerHTML`/`innerHTML`；所有 `ctx.effect`（locale 与 slots）、`matchMedia` 监听、窗口 `resize`/`scroll`/`pointerdown` 及 `setInterval` 均在卸载时完整清理。
9. **自动委派强制路由（`enforcement.js`）生命周期闭环**：[src/enforcement.js:13-113](src/enforcement.js#L13-L113) 正确跟踪现有/新建/销毁 Agent 与延迟注册工具，具备 `refreshing` 防重入与异常隔离，关闭开关或卸载插件时能完整回收全部 restriction 与 guard。

---

## Top 5 风险

1. **[P0] `handleResult` 误置 `promptEndConsumed = true`**（[src/session.js:401](src/session.js#L401)）：任何包含工具调用且 `result` 快速到达的轮次（特别是权限拒绝场景）都会在第二步直接崩溃并杀进程。
2. **[P0] 取消/中断后持久化 `promptInFlight: true` 永不清除**（[src/session.js:210, 529-563](src/session.js#L210)）：子会话一旦被取消或异常中止即永久不可续聊，与产品核心卖点「可续聊 + 取消后 `--conversation` 恢复」完全相悖。
3. **[P1] `waitForToolCall` 等待期间取消时竞态返回成功且未等子进程静默**（[src/session.js:512-522](src/session.js#L512-L522)）：导致工具取消被误判为正常完成，破坏循环中止语义与资源回收时序。
4. **[P1] 空闲 `agy` 进程退出后被 `ensureSession` 误复用**（[src/adapter.js:207, 235](src/adapter.js#L207)）：长驻子会话在底层 CLI 退出或报错后，下一轮必炸并连带锁死会话。
5. **[P1] Web UI 失败态与国际化失效**（[src/progress-tool.js:49-72](src/progress-tool.js#L49-L72)、[src/client.js:84-145, 228](src/client.js#L84-L145)）：原生工具失败永远显示为 `done` 且不展开，保存失败引用不存在的 `'failed'` 键，中文界面缺失 9 个翻译键（含未登录提示和全部工具状态标签）。

---

## 是否建议合并

**结论：否（建议修复 P0 和核心 P1 后再合并 / 发布 0.2.2）**

**理由**：该插件的整体架构清晰（DSH 持有子 Session、常驻 `agy` 进程、`agy_progress` 严格只读代理、无 shell 注入、disjoint token 核算、无 DOM XSS），但状态机核心路径存在 **2 个确定性可触发的 P0 缺陷**（工具步后快返回 `result` 必崩；取消后 `promptInFlight: true` 永久锁死子会话）以及多个影响核心可用性的 **P1 缺陷**（`waitForToolCall` 中止竞态、空闲退出进程被复用、工具失败态在 UI 不可见、额度超时退避失效、中英文 i18n 缺失/错键）。上述问题改动范围集中且均有明确修法，建议在修复 P0 + P1 并补齐真实 `session + adapter + progress-tool` 联测与 i18n 键校验测试后再行合并发布。

