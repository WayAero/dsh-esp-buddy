import { useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

import type { RolePackProgress, RolePackWireFile } from '../contract.ts'
import type { EspBuddyKey } from './locales.ts'
import { readSkipRolePackWarning, saveSkipRolePackWarning } from './role-pack-warning.ts'
import { RolePackSpecTable } from './RolePackSpecTable.tsx'
import type { RolePackFileReport } from '../role-pack/recommendations.ts'
import {
  encodeSelectedFiles,
  filesFromDrop,
  filesFromInput,
  validateSelectedFiles,
  RolePackSelectionError,
  type SelectedRolePackFile,
} from './role-pack-files.ts'

interface RolePackSectionProps {
  readonly connected: boolean
  readonly enabled: boolean
  readonly progress: RolePackProgress
  readonly lastInstalledRolePack?: string
  readonly installRolePack: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>
  readonly cancelRolePack: () => Promise<RolePackProgress>
  readonly t: (key: EspBuddyKey) => string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  return `${(bytes / 1024).toFixed(bytes < 1024 * 100 ? 1 : 0)} KB`
}

function formatRate(bytesPerSecond: number | undefined): string {
  return bytesPerSecond === undefined ? '—' : `${formatBytes(bytesPerSecond)}/s`
}

function formatRemaining(remainingMs: number | undefined): string {
  if (remainingMs === undefined) return '—'
  const seconds = Math.ceil(remainingMs / 1_000)
  return seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`
}

export function RolePackSection({ connected, enabled, progress, lastInstalledRolePack, installRolePack, cancelRolePack, t }: RolePackSectionProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selectionVersion = useRef(0)
  const [selected, setSelected] = useState<readonly SelectedRolePackFile[]>([])
  const [selection, setSelection] = useState<{ name: string; totalBytes: number; warnings: string[]; reports: RolePackFileReport[] }>()
  const [invalidReports, setInvalidReports] = useState<readonly RolePackFileReport[]>()
  const [skipWarning, setSkipWarning] = useState(() => {
    try { return readSkipRolePackWarning(localStorage) }
    catch (cause) { console.warn('Unable to read role-pack warning preference', cause); return false }
  })
  const [showWarning, setShowWarning] = useState(false)
  const [dontRemind, setDontRemind] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const active = preparing || progress.phase === 'validating' || progress.phase === 'sending' || progress.phase === 'installing' || progress.phase === 'cancelling'
  const sending = progress.phase === 'sending'
  const percent = progress.totalBytes > 0 ? Math.min(100, Math.round(progress.sentBytes * 100 / progress.totalBytes)) : 0

  const select = async (files: readonly SelectedRolePackFile[]) => {
    if (active) return
    setShowWarning(false)
    setDontRemind(false)
    setSelected([])
    setSelection(undefined)
    setInvalidReports(undefined)
    const version = ++selectionVersion.current
    try {
      const next = await validateSelectedFiles(files)
      if (version !== selectionVersion.current) return
      setSelected(files)
      setSelection(next)
      setError(undefined)
    } catch (cause) {
      if (version !== selectionVersion.current) return
      setSelected([])
      setSelection(undefined)
      setError((cause as Error).message)
      if (cause instanceof RolePackSelectionError) setInvalidReports(cause.reports)
    }
  }

  const upload = async (confirmed = false) => {
    if (selected.length === 0 || active || !enabled || !connected) return
    if (!confirmed && !skipWarning && selection?.warnings.length) {
      setShowWarning(true)
      setDontRemind(false)
      return
    }
    if (confirmed && dontRemind) {
      try {
        saveSkipRolePackWarning(localStorage, true)
        setSkipWarning(true)
      } catch {
        setError(t('rolePack.preferenceFailed'))
        return
      }
    }
    setShowWarning(false)
    setPreparing(true)
    setError(undefined)
    try {
      await installRolePack(await encodeSelectedFiles(selected))
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setPreparing(false)
    }
  }

  const cancel = async () => {
    setError(undefined)
    try {
      await cancelRolePack()
    } catch (cause) {
      setError((cause as Error).message)
    }
  }

  const phaseLabel = t(`rolePack.phase.${progress.phase}` as EspBuddyKey)
  return (
    <div className="dsh_espBuddy_group">
      <div className="dsh_espBuddy_groupHeader">
        <h3>{t('rolePack.title')}</h3>
        {progress.phase !== 'idle' && <span className={`dsh_espBuddy_packPhase is-${progress.phase}`}>{phaseLabel}</span>}
        {active && !preparing && <Button variant="outline" size="sm" className="dsh_espBuddy_cancelPack" disabled={progress.phase === 'cancelling'} onClick={() => { void cancel() }}>{t('rolePack.cancel')}</Button>}
      </div>
      <p className="dsh_espBuddy_groupDesc">{t('rolePack.description')}</p>
      {skipWarning && <Button variant="outline" size="sm" onClick={() => {
        try { saveSkipRolePackWarning(localStorage, false); setSkipWarning(false); setError(undefined) }
        catch { setError(t('rolePack.preferenceFailed')) }
      }}>{t('rolePack.restoreWarning')}</Button>}
      <div
        className={`dsh_espBuddy_dropZone${dragging ? ' is-dragging' : ''}`}
        onDragEnter={event => { event.preventDefault(); setDragging(true) }}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          void filesFromDrop(event.dataTransfer.items).then(select, cause => setError((cause as Error).message))
        }}
      >
        <input
          ref={node => {
            inputRef.current = node
            node?.setAttribute('webkitdirectory', '')
          }}
          type="file"
          multiple
          hidden
          onChange={event => {
            if (event.target.files !== null) void select(filesFromInput(event.target.files))
            event.target.value = ''
          }}
        />
        <strong>{t('rolePack.dropTitle')}</strong>
        <span>{t('rolePack.dropDesc')}</span>
        <Button variant="outline" className="dsh_espBuddy_choosePack" disabled={active} onClick={() => inputRef.current?.click()}>{t('rolePack.choose')}</Button>
      </div>

      {selection !== undefined && (
        <div className="dsh_espBuddy_packSummary">
          <span><strong>{selection.name}</strong><small>{selected.length} {t('rolePack.files')} · {formatBytes(selection.totalBytes)}</small></span>
          <Button variant="primary" disabled={!enabled || !connected || active || showWarning} onClick={() => { void upload() }}>{t('rolePack.send')}</Button>
        </div>
      )}

      {(invalidReports !== undefined || (showWarning && selection !== undefined)) && (
        <div className="dsh_espBuddy_specWarning" role="alert">
          <strong>{t('rolePack.spec.title')}</strong>
          <p>{t(invalidReports ? 'rolePack.spec.invalidDesc' : 'rolePack.warningDesc')}</p>
          <RolePackSpecTable reports={invalidReports ?? selection!.reports} t={t} />
          {!invalidReports && <label><input type="checkbox" checked={dontRemind} onChange={event => setDontRemind(event.target.checked)} />{t('rolePack.dontRemind')}</label>}
          {!invalidReports && <div className="dsh_espBuddy_specActions">
            <Button variant="outline" onClick={() => setShowWarning(false)}>{t('rolePack.cancelSend')}</Button>
            <Button variant="primary" disabled={!enabled || !connected || active} onClick={() => { void upload(true) }}>{t('rolePack.continueSend')}</Button>
          </div>}
        </div>
      )}

      {progress.phase !== 'idle' && (
        <div className={`dsh_espBuddy_progress${sending ? ' is-sending' : ''}`} aria-label={phaseLabel}>
          <div><span>{progress.file ?? progress.packName ?? phaseLabel}</span><strong>{percent}%</strong></div>
          <i><b style={{ width: `${percent}%` }} /></i>
          <small>
            {t('rolePack.rate')}: {formatRate(progress.bytesPerSecond)} · {t('rolePack.remaining')}: {formatRemaining(progress.remainingMs)}
            {progress.fileCount !== undefined && <> · {t('rolePack.fileProgress')}: {progress.fileIndex ?? 0}/{progress.fileCount}</>}
          </small>
        </div>
      )}
      {lastInstalledRolePack !== undefined && <p className="dsh_espBuddy_packInstalled">{t('rolePack.lastInstalled')}: <strong>{lastInstalledRolePack}</strong></p>}
      {active && <p className="dsh_espBuddy_packHint">{t('rolePack.waitHint')}</p>}
      {!connected && <p className="dsh_espBuddy_packHint">{t('rolePack.connectHint')}</p>}
      {(error ?? progress.error) && <p className="dsh_espBuddy_packError">{error ?? progress.error}</p>}
    </div>
  )
}
