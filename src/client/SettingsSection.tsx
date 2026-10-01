import { useCallback, useEffect, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import type { EspBuddySettings, EspBuddyStatus, RolePackProgress, RolePackWireFile } from '../contract.ts'
import { connectionTone, formatDiagnostics } from './model.ts'
import { RolePackSection } from './RolePackSection.tsx'
import { PLUGIN_VERSION } from './version.ts'

export interface EspBuddySectionInjected {
  readStatus: () => Promise<EspBuddyStatus>
  reconnect: () => Promise<EspBuddyStatus>
  installRolePack: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>
  cancelRolePack: () => Promise<RolePackProgress>
}

export type EspBuddySectionProps = PropsRuntime<'plugins.row.config'>
  & InjectFace<EspBuddySectionInjected>
  & PropsLocale<'esp-buddy'>

function displayTime(value?: string): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString()
}

/** Plugins 页提供配置值与 revision；草稿只有点击保存后才提交。 */
export function EspBuddyConfigPage({ view, form, readStatus, reconnect, installRolePack, cancelRolePack, t }: EspBuddySectionProps) {
  const accepted = form?.state.value as EspBuddySettings | undefined
  const [draft, setDraft] = useState<EspBuddySettings>()
  const [revision, setRevision] = useState<number>()
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<EspBuddyStatus>()
  const [statusError, setStatusError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  // 未编辑时跟随 Host 快照；编辑期间保留原 revision，让 Host 拒绝并发覆盖。
  useEffect(() => {
    if (dirty || accepted === undefined) return
    if (revision !== undefined && form?.state.revision === revision) return
    setDraft({ ...accepted })
    setRevision(form?.state.revision)
  }, [accepted, dirty, form?.state.revision, revision])

  const refresh = useCallback(async () => {
    try {
      setStatus(await readStatus())
      setStatusError(undefined)
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error))
    }
  }, [readStatus])

  useEffect(() => {
    if (view !== 'page') return
    let active = true
    const run = async () => { if (active) await refresh() }
    void run()
    const timer = window.setInterval(() => { void run() }, 2_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [refresh, view])

  if (view === 'summary') return t('settings.description')
  const writable = form?.state.writable === true && draft !== undefined && !saving
  const edit = <K extends keyof EspBuddySettings>(field: K, value: EspBuddySettings[K]) => {
    setDraft(current => current === undefined ? current : { ...current, [field]: value })
    setDirty(true)
    setNotice(undefined)
  }
  const discard = () => {
    if (accepted === undefined) return
    setDraft({ ...accepted })
    setRevision(form?.state.revision)
    setDirty(false)
    setNotice(undefined)
  }
  const save = async () => {
    if (form === undefined || draft === undefined || revision === undefined) return
    setSaving(true)
    setNotice(undefined)
    try {
      const ops = (Object.keys(draft) as (keyof EspBuddySettings)[])
        .filter(field => draft[field] !== accepted?.[field])
        .map(field => ({ op: 'set' as const, path: [field], value: draft[field] }))
      if (ops.length === 0) {
        setRevision(form.state.revision)
        setDraft({ ...accepted! })
        setDirty(false)
        setNotice(t('config.saved'))
        return
      }
      if (!await form.mutate(ops, revision)) throw new Error(t('config.failed'))
      // 下次 owner 推送新快照时重新建立草稿，避免把旧 revision 用于第二次保存。
      setDraft(undefined)
      setDirty(false)
      setNotice(t('config.saved'))
      await refresh()
    } catch (error) {
      setNotice(`${t('config.failed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }
  const handleReconnect = async () => {
    setReconnecting(true)
    try {
      setStatus(await reconnect())
      setNotice(t('action.reconnectStarted'))
    } catch (error) {
      setNotice(`${t('action.failed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally { setReconnecting(false) }
  }
  const copyDiagnostics = async () => {
    if (accepted === undefined) return
    try {
      const current = await readStatus()
      await navigator.clipboard.writeText(formatDiagnostics(current, accepted, undefined, PLUGIN_VERSION))
      setNotice(t('action.copied'))
    } catch (error) {
      setNotice(`${t('action.failed')}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const tone = connectionTone(status, statusError !== undefined)
  const connectionLabel = statusError !== undefined ? t('status.unavailable')
    : status === undefined ? t('status.loading')
      : status.connected ? t('status.connected') : t('status.disconnected')

  return <div className="dsh_espBuddy_page dsh_espBuddy_section">
    <div className="dsh_espBuddy_group">
      <div className="dsh_espBuddy_groupHeader"><h3>{t('status.title')}</h3>
        <span className={`dsh_espBuddy_connection is-${tone}`}><i aria-hidden="true" />{connectionLabel}</span>
      </div>
      <dl className="dsh_espBuddy_statusGrid">
        <div><dt>{t('status.device')}</dt><dd>{status?.device ?? '—'}</dd></div>
        <div><dt>{t('status.mtu')}</dt><dd>{status?.mtu ?? '—'}</dd></div>
        <div><dt>{t('status.helper')}</dt><dd>{status === undefined ? '—' : t(`status.helper.${status.helperState}`)}</dd></div>
        <div><dt>{t('status.lastStatus')}</dt><dd>{displayTime(status?.lastStatusAt)}</dd></div>
        <div><dt>{t('status.lastRx')}</dt><dd>{displayTime(status?.lastRxAt)}</dd></div>
        <div><dt>{t('status.lastTx')}</dt><dd>{displayTime(status?.lastTxAt)}</dd></div>
        <div><dt>{t('status.sessions')}</dt><dd>{status?.sessions ?? '—'}</dd></div>
        <div><dt>{t('status.running')}</dt><dd>{status?.running ?? '—'}</dd></div>
        <div><dt>{t('status.waiting')}</dt><dd>{status?.waiting ?? '—'}</dd></div>
        <div><dt>{t('status.tokens')}</dt><dd>{status?.tokens ?? '—'}</dd></div>
      </dl>
      {(status?.lastError || statusError) && <p className="dsh_espBuddy_error">{status?.lastError ?? statusError}</p>}
      <div className="dsh_espBuddy_actions">
        <button type="button" disabled={!status?.enabled || reconnecting} onClick={() => { void handleReconnect() }}>{t(reconnecting ? 'action.reconnecting' : 'action.reconnect')}</button>
        <button type="button" disabled={accepted === undefined} onClick={() => { void copyDiagnostics() }}>{t('action.copyDiagnostics')}</button>
      </div>
    </div>
    <RolePackSection connected={status?.connected ?? false} enabled={status?.enabled ?? false}
      progress={status?.rolePack ?? { phase: 'idle', sentBytes: 0, totalBytes: 0 }}
      lastInstalledRolePack={status?.lastInstalledRolePack} installRolePack={installRolePack} cancelRolePack={cancelRolePack} t={t} />
    <form className="dsh_espBuddy_group" onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="dsh_espBuddy_groupHeader"><h3>{t('config.title')}</h3></div>
      <label className="dsh_espBuddy_field dsh_espBuddy_toggleField">
        <span><strong>{t('settings.enabled')}</strong><small>{t('settings.enabledDesc')}</small></span>
        <input type="checkbox" checked={draft?.enabled ?? false} disabled={!writable} onChange={event => edit('enabled', event.target.checked)} />
      </label>
      <label className="dsh_espBuddy_field dsh_espBuddy_toggleField">
        <span><strong>{t('config.autoConnect')}</strong><small>{t('config.autoConnectDesc')}</small></span>
        <input type="checkbox" checked={draft?.autoConnect ?? false} disabled={!writable} onChange={event => edit('autoConnect', event.target.checked)} />
      </label>
      <label className="dsh_espBuddy_field">
        <span><strong>{t('config.devicePrefix')}</strong><small>{t('config.devicePrefixDesc')}</small></span>
        <input type="text" value={draft?.deviceNamePrefix ?? ''} maxLength={32} required disabled={!writable} onChange={event => edit('deviceNamePrefix', event.target.value)} />
      </label>
      <label className="dsh_espBuddy_field">
        <span><strong>{t('config.approvalTimeout')}</strong><small>{t('config.approvalTimeoutDesc')}</small></span>
        <input type="number" min={1} step={1} value={draft === undefined ? '' : draft.approvalTimeoutMs / 1_000} required disabled={!writable} onChange={event => edit('approvalTimeoutMs', Number(event.target.value) * 1_000)} />
      </label>
      <label className="dsh_espBuddy_field">
        <span><strong>{t('config.heartbeat')}</strong><small>{t('config.heartbeatDesc')}</small></span>
        <input type="number" min={1} max={29} step={1} value={draft === undefined ? '' : draft.heartbeatIntervalMs / 1_000} required disabled={!writable} onChange={event => edit('heartbeatIntervalMs', Number(event.target.value) * 1_000)} />
      </label>
      <label className="dsh_espBuddy_field">
        <span><strong>{t('config.writeDelay')}</strong></span>
        <input type="number" min={0} max={4} step={1} value={draft?.rolePackWriteDelayMs ?? ''} required disabled={!writable} onChange={event => edit('rolePackWriteDelayMs', Number(event.target.value))} />
      </label>
      <div className="dsh_espBuddy_actions"><button type="submit" disabled={!writable}>{t('config.save')}</button>
        <button type="button" disabled={saving || accepted === undefined} onClick={discard}>{t('config.discard')}</button>
      </div>
      {form?.state.writable !== true && <p className="dsh_espBuddy_error">{t('config.unavailable')}</p>}
    </form>
    {notice && <p role="status" className="dsh_espBuddy_groupDesc">{notice}</p>}
  </div>
}
