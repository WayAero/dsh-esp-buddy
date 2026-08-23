import { useRef, useState } from 'react'

import type { RolePackProgress, RolePackWireFile } from '../contract.ts'
import type { EspBuddyKey } from './locales.ts'
import {
  encodeSelectedFiles,
  filesFromDrop,
  filesFromInput,
  validateSelectedFiles,
  type SelectedRolePackFile,
} from './role-pack-files.ts'

interface RolePackSectionProps {
  readonly connected: boolean
  readonly enabled: boolean
  readonly progress: RolePackProgress
  readonly installRolePack: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>
  readonly t: (key: EspBuddyKey) => string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 1024 * 100 ? 1 : 0)} KB`
}

export function RolePackSection({ connected, enabled, progress, installRolePack, t }: RolePackSectionProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selected, setSelected] = useState<readonly SelectedRolePackFile[]>([])
  const [selection, setSelection] = useState<{ name: string; totalBytes: number }>()
  const [error, setError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const active = progress.phase === 'validating' || progress.phase === 'sending' || progress.phase === 'installing'
  const percent = progress.totalBytes > 0 ? Math.min(100, Math.round(progress.sentBytes * 100 / progress.totalBytes)) : 0

  const select = async (files: readonly SelectedRolePackFile[]) => {
    try {
      const next = await validateSelectedFiles(files)
      setSelected(files)
      setSelection(next)
      setError(undefined)
    } catch (cause) {
      setSelected([])
      setSelection(undefined)
      setError((cause as Error).message)
    }
  }

  const upload = async () => {
    if (selected.length === 0) return
    setError(undefined)
    try {
      await installRolePack(await encodeSelectedFiles(selected))
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
      </div>
      <p className="dsh_espBuddy_groupDesc">{t('rolePack.description')}</p>
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
        <button type="button" disabled={active} onClick={() => inputRef.current?.click()}>{t('rolePack.choose')}</button>
      </div>

      {selection !== undefined && (
        <div className="dsh_espBuddy_packSummary">
          <span><strong>{selection.name}</strong><small>{selected.length} {t('rolePack.files')} · {formatBytes(selection.totalBytes)}</small></span>
          <button type="button" disabled={!enabled || !connected || active} onClick={() => { void upload() }}>{t('rolePack.send')}</button>
        </div>
      )}

      {progress.phase !== 'idle' && (
        <div className="dsh_espBuddy_progress" aria-label={phaseLabel}>
          <div><span>{progress.file ?? progress.packName ?? phaseLabel}</span><strong>{percent}%</strong></div>
          <i><b style={{ width: `${percent}%` }} /></i>
        </div>
      )}
      {active && <p className="dsh_espBuddy_packHint">{t('rolePack.waitHint')}</p>}
      {!connected && <p className="dsh_espBuddy_packHint">{t('rolePack.connectHint')}</p>}
      {(error ?? progress.error) && <p className="dsh_espBuddy_packError">{error ?? progress.error}</p>}
    </div>
  )
}
