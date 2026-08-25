import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

import type { EspBuddyStatus, EspBuddySettings, RolePackProgress, RolePackWireFile } from '../contract.ts'
import { connectionTone, formatDiagnostics } from './model.ts'
import { RolePackSection } from './RolePackSection.tsx'
import { PLUGIN_VERSION } from './version.ts'

export interface EspBuddySectionInjected {
  hooks: { scope: SettingsScope<EspBuddySettings> }
  readStatus: () => Promise<EspBuddyStatus>
  reconnect: () => Promise<EspBuddyStatus>
  installRolePack: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>
  setSetting: (field: keyof EspBuddySettings, value: boolean | number | string) => Promise<void>
  uninstall: () => Promise<void>
}

export type EspBuddySectionProps = PropsRuntime<'settings.plugin.item'>
  & InjectFace<EspBuddySectionInjected>
  & PropsLocale<'esp-buddy'>

export type EspBuddySettingsPageProps = PropsRuntime<'settings.section'>
  & InjectFace<EspBuddySectionInjected>
  & PropsLocale<'esp-buddy'>

function displayTime(value?: string): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString()
}

const helperStatusKeys = {
  stopped: 'status.helper.stopped',
  starting: 'status.helper.starting',
  running: 'status.helper.running',
  backoff: 'status.helper.backoff',
  blocked: 'status.helper.blocked',
} as const

export function EspBuddySection({ useScope, readStatus, reconnect, installRolePack, setSetting, uninstall, t, page = false }: EspBuddySectionProps & { page?: boolean }) {
  const config = useScope(snapshot => snapshot.value)
  const [open, setOpen] = useState(page)
  const [status, setStatus] = useState<EspBuddyStatus>()
  const [statusError, setStatusError] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [actionState, setActionState] = useState<'idle' | 'reconnecting' | 'reconnectStarted' | 'copied' | 'failed'>('idle')
  const [removeState, setRemoveState] = useState<'idle' | 'confirming' | 'removing' | 'removed' | 'failed'>('idle')

  const refresh = useCallback(async () => {
    try {
      setStatus(await readStatus())
      setStatusError(false)
    } catch {
      setStatusError(true)
    }
  }, [readStatus])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const write = async (field: keyof EspBuddySettings, value: boolean | number | string) => {
    try {
      await setSetting(field, value)
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1_500)
      await refresh()
    } catch {
      setSaveState('failed')
    }
  }

  const enabled = config?.enabled ?? true
  const tone = connectionTone(status, statusError)
  const connectionLabel = statusError
    ? t('status.unavailable')
    : status === undefined
      ? t('status.loading')
      : status.connected
        ? t('status.connected')
        : t('status.disconnected')

  const resetActionLater = () => window.setTimeout(() => setActionState('idle'), 2_000)
  const handleReconnect = async () => {
    setActionState('reconnecting')
    try {
      setStatus(await reconnect())
      setStatusError(false)
      setActionState('reconnectStarted')
    } catch {
      setActionState('failed')
    }
    resetActionLater()
  }
  const handleCopyDiagnostics = async () => {
    if (config === undefined) return
    try {
      const current = await readStatus()
      setStatus(current)
      setStatusError(false)
      await navigator.clipboard.writeText(formatDiagnostics(current, config))
      setActionState('copied')
    } catch {
      setActionState('failed')
    }
    resetActionLater()
  }
  const handleRemove = async () => {
    if (removeState !== 'confirming') {
      setRemoveState('confirming')
      return
    }
    setRemoveState('removing')
    try {
      await uninstall()
      setRemoveState('removed')
    } catch {
      setRemoveState('failed')
    }
  }

  return (
    <li className={`${open ? 'dsh_espBuddy_card is-open' : 'dsh_espBuddy_card'}${page ? ' dsh_espBuddy_page' : ''}`}>
      {page ? (
        <div className="dsh_espBuddy_pageHeader">
          <h2 id="dsh-esp-buddy-settings-title">{t('settings.title')}<span className="dsh_espBuddy_version">v{PLUGIN_VERSION}</span></h2>
          <p>{t('settings.description')}</p>
        </div>
      ) : (
      <button
        type="button"
        className="dsh_espBuddy_cardHeader"
        aria-expanded={open}
        aria-controls="dsh-esp-buddy-settings-body"
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}：${t('settings.title')}`}
        onClick={() => setOpen(current => !current)}
      >
        <span className="dsh_espBuddy_cardHeadText">
          <span id="dsh-esp-buddy-settings-title" className="dsh_espBuddy_cardName">{t('settings.title')}<span className="dsh_espBuddy_version">v{PLUGIN_VERSION}</span></span>
          <span className="dsh_espBuddy_cardDescription">{t('settings.description')}</span>
        </span>
        <svg className={open ? 'dsh_espBuddy_chevron is-open' : 'dsh_espBuddy_chevron'} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </svg>
      </button>
      )}

      {open && (
        <div id="dsh-esp-buddy-settings-body" className="dsh_espBuddy_cardBody" aria-labelledby="dsh-esp-buddy-settings-title">
          <div className="dsh_espBuddy_section">

      <label className="dsh_espBuddy_enableRow">
        <input
          type="checkbox"
          checked={enabled}
          onChange={event => { void write('enabled', event.target.checked) }}
        />
        <span>
          <strong>{t('settings.enabled')}</strong>
          <small>{t('settings.enabledDesc')}</small>
        </span>
      </label>

      <div className="dsh_espBuddy_group">
        <div className="dsh_espBuddy_groupHeader">
          <h3>{t('status.title')}</h3>
          <span className={`dsh_espBuddy_connection is-${tone}`}>
            <i aria-hidden="true" />{connectionLabel}
          </span>
        </div>
        <dl className="dsh_espBuddy_statusGrid">
          <div><dt>{t('status.device')}</dt><dd>{status?.device ?? '—'}</dd></div>
          <div><dt>{t('status.mtu')}</dt><dd>{status?.mtu ?? '—'}</dd></div>
          <div><dt>{t('status.helper')}</dt><dd>{status === undefined ? '—' : t(helperStatusKeys[status.helperState])}</dd></div>
          <div><dt>{t('status.lastStatus')}</dt><dd>{displayTime(status?.lastStatusAt)}</dd></div>
          <div><dt>{t('status.lastRx')}</dt><dd>{displayTime(status?.lastRxAt)}</dd></div>
          <div><dt>{t('status.lastTx')}</dt><dd>{displayTime(status?.lastTxAt)}</dd></div>
          <div><dt>{t('status.sessions')}</dt><dd>{status?.sessions ?? '—'}</dd></div>
          <div><dt>{t('status.running')}</dt><dd>{status?.running ?? '—'}</dd></div>
          <div><dt>{t('status.waiting')}</dt><dd>{status?.waiting ?? '—'}</dd></div>
          <div><dt>{t('status.tokens')}</dt><dd>{status?.tokens ?? '—'}</dd></div>
        </dl>
        {status?.lastError && <p className="dsh_espBuddy_error"><strong>{t('status.error')}：</strong>{status.lastError}</p>}
        <div className="dsh_espBuddy_actions">
          <button type="button" disabled={!enabled || actionState === 'reconnecting'} onClick={() => { void handleReconnect() }}>
            {actionState === 'reconnecting' ? t('action.reconnecting') : t('action.reconnect')}
          </button>
          <button type="button" disabled={status === undefined || config === undefined} onClick={() => { void handleCopyDiagnostics() }}>
            {t('action.copyDiagnostics')}
          </button>
          {actionState !== 'idle' && actionState !== 'reconnecting' && (
            <span className={actionState === 'failed' ? 'dsh_espBuddy_actionState is-failed' : 'dsh_espBuddy_actionState'}>
              {t(actionState === 'reconnectStarted'
                ? 'action.reconnectStarted'
                : actionState === 'copied'
                  ? 'action.copied'
                  : 'action.failed')}
            </span>
          )}
        </div>
        <p className="dsh_espBuddy_actionHint">{t('action.copyHint')}</p>
      </div>

      <RolePackSection
        connected={status?.connected ?? false}
        enabled={enabled}
        progress={status?.rolePack ?? { phase: 'idle', sentBytes: 0, totalBytes: 0 }}
        installRolePack={installRolePack}
        t={t}
      />

      <div className="dsh_espBuddy_group">
        <div className="dsh_espBuddy_groupHeader">
          <h3>{t('config.title')}</h3>
          {saveState !== 'idle' && (
            <span className={saveState === 'failed' ? 'dsh_espBuddy_save is-failed' : 'dsh_espBuddy_save'}>
              {t(saveState === 'failed' ? 'config.failed' : 'config.saved')}
            </span>
          )}
        </div>
        <label className="dsh_espBuddy_field dsh_espBuddy_toggleField">
          <span><strong>{t('config.autoConnect')}</strong><small>{t('config.autoConnectDesc')}</small></span>
          <input
            type="checkbox"
            checked={config?.autoConnect ?? true}
            disabled={!enabled}
            onChange={event => { void write('autoConnect', event.target.checked) }}
          />
        </label>
        <label className="dsh_espBuddy_field">
          <span><strong>{t('config.devicePrefix')}</strong><small>{t('config.devicePrefixDesc')}</small></span>
          <input
            key={`prefix-${config?.deviceNamePrefix ?? 'Claude'}`}
            type="text"
            defaultValue={config?.deviceNamePrefix ?? 'Claude'}
            maxLength={32}
            disabled={!enabled}
            onBlur={event => {
              const value = event.target.value.trim()
              if (value.length > 0 && value !== config?.deviceNamePrefix) void write('deviceNamePrefix', value)
            }}
          />
        </label>
        <label className="dsh_espBuddy_field">
          <span><strong>{t('config.approvalTimeout')}</strong><small>{t('config.approvalTimeoutDesc')}</small></span>
          <input
            key={`approval-${config?.approvalTimeoutMs ?? 300_000}`}
            type="number"
            min={1}
            step={1}
            defaultValue={(config?.approvalTimeoutMs ?? 300_000) / 1_000}
            disabled={!enabled}
            onBlur={event => {
              const value = Math.max(1, Number(event.target.value)) * 1_000
              if (Number.isFinite(value) && value !== config?.approvalTimeoutMs) void write('approvalTimeoutMs', value)
            }}
          />
        </label>
        <label className="dsh_espBuddy_field">
          <span><strong>{t('config.heartbeat')}</strong><small>{t('config.heartbeatDesc')}</small></span>
          <input
            key={`heartbeat-${config?.heartbeatIntervalMs ?? 3_000}`}
            type="number"
            min={1}
            step={1}
            defaultValue={(config?.heartbeatIntervalMs ?? 3_000) / 1_000}
            disabled={!enabled}
            onBlur={event => {
              const value = Math.max(1, Number(event.target.value)) * 1_000
              if (Number.isFinite(value) && value !== config?.heartbeatIntervalMs) void write('heartbeatIntervalMs', value)
            }}
          />
        </label>
        <div className="dsh_espBuddy_field">
          <span><strong>{t('settings.manage')}</strong><small>{removeState === 'removed' ? t('settings.removed') : t('settings.manageDesc')}</small></span>
          <div className="dsh_espBuddy_actions">
            {removeState === 'confirming' && <button type="button" onClick={() => setRemoveState('idle')}>{t('settings.removeCancel')}</button>}
            <button
              type="button"
              className="dsh_espBuddy_removeButton"
              disabled={removeState === 'removing' || removeState === 'removed'}
              onClick={() => { void handleRemove() }}
            >
              {removeState === 'removing' ? t('settings.removing') : removeState === 'confirming' ? t('settings.removeConfirm') : t('settings.remove')}
            </button>
          </div>
        </div>
      </div>
          </div>
        </div>
      )}
    </li>
  )
}

export function EspBuddySettingsPage(props: EspBuddySettingsPageProps) {
  return <EspBuddySection {...props as unknown as EspBuddySectionProps} page />
}
