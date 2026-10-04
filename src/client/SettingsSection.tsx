import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Input, Switch, StateDot, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import type { EspBuddySettings, EspBuddyStatus, RolePackProgress, RolePackWireFile } from '../contract.ts'
import { connectionTone, formatDiagnostics, configNotice, inheritedConfigOps } from './model.ts'
import { RolePackSection } from './RolePackSection.tsx'
import { PLUGIN_VERSION } from './version.ts'

export interface EspBuddySectionInjected {
  settingsSource: ConfigForm<EspBuddySettings>
  readStatus: () => Promise<EspBuddyStatus>
  reconnect: () => Promise<EspBuddyStatus>
  installRolePack: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>
  cancelRolePack: () => Promise<RolePackProgress>
}

export type EspBuddySectionProps = PropsRuntime<'plugins.bundle.config'>
  & InjectFace<EspBuddySectionInjected>
  & PropsLocale<'esp-buddy'>

function displayTime(value?: string): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString()
}

/** 组合包入口不提供行配置，订阅官方共享表单；保存仍写入原 esp-buddy 命名空间。 */
export function EspBuddyConfigPage({ view, settingsSource, readStatus, reconnect, installRolePack, cancelRolePack, t }: EspBuddySectionProps) {
  const formState = useSyncExternalStore(
    useCallback(listener => settingsSource.subscribe(listener), [settingsSource]),
    useCallback(() => settingsSource.getSnapshot(), [settingsSource]),
  )
  const form = { state: formState, mutate: settingsSource.mutate.bind(settingsSource) }
  const accepted = formState.value
  const configMessage = configNotice(formState)
  const [draft, setDraft] = useState<EspBuddySettings>()
  const [revision, setRevision] = useState<number>()
  // 比较实际值，字段改回原值后立即禁用保存和放弃修改。
  const dirty = draft !== undefined && accepted !== undefined
    && (Object.keys(draft) as (keyof EspBuddySettings)[]).some(field => draft[field] !== accepted[field])
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
    setNotice(undefined)
  }
  const discard = () => {
    if (accepted === undefined) return
    setDraft({ ...accepted })
    setRevision(form?.state.revision)
    setNotice(undefined)
  }
  const save = async () => {
    if (!writable || !dirty || draft === undefined || revision === undefined) return
    setSaving(true)
    setNotice(undefined)
    try {
      const ops = (Object.keys(draft) as (keyof EspBuddySettings)[])
        .filter(field => draft[field] !== accepted?.[field])
        .map(field => ({ op: 'set' as const, path: [field], value: draft[field] }))
      if (ops.length === 0) {
        setRevision(form.state.revision)
        setDraft({ ...accepted! })
        setNotice(t('config.saved'))
        return
      }
      if (!await form.mutate(ops, revision)) throw new Error(t('config.failed'))
      // mutate 可能已推送新快照；一起清除草稿和 revision，确保重新建立可编辑状态。
      setDraft(undefined)
      setRevision(undefined)
      setNotice(t('config.saved'))
      await refresh()
    } catch (error) {
      setNotice(`${t('config.failed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }
  const restoreInheritance = async () => {
    if (!writable || revision === undefined) return
    setSaving(true)
    setNotice(undefined)
    try {
      // 使用草稿的 revision；并发变化时拒绝清除，保留用户草稿。
      const ops = inheritedConfigOps(formState.user)
      if (ops.length > 0 && !await form.mutate(ops, revision)) throw new Error(t('config.failed'))
      setDraft(undefined)
      setRevision(undefined)
      setNotice(t('config.inherited'))
      await refresh()
    } catch (error) {
      setNotice(`${t('config.failed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally { setSaving(false) }
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
      if (!await writeClipboard(formatDiagnostics(current, accepted, undefined, PLUGIN_VERSION))) {
        throw new Error(t('action.copyFailed'))
      }
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
        <span className={`dsh_espBuddy_connection is-${tone}`}><StateDot size={8} state={status === undefined && statusError === undefined ? 'ongoing' : tone === 'connected' ? 'done' : tone === 'error' ? 'error' : 'idle'} />{connectionLabel}</span>
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
        <Button variant="outline" disabled={!status?.enabled || reconnecting} onClick={() => { void handleReconnect() }}>{t(reconnecting ? 'action.reconnecting' : 'action.reconnect')}</Button>
        <Button variant="outline" disabled={accepted === undefined} onClick={() => { void copyDiagnostics() }}>{t('action.copyDiagnostics')}</Button>
      </div>
    </div>
    <RolePackSection connected={status?.connected ?? false} enabled={status?.enabled ?? false}
      progress={status?.rolePack ?? { phase: 'idle', sentBytes: 0, totalBytes: 0 }}
      lastInstalledRolePack={status?.lastInstalledRolePack} installRolePack={installRolePack} cancelRolePack={cancelRolePack} t={t} />
    <form className="dsh_espBuddy_group" onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="dsh_espBuddy_groupHeader"><h3>{t('config.title')}</h3></div>
      <div className="dsh_espBuddy_field dsh_espBuddy_toggleField">
        <span><strong>{t('settings.enabled')}</strong><small>{t('settings.enabledDesc')}</small></span>
        <Switch label={t('settings.enabled')} checked={draft?.enabled ?? false} disabled={!writable} onChange={checked => edit('enabled', checked)} />
      </div>
      <div className="dsh_espBuddy_field dsh_espBuddy_toggleField">
        <span><strong>{t('config.autoConnect')}</strong><small>{t('config.autoConnectDesc')}</small></span>
        <Switch label={t('config.autoConnect')} checked={draft?.autoConnect ?? false} disabled={!writable} onChange={checked => edit('autoConnect', checked)} />
      </div>
      <label className="dsh_espBuddy_field">
        <span><strong>{t('config.deviceAddress')}</strong><small>{t('config.deviceAddressDesc')}</small></span>
        <Input className="dsh_espBuddy_input" type="text" value={draft?.deviceAddress ?? ''} maxLength={36} disabled={!writable} onChange={event => edit('deviceAddress', event.target.value)} />
      </label>
      <label className="dsh_espBuddy_field">
        <span><strong>{t('config.approvalTimeout')}</strong><small>{t('config.approvalTimeoutDesc')}</small></span>
        <Input className="dsh_espBuddy_input" type="number" min={1} step={1} value={draft === undefined ? '' : draft.approvalTimeoutMs / 1_000} required disabled={!writable} onChange={event => edit('approvalTimeoutMs', Number(event.target.value) * 1_000)} />
      </label>
      <label className="dsh_espBuddy_field">
        <span><strong>{t('config.heartbeat')}</strong><small>{t('config.heartbeatDesc')}</small></span>
        <Input className="dsh_espBuddy_input" type="number" min={1} max={29} step={1} value={draft === undefined ? '' : draft.heartbeatIntervalMs / 1_000} required disabled={!writable} onChange={event => edit('heartbeatIntervalMs', Number(event.target.value) * 1_000)} />
      </label>
      <label className="dsh_espBuddy_field">
        <span><strong>{t('config.writeDelay')}</strong></span>
        <Input className="dsh_espBuddy_input" type="number" min={0} max={4} step={1} value={draft?.rolePackWriteDelayMs ?? ''} required disabled={!writable} onChange={event => edit('rolePackWriteDelayMs', Number(event.target.value))} />
      </label>
      <div className="dsh_espBuddy_configActions">
        <Button type="submit" variant="primary" disabled={!writable || !dirty}>{t('config.save')}</Button>
        <Button variant="outline" disabled={!writable || !dirty} onClick={discard}>{t('config.discard')}</Button>
        <Button variant="outline" disabled={!writable} onClick={() => { void restoreInheritance() }}>{t('config.restoreInheritance')}</Button>
      </div>
      {configMessage !== undefined && <p role="status" className={configMessage === 'config.loading' ? 'dsh_espBuddy_groupDesc' : 'dsh_espBuddy_error'}>{t(configMessage)}</p>}
    </form>
    {notice && <p role="status" className="dsh_espBuddy_groupDesc">{notice}</p>}
  </div>
}
