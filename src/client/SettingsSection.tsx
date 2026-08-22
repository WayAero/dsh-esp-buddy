import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

import type { EspBuddyStatus, EspBuddySettings } from '../contract.ts'

export interface EspBuddySectionInjected {
  hooks: { scope: SettingsScope<EspBuddySettings> }
  readStatus: () => Promise<EspBuddyStatus>
  setSetting: (field: keyof EspBuddySettings, value: boolean | number | string) => Promise<void>
}

export type EspBuddySectionProps = PropsRuntime<'settings.section'>
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

export function EspBuddySection({ useScope, readStatus, setSetting, t }: EspBuddySectionProps) {
  const config = useScope(snapshot => snapshot.value)
  const [status, setStatus] = useState<EspBuddyStatus>()
  const [statusError, setStatusError] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle')

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
  const connectionLabel = statusError
    ? t('status.unavailable')
    : status === undefined
      ? t('status.loading')
      : status.connected
        ? t('status.connected')
        : t('status.disconnected')

  return (
    <section className="dsh_espBuddy_section" aria-labelledby="dsh-esp-buddy-settings-title">
      <h2 id="dsh-esp-buddy-settings-title" className="dsh_espBuddy_title">{t('settings.title')}</h2>

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
          <span className={`dsh_espBuddy_connection ${status?.connected ? 'is-connected' : ''}`}>
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
      </div>

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
      </div>
    </section>
  )
}
