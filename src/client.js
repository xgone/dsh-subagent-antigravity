window.__ModuleLoader__.load({
  id: 'dsh-subagent-antigravity',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NAMESPACE = 'dsh-subagent-antigravity-ui'
    const PACKAGE = 'dsh-subagent-antigravity'
    const ROW_ID = 'subagent-antigravity'

    const dictionaries = {
      en: {
        toggle: 'Automatically delegate new tasks to Antigravity',
        help: 'When enabled, DSH asks Antigravity to handle each new task and relays its final answer. DSH still schedules the child; this setting guides the model rather than hard-routing the request.',
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
        help: '开启后，DSH 会提示主模型把每条新任务交给 Antigravity，并转交最终结果。DSH 仍负责调度子智能体；此开关通过提示引导模型，不会硬性拦截模型请求。',
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
      const permissionMode = draft.permissionMode ?? state?.value?.permissionMode ?? 'accept-edits'
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
      }, t('help')),
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

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        for (const [language, dictionary] of Object.entries(dictionaries)) {
          ctx.effect(() => ctx.locale.register(NAMESPACE, language, dictionary),
            `dsh-subagent-antigravity.locale.${language}`)
        }
        ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: `${PACKAGE}#${ROW_ID}`,
          locale: NAMESPACE,
        }, AutoDelegateConfig)), 'dsh-subagent-antigravity.auto-delegate-ui')
        ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'dsh-subagent-antigravity-status',
          order: 15,
          locale: NAMESPACE,
        }, AntigravityStatusAction)), 'dsh-subagent-antigravity.header-status-ui')
      },
    }
  },
})
