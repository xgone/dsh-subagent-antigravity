window.__ModuleLoader__.load({
  id: '@xgone/dsh-subagent-antigravity',
  factory(require) {
    const React = require('react')
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
        statusOne: 'Antigravity is working',
        statusMany: 'Antigravity is working ({count})',
        quotaLabel: 'Agy quota',
        quotaLoading: 'Loading Agy quota…',
        quotaUnavailable: 'Agy quota unavailable',
        quotaUnavailableHelp: 'Check that the Agy CLI is installed and signed in.',
        quotaTitle: 'Agy account quota',
        quotaRemaining: '{window} {percent}% left',
        quotaShort: '{window} {percent}%',
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
        dangerousWarning: 'This allows all Antigravity tools without prompts or sandboxing. Use only when you trust the task and workspace.'
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
        statusOne: 'Antigravity 正在运行',
        statusMany: 'Antigravity 正在运行（{count} 个任务）',
        quotaLabel: 'Agy 额度',
        quotaLoading: '正在读取 Agy 额度…',
        quotaUnavailable: 'Agy 额度暂不可用',
        quotaUnavailableHelp: '请检查 Agy CLI 是否已安装并登录。',
        quotaTitle: 'Agy 账号额度',
        quotaRemaining: '{window} 剩余 {percent}%',
        quotaShort: '{window} {percent}%',
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
        dangerousWarning: '此模式会无提示、无沙箱地运行所有 Antigravity 工具。仅在完全信任任务和工作区时使用。'
      },
    }

    function AutoDelegateConfig(props) {
      const { view, form, t } = props
      const state = form?.state
      const [pending, setPending] = React.useState(false)
      const [draft, setDraft] = React.useState({})
      const [feedback, setFeedback] = React.useState('')

      React.useEffect(() => {
        setDraft({})
        setFeedback('')
      }, [state?.revision, state?.value?.autoDelegate, state?.value?.permissionMode])

      const enabled = draft.autoDelegate ?? (state?.value?.autoDelegate === true)
      const permissionMode = draft.permissionMode ?? state?.value?.permissionMode ?? 'default'
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

      const checked = enabled
      const disabled = pending || !state.writable || state.revision === undefined
      const saveField = (field, value) => {
        setDraft(current => ({ ...current, [field]: value }))
        setPending(true)
        setFeedback('')
        Promise.resolve()
          .then(() => form.mutate([
            { op: 'set', path: [field], value },
          ], state.revision))
          .then((accepted) => {
            if (!accepted) {
              setDraft({})
              setFeedback('failed')
            } else {
              setFeedback('saved')
            }
          })
          .catch(() => {
            setDraft({})
            setFeedback('failed')
          })
          .finally(() => { setPending(false) })
      }
      const onChange = (event) => {
        saveField('autoDelegate', Boolean(event.currentTarget.checked))
      }
      const onPermissionModeChange = (event) => {
        saveField('permissionMode', event.currentTarget.value)
      }

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
        checked,
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
      h('p', {
        style: {
          margin: 0,
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: '13px',
          lineHeight: 1.45,
        },
      }, t('help')),
      h('label', {
        style: {
          display: 'grid',
          gap: '6px',
          color: 'var(--dsw-alias-label-primary)',
        },
      },
      h('span', null, t('permissionMode')),
      h('select', {
        value: permissionMode,
        disabled,
        onChange: onPermissionModeChange,
        'aria-label': t('permissionMode'),
        style: {
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: '560px',
          padding: '8px 10px',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: '8px',
          backgroundColor: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
        },
      },
      h('option', { value: 'default' }, t('permissionDefault')),
      h('option', { value: 'accept-edits' }, t('permissionAcceptEdits')),
      h('option', { value: 'auto' }, t('permissionAuto')),
      h('option', { value: 'dangerously-skip-permissions' }, t('permissionDangerous')))),
      h('p', {
        style: {
          margin: 0,
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: '13px',
          lineHeight: 1.45,
        },
      }, t('permissionModeHelp')),
      permissionMode === 'dangerously-skip-permissions'
        ? h('p', {
          role: 'alert',
          style: { margin: 0, color: 'var(--dsw-alias-state-warn-primary)' },
        }, t('dangerousWarning'))
        : null,
      !state.writable
        ? h('p', {
          role: 'status',
          style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' },
        }, t('readOnly'))
        : null,
      pending
        ? h('p', { role: 'status', style: { margin: 0 } }, t('saving'))
        : feedback === '' ? null : h('p', {
          role: feedback === 'failed' ? 'alert' : 'status',
          style: {
            margin: 0,
            color: feedback === 'failed'
              ? 'var(--dsw-alias-state-error-primary)'
              : 'var(--dsw-alias-label-secondary)',
          },
        }, t(feedback)))
    }

    function AntigravityStatusAction(props) {
      const { sessionId, useSessions, t } = props
      const count = useSessions((snapshot) => {
        const view = snapshot.projectionsBySession?.[sessionId]?.values?.antigravityStatus
        return typeof view?.count === 'number' ? view.count : 0
      })
      if (count < 1) return null
      return h('span', {
        role: 'status',
        'aria-live': 'polite',
        title: t(count === 1 ? 'statusOne' : 'statusMany', { count }),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: '12px',
          whiteSpace: 'nowrap',
        },
      },
      h('svg', {
        viewBox: '0 0 24 24',
        width: 14,
        height: 14,
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('circle', {
        cx: 12, cy: 12, r: 9, fill: 'none',
        stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 2,
      }),
      h('circle', {
        cx: 12, cy: 12, r: 9, fill: 'none',
        stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 2,
        strokeDasharray: '20 60', strokeLinecap: 'round',
      }, h('animateTransform', {
        attributeName: 'transform', type: 'rotate',
        from: '0 12 12', to: '360 12 12', dur: '0.9s', repeatCount: 'indefinite',
      }))),
      h('span', null, t(count === 1 ? 'statusOne' : 'statusMany', { count })))
    }

    const AGY_QUOTA_ROUTE = 'api/xgone/agy-quota'
    const AGY_QUOTA_REFRESH_MS = 60_000

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

    function quotaPresentation(snapshot, t) {
      if (snapshot === undefined) return { text: t('quotaLoading'), title: t('quotaLoading'), status: 'loading', low: false }
      if (snapshot.status === 'unavailable' || !Array.isArray(snapshot.groups)) {
        return { text: t('quotaUnavailable'), title: t('quotaUnavailableHelp'), status: 'unavailable', low: false }
      }

      const buckets = snapshot.groups.flatMap(group => (Array.isArray(group?.buckets) ? group.buckets : [])
        .filter(bucket => typeof bucket?.remainingFraction === 'number'
          && Number.isFinite(bucket.remainingFraction)
          && bucket.remainingFraction >= 0
          && bucket.remainingFraction <= 1)
        .map(bucket => ({ group: group.name ?? 'Agy', bucket })))
      if (buckets.length === 0) {
        return { text: t('quotaUnavailable'), title: t('quotaUnavailableHelp'), status: 'unavailable', low: false }
      }

      const windows = new Map()
      for (const item of buckets) {
        const key = `${item.bucket.window ?? ''} ${item.bucket.name ?? ''}`.trim().toLowerCase()
        const previous = windows.get(key)
        if (previous === undefined || item.bucket.remainingFraction < previous.bucket.remainingFraction) windows.set(key, item)
      }
      const unique = [...windows.values()].sort((a, b) => a.bucket.remainingFraction - b.bucket.remainingFraction)
      // Compact dock reading stays short: percentages only, no reset times.
      const compact = unique.slice(0, 2).map(({ bucket }) => t('quotaShort', {
        window: quotaWindowLabel(bucket, t),
        percent: Math.round(bucket.remainingFraction * 100),
      }))
      const stale = snapshot.status === 'stale' ? ` · ${t('quotaStale')}` : ''
      // Hover detail: every reported group and bucket, its remaining share and reset time.
      const lines = buckets.map(({ group, bucket }) => {
        const label = `${group}: ${bucket.name ?? quotaWindowLabel(bucket, t)}`
        const percent = t('quotaRemaining', { window: quotaWindowLabel(bucket, t), percent: Math.round(bucket.remainingFraction * 100) })
        const resetTime = typeof bucket.resetTime === 'string'
          ? quotaDate(bucket.resetTime)
          : null
        return `${label} — ${percent}${resetTime === null ? '' : `; ${t('quotaReset', { time: resetTime })}`}`
      })
      if (snapshot.status === 'stale') lines.push(t('quotaStale'))
      if (snapshot.fetchedAt) lines.push(t('quotaLastUpdated', { time: quotaDate(snapshot.fetchedAt) ?? snapshot.fetchedAt }))
      return {
        text: `${t('quotaLabel')} ${compact.join(' · ')}${stale}`,
        title: [t('quotaTitle'), ...lines].join('\n'),
        status: snapshot.status === 'stale' ? 'stale' : 'ready',
        low: unique[0].bucket.remainingFraction <= 0.1,
      }
    }

    function AgyQuotaDock({ t }) {
      const [snapshot, setSnapshot] = React.useState(undefined)
      React.useEffect(() => {
        let disposed = false
        let inFlight = false
        let controller
        const refresh = async () => {
          if (disposed || inFlight) return
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
            if (!disposed && ['ready', 'stale', 'unavailable'].includes(value?.status)) setSnapshot(value)
            else if (!disposed) setSnapshot({ status: 'unavailable' })
          } catch (error) {
            if (!disposed && error?.name !== 'AbortError') setSnapshot({ status: 'unavailable' })
          } finally {
            inFlight = false
            if (controller === current) controller = undefined
          }
        }
        void refresh()
        const interval = setInterval(() => { void refresh() }, AGY_QUOTA_REFRESH_MS)
        return () => {
          disposed = true
          clearInterval(interval)
          controller?.abort()
        }
      }, [])

      const view = quotaPresentation(snapshot, t)
      const color = view.low
        ? 'var(--dsw-alias-state-warn-primary)'
        : 'var(--dsw-alias-label-secondary)'
      return h('span', {
        'data-agy-quota': view.status,
        'aria-label': view.text,
        title: view.title,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: '999px',
          background: 'var(--dsw-alias-bg-layer-1)',
          color,
          fontSize: '12px',
          lineHeight: 1.35,
          padding: '3px 8px',
          whiteSpace: 'nowrap',
        },
      }, view.text)
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
        ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'xgone-antigravity-status',
          order: 15,
          locale: NAMESPACE,
        }, AntigravityStatusAction)), '@xgone/dsh-subagent-antigravity.header-status-ui')
        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'xgone-antigravity-quota',
          order: 2,
          locale: NAMESPACE,
        }, AgyQuotaDock)), '@xgone/dsh-subagent-antigravity.quota-ui')
      },
    }
  },
})
