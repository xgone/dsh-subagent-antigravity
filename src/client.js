window.__ModuleLoader__.load({
  id: '@xgone/dsh-subagent-antigravity',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const NAMESPACE = '@xgone/dsh-subagent-antigravity-ui'
    const PACKAGE = '@xgone/dsh-subagent-antigravity'
    const LEGACY_PACKAGE = 'dsh-subagent-antigravity'
    const ROW_ID = 'subagent-antigravity'

    const dictionaries = {
      en: {
        toggle: 'Automatically delegate new tasks to Antigravity',
        help: 'When enabled, DSH hides its built-in subagent tools and asks the model to delegate each new task to Antigravity. DSH still schedules the child and relays its final result; the model may still answer directly or use other tools.',
        summaryOn: 'Automatic Antigravity delegation is on.',
        summaryOff: 'Automatic Antigravity delegation is off.',
        loading: 'Loading configuration…',
        unavailable: 'This configuration is not available in the current profile.',
        readOnly: 'This profile does not allow configuration changes.',
        saving: 'Saving…',
        saved: 'Saved.',
        saveFailed: 'Could not save this setting. Refresh the page and try again.',
        quotaLabel: 'Agy quota',
        quotaLoading: 'Loading Agy quota…',
        quotaUnavailable: 'Agy quota unavailable',
        quotaUnavailableHelp: 'Check that the Agy CLI is installed and signed in.',
        quotaSignIn: 'Sign in to agy in a terminal',
        toolStatePreparing: 'preparing',
        toolStateRunning: 'running',
        toolStateDone: 'done',
        toolStateFailed: 'failed',
        toolExpand: 'show output',
        toolCollapse: 'hide output',
        toolArguments: 'arguments',
        toolExitCode: 'exit {code}',
        quotaTitle: 'Agy account quota',
        quotaNextReset: 'Next reset {time}',
        quotaRemaining: '{window} {percent}% left',
        quotaShort: '{window} {percent}%',
        quotaMobile: 'Agy·{percent}%',
        quotaReset: 'resets {time}',
        quotaLastUpdated: 'Updated {time}',
        quotaStale: 'stale',
        quotaWindowFiveHours: '5h',
        quotaWindowWeek: 'week',
        quotaWindowMonth: 'month',
        quotaWindowOther: 'limit',
        permissionMode: 'Antigravity permission mode',
        permissionModeHelp: 'Headless runs cannot answer approval prompts. Auto mode may be unavailable for some accounts; in that case the CLI falls back to Default.',
        permissionDefault: 'Default — sandboxed; approval prompts can block commands',
        permissionAcceptEdits: 'Accept edits — workspace edits are allowed; commands may require approval',
        permissionAuto: 'Auto — sandboxed commands are automatically reviewed where supported',
        permissionDangerous: 'Dangerously skip approvals and the sandbox',
        dangerousWarning: 'This allows all Antigravity tools without prompts or sandboxing. Use only when you trust the task and workspace.',
        advancedTitle: 'Advanced settings',
        advancedHelp: 'These edit the same Profile row as cordis.patch.yml. Saving applies to the next Antigravity child; the plugin is not restarted.',
        providerNameReadonly: 'Provider name: {name} (fixed by the bundle tool row)',
        commandLabel: 'agy executable',
        commandHelp: 'Absolute path, or a name resolved through PATH.',
        modelLabel: 'Model',
        modelHelp: 'A slug from `agy models`. Leave empty to inherit Antigravity settings.',
        modelPlaceholder: 'inherit',
        effortLabel: 'Reasoning effort',
        effortDefault: 'inherit',
        effortHelp: 'Availability depends on the model.',
        agentLabel: 'Custom agent',
        agentHelp: 'A custom agent name from `agy agents`. Leave empty to inherit.',
        agentPlaceholder: 'inherit',
        envLabel: 'Environment variables',
        envHelp: 'Extra variables for the agy process, layered over the scrubbed Host environment.',
        envKey: 'Key',
        envValue: 'Value',
        envAdd: 'Add variable',
        envRemove: 'Remove',
        graceLabel: 'Shutdown grace (ms)',
        graceEof: 'after stdin EOF',
        graceTerminate: 'between termination steps',
        graceHelp: 'How long the CLI may take to flush before it is terminated.',
        advancedSave: 'Save advanced settings',
        restartNote: 'Applies to the next child session.',
        invalidGrace: 'Grace values must be positive whole milliseconds.'
      },
      zh: {
        toggle: '自动将新任务交给 Antigravity',
        help: '开启后，DSH 会提示主模型把每条新任务交给 Antigravity，并转交最终结果。DSH 仍负责调度子智能体；同时会隐藏内置的本地子智能体工具，避免任务被转给本地子智能体。主模型仍可直接回答或使用其他工具。',
        summaryOn: '自动委派已开启。',
        summaryOff: '自动委派已关闭。',
        loading: '正在加载配置…',
        unavailable: '当前 Profile 中没有可用的配置表单。',
        readOnly: '当前 Profile 不允许修改配置。',
        saving: '正在保存…',
        saved: '已保存。',
        saveFailed: '保存失败。请刷新页面后重试。',
        quotaLabel: 'Agy 额度',
        quotaLoading: '正在读取 Agy 额度…',
        quotaUnavailable: 'Agy 额度暂不可用',
        quotaUnavailableHelp: '请检查 Agy CLI 是否已安装并登录。',
        quotaSignIn: '需在终端登录 agy',
        toolStatePreparing: '准备中',
        toolStateRunning: '运行中',
        toolStateDone: '已完成',
        toolStateFailed: '失败',
        toolExpand: '展开输出',
        toolCollapse: '收起输出',
        toolArguments: '参数',
        toolExitCode: '退出码 {code}',
        quotaTitle: 'Agy 账号额度',
        quotaNextReset: '下次重置 {time}',
        quotaRemaining: '{window} 剩余 {percent}%',
        quotaShort: '{window} {percent}%',
        quotaMobile: 'Agy·{percent}%',
        quotaReset: '重置于 {time}',
        quotaLastUpdated: '更新于 {time}',
        quotaStale: '缓存数据',
        quotaWindowFiveHours: '5 小时',
        quotaWindowWeek: '周',
        quotaWindowMonth: '月',
        quotaWindowOther: '限额',
        permissionMode: 'Antigravity 权限模式',
        permissionModeHelp: '无头运行无法回应审批提示。部分账号不支持 Auto；遇到这种情况时，CLI 会回退到 Default。',
        permissionDefault: 'Default：使用沙箱；需要审批的命令可能无法执行',
        permissionAcceptEdits: 'Accept edits：允许工作区文件编辑；命令仍可能需要审批',
        permissionAuto: 'Auto：在支持的账号上自动审核沙箱命令',
        permissionDangerous: '危险模式：跳过审批与沙箱',
        dangerousWarning: '此模式会无提示、无沙箱地运行所有 Antigravity 工具。仅在完全信任任务和工作区时使用。',
        advancedTitle: '高级设置',
        advancedHelp: '这些值与 cordis.patch.yml 中同一个 Profile 行等价。保存后对之后启动的 Antigravity 子会话生效，不会重启插件。',
        providerNameReadonly: 'Provider 名称：{name}（由 bundle 的工具行固定）',
        commandLabel: 'agy 可执行文件',
        commandHelp: '绝对路径，或通过 PATH 解析的命令名。',
        modelLabel: '模型',
        modelHelp: '取自 `agy models` 的标识。留空表示沿用 Antigravity 自身设置。',
        modelPlaceholder: '沿用默认',
        effortLabel: '推理强度',
        effortDefault: '沿用默认',
        effortHelp: '可用等级取决于模型。',
        agentLabel: '自定义 agent',
        agentHelp: '取自 `agy agents` 的 agent 名称。留空表示沿用默认。',
        agentPlaceholder: '沿用默认',
        envLabel: '环境变量',
        envHelp: '额外传给 agy 进程的变量，叠加在清洗后的 Host 环境之上。',
        envKey: '名称',
        envValue: '值',
        envAdd: '添加变量',
        envRemove: '删除',
        graceLabel: '退出宽限（毫秒）',
        graceEof: 'stdin EOF 后',
        graceTerminate: '终止分级之间',
        graceHelp: 'CLI 在被强制终止前允许的最长刷新时间。',
        advancedSave: '保存高级设置',
        restartNote: '对之后启动的子会话生效。',
        invalidGrace: '宽限值必须是正整数毫秒。'
      },
    }

    const ADVANCED_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
    const MAX_TIMER_DELAY_MS = 2_147_483_647

    const advancedFieldStyle = {
      boxSizing: 'border-box',
      width: '100%',
      maxWidth: '560px',
      padding: '8px 10px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: '8px',
      backgroundColor: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
    }

    const advancedLabelStyle = {
      display: 'grid',
      gap: '6px',
      color: 'var(--dsw-alias-label-primary)',
    }

    const advancedHelpStyle = {
      margin: 0,
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '13px',
      lineHeight: 1.45,
    }

    const advancedButtonStyle = {
      padding: '7px 14px',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: '8px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
      font: 'inherit',
    }

    function AutoDelegateConfig(props) {
      const { view, form, t } = props
      const state = form?.state
      const config = state?.value ?? {}
      const [pending, setPending] = React.useState(false)
      const [draft, setDraft] = React.useState({})
      const [advancedDraft, setAdvancedDraft] = React.useState(undefined)
      const [feedback, setFeedback] = React.useState('')

      React.useEffect(() => {
        setDraft({})
        setAdvancedDraft(undefined)
        setFeedback('')
      }, [state?.revision])

      const enabled = draft.autoDelegate ?? (config.autoDelegate === true)
      const permissionMode = draft.permissionMode ?? config.permissionMode ?? 'default'
      if (view === 'summary') {
        return h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
          t(enabled ? 'summaryOn' : 'summaryOff'))
      }
      if (form === undefined || state?.status === 'unavailable') {
        return h('p', {
          role: 'status',
          style: { color: 'var(--dsw-alias-label-secondary)' },
        }, t('unavailable'))
      }
      if (state === undefined || state.status === 'loading') {
        return h('p', {
          role: 'status',
          style: { color: 'var(--dsw-alias-label-secondary)' },
        }, t('loading'))
      }

      const disabled = pending || !state.writable || state.revision === undefined
      const runMutation = (ops) => {
        setPending(true)
        setFeedback('')
        return Promise.resolve()
          .then(() => form.mutate(ops, state.revision))
          .then((accepted) => {
            if (!accepted) {
              setDraft({})
              setAdvancedDraft(undefined)
              setFeedback('saveFailed')
            } else {
              setFeedback('saved')
            }
          })
          .catch(() => {
            setDraft({})
            setAdvancedDraft(undefined)
            setFeedback('saveFailed')
          })
          .finally(() => { setPending(false) })
      }
      const saveField = (field, value) => {
        setDraft(current => ({ ...current, [field]: value }))
        return runMutation([{ op: 'set', path: [field], value }])
      }
      const onChange = (event) => {
        void saveField('autoDelegate', Boolean(event.currentTarget.checked))
      }
      const onPermissionModeChange = (event) => {
        void saveField('permissionMode', event.currentTarget.value)
      }

      // Host values remain authoritative; drafts only hold unsaved edits.
      const current = (key) => (
        advancedDraft !== undefined && Object.hasOwn(advancedDraft, key)
          ? advancedDraft[key]
          : config[key]
      )
      const setAdvancedField = (key, value) => {
        setAdvancedDraft(currentDraft => ({ ...(currentDraft ?? {}), [key]: value }))
      }
      const envRows = advancedDraft?.envRows ?? Object.entries(config.env ?? {})
        .map(([key, value]) => ({ key, value: String(value) }))
      const setEnvRows = (rows) => {
        setAdvancedDraft(currentDraft => ({ ...(currentDraft ?? {}), envRows: rows }))
      }
      const textValue = (key) => {
        const value = current(key)
        return typeof value === 'string' ? value : ''
      }
      const graceValue = (key) => {
        const value = current(key)
        return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
      }

      const saveAdvanced = () => {
        const ops = []
        const command = textValue('command').trim()
        if (command === '') {
          if (config.command !== undefined) ops.push({ op: 'unset', path: ['command'] })
        } else if (command !== config.command) {
          ops.push({ op: 'set', path: ['command'], value: command })
        }
        for (const key of ['model', 'effort', 'agent']) {
          const value = textValue(key).trim()
          if (value === '') {
            if (config[key] !== undefined) ops.push({ op: 'unset', path: [key] })
          } else if (value !== config[key]) {
            ops.push({ op: 'set', path: [key], value })
          }
        }
        const env = {}
        for (const row of envRows) {
          const key = typeof row.key === 'string' ? row.key.trim() : ''
          if (key === '') continue
          env[key] = typeof row.value === 'string' ? row.value : ''
        }
        if (JSON.stringify(env) !== JSON.stringify(config.env ?? {})) {
          ops.push(Object.keys(env).length === 0
            ? { op: 'unset', path: ['env'] }
            : { op: 'set', path: ['env'], value: env })
        }
        for (const key of ['disposeEofGraceMs', 'disposeGraceMs']) {
          const raw = current(key)
          const text = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim()
          if (text === '') {
            if (config[key] !== undefined) ops.push({ op: 'unset', path: [key] })
            continue
          }
          const value = Number(text)
          if (!Number.isInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
            setFeedback('invalidGrace')
            return
          }
          if (value !== config[key]) ops.push({ op: 'set', path: [key], value })
        }
        if (ops.length === 0) {
          setFeedback('saved')
          return
        }
        void runMutation(ops)
      }

      const textField = (key, labelKey, helpKey, placeholder) => h('label', { style: advancedLabelStyle },
        h('span', null, t(labelKey)),
        h('input', {
          type: 'text',
          value: textValue(key),
          placeholder: placeholder ?? '',
          disabled,
          'aria-label': t(labelKey),
          onChange: event => { setAdvancedField(key, event.currentTarget.value) },
          style: advancedFieldStyle,
          maxLength: 400,
        }),
        h('span', { style: advancedHelpStyle }, t(helpKey)))

      return h('div', {
        'aria-busy': pending,
        style: { display: 'grid', gap: '8px', padding: '12px 0' },
      },
      h('label', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--dsw-alias-label-primary)',
          cursor: disabled ? 'default' : 'pointer',
        },
      },
      h('input', {
        type: 'checkbox',
        role: 'switch',
        checked: enabled,
        disabled,
        'aria-label': t('toggle'),
        onChange,
        style: {
          accentColor: 'var(--dsw-alias-brand-primary)',
          width: '18px',
          height: '18px',
          flex: '0 0 auto',
        },
      }),
      h('span', null, t('toggle'))),
      h('p', { style: advancedHelpStyle }, t('help')),
      h('label', { style: advancedLabelStyle },
        h('span', null, t('permissionMode')),
        h('select', {
          value: permissionMode,
          disabled,
          onChange: onPermissionModeChange,
          'aria-label': t('permissionMode'),
          style: advancedFieldStyle,
        },
        h('option', { value: 'default' }, t('permissionDefault')),
        h('option', { value: 'accept-edits' }, t('permissionAcceptEdits')),
        h('option', { value: 'auto' }, t('permissionAuto')),
        h('option', { value: 'dangerously-skip-permissions' }, t('permissionDangerous')))),
      h('p', { style: advancedHelpStyle }, t('permissionModeHelp')),
      permissionMode === 'dangerously-skip-permissions'
        ? h('p', {
          role: 'alert',
          style: { margin: 0, color: 'var(--dsw-alias-state-warn-primary)' },
        }, t('dangerousWarning'))
        : null,

      h('hr', {
        style: { border: 0, borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '8px 0' },
      }),
      h('h4', { style: { margin: 0, color: 'var(--dsw-alias-label-primary)' } }, t('advancedTitle')),
      h('p', { style: advancedHelpStyle }, t('advancedHelp')),
      h('p', {
        style: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' },
      }, t('providerNameReadonly', { name: typeof config.providerName === 'string' ? config.providerName : 'antigravity' })),
      textField('command', 'commandLabel', 'commandHelp'),
      textField('model', 'modelLabel', 'modelHelp', t('modelPlaceholder')),
      h('label', { style: advancedLabelStyle },
        h('span', null, t('effortLabel')),
        h('select', {
          value: textValue('effort'),
          disabled,
          'aria-label': t('effortLabel'),
          onChange: event => { setAdvancedField('effort', event.currentTarget.value) },
          style: advancedFieldStyle,
        },
        h('option', { value: '' }, t('effortDefault')),
        ...ADVANCED_EFFORTS.map(level => h('option', { key: level, value: level }, level))),
        h('span', { style: advancedHelpStyle }, t('effortHelp'))),
      textField('agent', 'agentLabel', 'agentHelp', t('agentPlaceholder')),

      h('div', { style: { display: 'grid', gap: '6px' } },
        h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, t('envLabel')),
        ...envRows.map((row, index) => h('div', {
          key: index,
          style: { display: 'flex', gap: '6px', maxWidth: '560px' },
        },
        h('input', {
          type: 'text',
          value: row.key,
          placeholder: t('envKey'),
          disabled,
          'aria-label': t('envKey'),
          onChange: event => {
            const rows = [...envRows]
            rows[index] = { ...row, key: event.currentTarget.value }
            setEnvRows(rows)
          },
          style: { ...advancedFieldStyle, flex: '1 1 40%' },
        }),
        h('input', {
          type: 'text',
          value: row.value,
          placeholder: t('envValue'),
          disabled,
          'aria-label': t('envValue'),
          onChange: event => {
            const rows = [...envRows]
            rows[index] = { ...row, value: event.currentTarget.value }
            setEnvRows(rows)
          },
          style: { ...advancedFieldStyle, flex: '1 1 60%' },
        }),
        h('button', {
          type: 'button',
          disabled,
          onClick: () => { setEnvRows(envRows.filter((_item, position) => position !== index)) },
          style: { ...advancedButtonStyle, flex: '0 0 auto' },
        }, t('envRemove')))),
        h('button', {
          type: 'button',
          disabled,
          onClick: () => { setEnvRows([...envRows, { key: '', value: '' }]) },
          style: { ...advancedButtonStyle, justifySelf: 'start' },
        }, t('envAdd')),
        h('span', { style: advancedHelpStyle }, t('envHelp'))),

      h('div', { style: { display: 'grid', gap: '6px', maxWidth: '560px' } },
        h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, t('graceLabel')),
        h('div', { style: { display: 'flex', gap: '10px' } },
          h('label', { style: { ...advancedLabelStyle, flex: '1 1 0' } },
            h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, t('graceEof')),
            h('input', {
              type: 'number',
              min: 1,
              max: MAX_TIMER_DELAY_MS,
              step: 1,
              value: graceValue('disposeEofGraceMs'),
              disabled,
              'aria-label': t('graceEof'),
              onChange: event => { setAdvancedField('disposeEofGraceMs', event.currentTarget.value) },
              style: advancedFieldStyle,
            })),
          h('label', { style: { ...advancedLabelStyle, flex: '1 1 0' } },
            h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, t('graceTerminate')),
            h('input', {
              type: 'number',
              min: 1,
              max: MAX_TIMER_DELAY_MS,
              step: 1,
              value: graceValue('disposeGraceMs'),
              disabled,
              'aria-label': t('graceTerminate'),
              onChange: event => { setAdvancedField('disposeGraceMs', event.currentTarget.value) },
              style: advancedFieldStyle,
            }))),
        h('span', { style: advancedHelpStyle }, t('graceHelp'))),

      h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
        h('button', {
          type: 'button',
          disabled,
          onClick: saveAdvanced,
          style: advancedButtonStyle,
        }, t('advancedSave')),
        h('span', { style: advancedHelpStyle }, t('restartNote'))),

      !state.writable
        ? h('p', {
          role: 'status',
          style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' },
        }, t('readOnly'))
        : null,
      pending
        ? h('p', { role: 'status', style: { margin: 0 } }, t('saving'))
        : feedback === '' ? null : h('p', {
          role: feedback === 'saveFailed' || feedback === 'invalidGrace' ? 'alert' : 'status',
          style: {
            margin: 0,
            color: feedback === 'saveFailed' || feedback === 'invalidGrace'
              ? 'var(--dsw-alias-state-error-primary)'
              : 'var(--dsw-alias-label-secondary)',
          },
        }, t(feedback)))
    }

    const AGY_QUOTA_ROUTE = 'api/xgone/agy-quota'
    // A quota reading is a slow, remote fact: poll every five minutes, only
    // while the page is visible, and stop entirely when it is hidden.
    const AGY_QUOTA_REFRESH_MS = 5 * 60_000
    /** One follow-up read after a restored (stale) snapshot so the background probe lands. */
    const AGY_QUOTA_REVALIDATE_MS = 15_000

    function quotaWindowLabel(bucket, t) {
      const key = `${bucket.window ?? ''} ${bucket.name ?? ''}`.toLowerCase()
      if (/five.?hour|5.?hours?|5h/u.test(key)) return t('quotaWindowFiveHours')
      if (/weekly|week|7.?days?/u.test(key)) return t('quotaWindowWeek')
      if (/monthly|month/u.test(key)) return t('quotaWindowMonth')
      return bucket.window || bucket.name || t('quotaWindowOther')
    }

    function quotaDate(value) {
      const date = new Date(value)
      return Number.isFinite(date.getTime())
        ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : null
    }

    function quotaTone(fraction) {
      if (fraction < 0.2) return 'var(--dsw-alias-state-error-primary)'
      if (fraction < 0.5) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-state-success-primary)'
    }

    function quotaPresentation(snapshot, t) {
      const empty = (status, reason) => {
        const text = status === 'loading'
          ? t('quotaLoading')
          : reason === 'auth' ? t('quotaSignIn') : t('quotaUnavailable')
        return { text, mobileText: text, status, low: false, rows: [], nextReset: null }
      }
      if (snapshot === undefined) return empty('loading')
      if (snapshot.status === 'unavailable' || !Array.isArray(snapshot.groups)) {
        return empty('unavailable', snapshot.reason)
      }

      const buckets = snapshot.groups.flatMap(group => (Array.isArray(group?.buckets) ? group.buckets : [])
        .filter(bucket => typeof bucket?.remainingFraction === 'number'
          && Number.isFinite(bucket.remainingFraction)
          && bucket.remainingFraction >= 0
          && bucket.remainingFraction <= 1)
        .map(bucket => ({ group: group.name ?? 'Agy', bucket })))
      if (buckets.length === 0) return empty('unavailable')

      const windows = new Map()
      for (const item of buckets) {
        const key = `${item.bucket.window ?? ''} ${item.bucket.name ?? ''}`.trim().toLowerCase()
        const previous = windows.get(key)
        if (previous === undefined || item.bucket.remainingFraction < previous.bucket.remainingFraction) windows.set(key, item)
      }
      const unique = [...windows.values()].sort((a, b) => a.bucket.remainingFraction - b.bucket.remainingFraction)
      const compact = unique.slice(0, 2).map(({ bucket }) => t('quotaShort', {
        window: quotaWindowLabel(bucket, t),
        percent: Math.round(bucket.remainingFraction * 100),
      }))
      const stale = snapshot.status === 'stale' ? ` · ${t('quotaStale')}` : ''
      const rows = buckets.map(({ group, bucket }, index) => ({
        key: `${group}-${bucket.name ?? bucket.window ?? index}`,
        // Localize known rolling windows; keep the CLI's own label as the fallback.
        label: `${group} · ${quotaWindowLabel(bucket, t)}`,
        percent: Math.round(bucket.remainingFraction * 100),
        fraction: bucket.remainingFraction,
        reset: typeof bucket.resetTime === 'string' ? quotaDate(bucket.resetTime) : null,
      }))
      const nextReset = buckets
        .map(({ bucket }) => bucket.resetTime)
        .filter(value => typeof value === 'string'
          && Number.isFinite(Date.parse(value))
          && Date.parse(value) > Date.now())
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
      // Narrow viewports have no room for per-window labels; show the tightest
      // remaining percentage only, with the full reading kept for the panel.
      const worstPercent = Math.round(unique[0].bucket.remainingFraction * 100)
      return {
        text: `${t('quotaLabel')} ${compact.join(' · ')}${stale}`,
        mobileText: t('quotaMobile', { percent: worstPercent }),
        status: snapshot.status === 'stale' ? 'stale' : 'ready',
        low: unique[0].bucket.remainingFraction <= 0.1,
        rows,
        nextReset,
      }
    }

    function QuotaBarRow({ row, t }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        h('div', {
          style: {
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px',
            fontSize: '12px', color: 'var(--dsw-alias-label-primary)',
          },
        },
        h('span', {
          style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, row.label),
        h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, `${row.percent}%`)),
        h('div', {
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': row.percent,
          'aria-label': row.label,
          style: {
            height: '6px', borderRadius: '999px', overflow: 'hidden',
            background: 'var(--dsw-alias-bg-layer-2)',
          },
        }, h('div', {
          style: {
            width: `${row.percent}%`, height: '100%', borderRadius: '999px',
            background: quotaTone(row.fraction), transition: 'width 200ms ease',
          },
        })),
        row.reset === null ? null : h('span', {
          style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
        }, t('quotaReset', { time: row.reset })))
    }

    /** Phones and other narrow surfaces get a one-number quota reading. */
    const NARROW_QUERY = '(max-width: 480px)'

    function useNarrowViewport() {
      const [narrow, setNarrow] = React.useState(() => (
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia(NARROW_QUERY).matches
          : false
      ))
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
        const query = window.matchMedia(NARROW_QUERY)
        const onChange = () => { setNarrow(query.matches) }
        setNarrow(query.matches)
        if (typeof query.addEventListener === 'function') {
          query.addEventListener('change', onChange)
          return () => { query.removeEventListener('change', onChange) }
        }
        query.addListener(onChange)
        return () => { query.removeListener(onChange) }
      }, [])
      return narrow
    }

    function AgyQuotaDock({ t }) {
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [open, setOpen] = React.useState(false)
      const narrow = useNarrowViewport()
      const [pos, setPos] = React.useState(null)
      const anchorRef = React.useRef(null)
      const panelRef = React.useRef(null)

      React.useEffect(() => {
        let disposed = false
        let inFlight = false
        let controller
        let revalidate
        const refresh = async () => {
          if (disposed || inFlight) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          inFlight = true
          const current = new AbortController()
          controller = current
          try {
            const response = await fetch(AGY_QUOTA_ROUTE, {
              method: 'GET',
              cache: 'no-store',
              credentials: 'same-origin',
              signal: current.signal,
            })
            if (!response.ok) throw new Error(`quota route returned ${response.status}`)
            const value = await response.json()
            if (!disposed && ['ready', 'stale', 'unavailable'].includes(value?.status)) {
              setSnapshot(value)
              // A restored disk snapshot answers immediately; one delayed read
              // picks up the fresh probe that started behind it.
              if (value.status === 'stale' && revalidate === undefined) {
                revalidate = setTimeout(() => {
                  revalidate = undefined
                  void refresh()
                }, AGY_QUOTA_REVALIDATE_MS)
              }
            } else if (!disposed) setSnapshot({ status: 'unavailable' })
          } catch (error) {
            if (!disposed && error?.name !== 'AbortError') setSnapshot({ status: 'unavailable' })
          } finally {
            inFlight = false
            if (controller === current) controller = undefined
          }
        }
        const onVisibilityChange = () => {
          if (document.visibilityState === 'visible') void refresh()
        }
        void refresh()
        const interval = setInterval(() => { void refresh() }, AGY_QUOTA_REFRESH_MS)
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
        return () => {
          disposed = true
          clearInterval(interval)
          if (revalidate !== undefined) clearTimeout(revalidate)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
          controller?.abort()
        }
      }, [])

      const view = quotaPresentation(snapshot, t)
      const rowsLength = view.rows.length

      const place = () => {
        const el = anchorRef.current
        if (el === null) return null
        const rect = el.getBoundingClientRect()
        const width = Math.min(240, Math.max(200, window.innerWidth - 24))
        const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
        // Prefer opening upward and pin the panel's BOTTOM above the trigger, so an
        // unknown rendered height can never overlap the dock. Fall back downward
        // only when there is not enough room above.
        const above = rect.top > 200
        const top = above ? rect.top - 8 : rect.bottom + 8
        const transform = above ? 'translateY(-100%)' : 'none'
        const maxHeight = above
          ? Math.max(120, rect.top - 16)
          : Math.max(120, window.innerHeight - rect.bottom - 16)
        return { left, top, width, transform, maxHeight }
      }

      // Click/tap opens; outside pointerdown, Escape, resize and scroll close or reposition.
      React.useEffect(() => {
        if (!open) return undefined
        const reposition = () => { const next = place(); if (next !== null) setPos(next) }
        const onPointerDown = event => {
          const anchor = anchorRef.current
          const panel = panelRef.current
          if (anchor?.contains(event.target) || panel?.contains(event.target)) return
          setOpen(false)
        }
        window.addEventListener('resize', reposition)
        window.addEventListener('scroll', reposition, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          window.removeEventListener('resize', reposition)
          window.removeEventListener('scroll', reposition, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open, rowsLength])

      const toggle = () => {
        if (open) { setOpen(false); return }
        const next = place()
        if (next === null) return
        setPos(next)
        setOpen(true)
      }

      const pill = h('button', {
        ref: anchorRef,
        type: 'button',
        'data-agy-quota': view.status,
        'aria-label': view.text,
        title: narrow ? view.text : undefined,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: toggle,
        onKeyDown: event => { if (event.key === 'Escape') setOpen(false) },
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          boxSizing: 'border-box',
          maxWidth: '100%',
          // The shipped ContextMeter renders after the dock slot; order lifts this
          // pill past it so the quota reading sits at the row's right edge.
          order: 999,
          padding: '1px 8px',
          border: 'none',
          borderRadius: 'var(--dsw-radius-sm)',
          background: open ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
          color: open ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-tertiary)',
          fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
        },
      }, narrow ? view.mobileText : view.text)

      const panel = open && pos !== null && rowsLength > 0
        ? createPortal(h('div', {
          ref: panelRef,
          role: 'dialog',
          'aria-label': t('quotaTitle'),
          style: {
            position: 'fixed',
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            width: `${pos.width}px`,
            transform: pos.transform,
            zIndex: 2147483000,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
            border: '0',
            borderRadius: 'var(--dsw-radius-lg)',
            background: 'var(--dsw-specific-menu)',
            backdropFilter: 'var(--dsw-menu-backdrop-filter)',
            boxShadow: 'var(--dsw-elevation-prominent)',
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: '12px',
            lineHeight: '18px',
            maxHeight: `${pos.maxHeight}px`,
            overflowY: 'auto',
          },
        },
        h('div', {
          style: { fontSize: '12px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
        }, t('quotaTitle')),
        view.nextReset === null ? null : h('div', {
          style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
        }, t('quotaNextReset', { time: quotaDate(view.nextReset) ?? String(view.nextReset) })),
        ...view.rows.map(row => h(QuotaBarRow, { key: row.key, row, t })),
        view.status === 'stale'
          ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-warn-primary)' } }, t('quotaStale'))
          : null,
        snapshot?.fetchedAt
          ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } },
            t('quotaLastUpdated', { time: quotaDate(snapshot.fetchedAt) ?? String(snapshot.fetchedAt) }))
          : null), document.body)
        : null

      return h(React.Fragment, null, pill, panel)
    }

    /**
     * One Antigravity CLI tool step inside the child Session transcript. The
     * DSH web client only knows its own built-in tool names, so a custom tool
     * would otherwise render as a bare "tool call · name · id" row. This keyed
     * view shows the native command and its real output.
     */
    const toolKindGlyphs = {
      execute: '$',
      read: '▤',
      edit: '✎',
      delete: '⌫',
      move: '⇄',
      search: '⌕',
      fetch: '↧',
      other: '·',
    }

    function agyReadArg(block, name) {
      try {
        const text = block && block.args && typeof block.args.text === 'function' ? block.args.text(name) : undefined
        return typeof text === 'string' ? text : ''
      } catch {
        return ''
      }
    }

    function agyParseJson(text) {
      if (typeof text !== 'string' || text === '') return undefined
      try {
        return JSON.parse(text)
      } catch {
        return undefined
      }
    }

    /**
     * One Antigravity CLI tool step inside the child Session transcript. The
     * DSH web client only classifies its own built-in tool names, so a custom
     * recorder would render as a bare "tool call · name · id" row. This keyed
     * view shows the native command, its state, duration, exit code, the file it
     * touched (openable) and the CLI's real output.
     */
    function AgyProgressRow({ block, phase, t, openFile, cwd }) {
      const [open, setOpen] = React.useState(false)
      const title = agyReadArg(block, 'title')
      const rawInputText = agyReadArg(block, 'rawInputText')
      const meta = phase === 'result' && block && typeof block.meta === 'object' && block.meta !== null
        ? block.meta
        : undefined
      const kind = meta && typeof meta.kind === 'string' ? meta.kind : agyReadArg(block, 'kind') || 'other'
      const failed = Boolean(block && block.isError) || meta?.status === 'failed'
      const state = phase === 'preparing' ? 'preparing'
        : phase === 'start' ? 'running'
          : failed ? 'failed' : 'done'
      const output = phase === 'result' && block && Array.isArray(block.content)
        ? block.content
          .filter(item => item && item.type === 'text' && typeof item.text === 'string')
          .map(item => item.text)
          .join('\n')
          .trim()
        : ''
      const parameters = agyParseJson(rawInputText)
      const fallbackPath = parameters !== null && typeof parameters === 'object'
        ? ['Path', 'path', 'file_path', 'FilePath', 'AbsolutePath', 'DirectoryPath', 'TargetFile']
          .map(key => parameters[key])
          .find(value => typeof value === 'string' && value.trim() !== '')
        : undefined
      const path = meta && typeof meta.path === 'string' && meta.path.trim() !== ''
        ? meta.path
        : fallbackPath
      const summary = typeof path === 'string' && typeof cwd === 'string' && cwd !== '' && path.startsWith(cwd)
        ? `.${path.slice(cwd.length) === '' ? '/' : path.slice(cwd.length)}`
        : path
      const duration = meta && typeof meta.durationSeconds === 'number'
        ? `${meta.durationSeconds < 10 ? meta.durationSeconds.toFixed(1) : Math.round(meta.durationSeconds)}s`
        : ''
      const exitCode = meta && Number.isInteger(meta.exitCode) ? meta.exitCode : undefined
      const stateKey = {
        preparing: 'toolStatePreparing',
        running: 'toolStateRunning',
        failed: 'toolStateFailed',
        done: 'toolStateDone',
      }[state]
      const stateText = t(stateKey)
      const glyph = toolKindGlyphs[kind] ?? toolKindGlyphs.other
      const expanded = open || state === 'failed'
      const bodyBlocks = []
      if (expanded) {
        if (rawInputText !== '') {
          bodyBlocks.push(h('div', { key: 'args', style: { display: 'flex', gap: '6px' } },
            h('span', { style: { flex: 'none', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, t('toolArguments')),
            h('pre', {
              style: {
                margin: 0, minWidth: 0, fontSize: '11px', lineHeight: '16px',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: 'var(--dsw-alias-label-tertiary)',
              },
            }, rawInputText)))
        }
        if (output !== '') {
          bodyBlocks.push(h('pre', {
            key: 'out',
            style: {
              margin: 0,
              padding: '8px 10px',
              borderRadius: '6px',
              background: 'var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08))',
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: '11px',
              lineHeight: '16px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '240px',
              overflow: 'auto',
            },
          }, output))
        }
      }
      const canExpand = output !== '' || rawInputText !== ''
      return h('div', {
        'data-tool': 'agy_progress',
        'data-state': state,
        style: { display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', minWidth: 0 },
      },
      h('button', {
        type: 'button',
        onClick: canExpand ? () => setOpen(value => !value) : undefined,
        'aria-expanded': canExpand ? expanded : undefined,
        style: {
          display: 'flex', alignItems: 'baseline', gap: '8px', width: '100%', minWidth: 0,
          padding: 0, border: 0, background: 'transparent', textAlign: 'left',
          cursor: canExpand ? 'pointer' : 'default',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
        },
      },
      h('span', {
        'aria-hidden': 'true',
        style: {
          flex: 'none',
          width: '10px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: state === 'failed'
            ? 'var(--dsw-alias-state-error-primary, #e5484d)'
            : 'var(--dsw-alias-label-tertiary)',
        },
      }, glyph),
      h('span', {
        style: {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        },
      }, title === '' ? 'Antigravity tool' : title),
      summary === undefined ? null : h('span', {
        style: {
          flex: 'none', fontSize: '11px',
          color: 'var(--dsw-alias-label-tertiary)',
        },
      }, summary),
      h('span', {
        style: {
          flex: 'none', fontSize: '11px',
          color: state === 'failed'
            ? 'var(--dsw-alias-state-error-primary, #e5484d)'
            : 'var(--dsw-alias-label-tertiary)',
        },
      }, stateText),
      duration === '' ? null : h('span', {
        style: { flex: 'none', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
      }, duration),
      exitCode === undefined ? null : h('span', {
        style: {
          flex: 'none', fontSize: '11px', fontVariantNumeric: 'tabular-nums',
          color: exitCode === 0
            ? 'var(--dsw-alias-state-success-primary, #46a758)'
            : 'var(--dsw-alias-state-error-primary, #e5484d)',
        },
      }, t('toolExitCode', { code: exitCode })),
      canExpand ? h('span', {
        style: { marginLeft: 'auto', flex: 'none', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      }, expanded ? t('toolCollapse') : t('toolExpand')) : null),
      typeof path === 'string' && typeof openFile === 'function'
        ? h('button', {
          type: 'button',
          onClick: () => { openFile(path) },
          style: {
            alignSelf: 'flex-start',
            padding: 0,
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            fontSize: '11px',
            color: 'var(--dsw-alias-label-tertiary)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          },
        }, summary ?? path)
        : null,
      ...bodyBlocks)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        for (const [language, dictionary] of Object.entries(dictionaries)) {
          ctx.effect(() => ctx.locale.register(NAMESPACE, language, dictionary),
            `@xgone/dsh-subagent-antigravity.locale.${language}`)
        }
        for (const packageName of [PACKAGE, LEGACY_PACKAGE]) {
          ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
            name: 'plugins.row.config',
            key: `${packageName}#${ROW_ID}`,
            locale: NAMESPACE,
          }, AutoDelegateConfig)), `@xgone/dsh-subagent-antigravity.config-ui:${packageName}`)
        }
        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'xgone-antigravity-quota',
          order: 2,
          locale: NAMESPACE,
        }, AgyQuotaDock)), '@xgone/dsh-subagent-antigravity.quota-ui')
        ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'agy_progress',
          locale: NAMESPACE,
        }, AgyProgressRow)), '@xgone/dsh-subagent-antigravity.toolview')
      },
    }
  },
})
