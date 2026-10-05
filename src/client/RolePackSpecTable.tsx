import type { EspBuddyKey } from './locales.ts'
import {
  GIF_MAX_DIMENSION, GIF_MAX_FRAMES, GIF_MAX_FPS, GIF_MAX_COLORS,
  ROLE_PACK_RECOMMENDED_FILE_BYTES, ROLE_PACK_RECOMMENDED_TOTAL_BYTES,
  specSeverity, type RolePackFileReport, type SpecSeverity,
} from '../role-pack/recommendations.ts'

const tone = (severity: SpecSeverity) => `dsh_espBuddy_spec-${severity}`
const numberText = (value: number | undefined) => value === undefined ? '—' : Number.isFinite(value) ? Number(value.toFixed(1)).toString() : '—'

export function RolePackSpecTable({ reports, t }: {
  readonly reports: readonly RolePackFileReport[]
  readonly t: (key: EspBuddyKey) => string
}) {
  const totalBytes = reports.reduce((sum, report) => sum + report.bytes, 0)
  const totalSeverity = specSeverity(totalBytes, ROLE_PACK_RECOMMENDED_TOTAL_BYTES)
  const headers: Array<[EspBuddyKey, string]> = [
    ['rolePack.spec.file', ''], ['rolePack.spec.dimension', `≤${GIF_MAX_DIMENSION}×${GIF_MAX_DIMENSION}`], ['rolePack.spec.frames', `≤${GIF_MAX_FRAMES}`],
    ['rolePack.spec.fps', `≈${GIF_MAX_FPS}`], ['rolePack.spec.colors', `≤${GIF_MAX_COLORS}`], ['rolePack.spec.size', `≤${ROLE_PACK_RECOMMENDED_FILE_BYTES / 1024} KiB`], ['rolePack.spec.result', ''],
  ]
  return <>
    <p className="dsh_espBuddy_specLegend">{t('rolePack.spec.legend')}</p>
    <div className="dsh_espBuddy_specScroll">
      <table className="dsh_espBuddy_specTable" aria-label={t('rolePack.spec.title')}>
        <thead><tr>{headers.map(([key, limit]) => <th scope="col" key={key}>{t(key)}{limit && <small>{limit}</small>}</th>)}</tr></thead>
        <tbody>{reports.map((report, index) => {
          const meta = report.metadata
          return <tr key={`${report.path}-${index}`}>
            <th scope="row"><span>{report.path}</span>{report.error && <small className={tone('invalid')}>{report.error}</small>}</th>
            <td className={tone(meta ? specSeverity(Math.max(meta.width, meta.height), GIF_MAX_DIMENSION) : 'normal')}>{meta ? `${meta.width}×${meta.height}` : '—'}</td>
            <td className={tone(meta ? specSeverity(meta.frames, GIF_MAX_FRAMES) : 'normal')}>{meta?.frames ?? '—'}</td>
            <td className={tone(report.fps !== undefined ? specSeverity(report.fps, GIF_MAX_FPS) : 'normal')}>{numberText(report.fps)}</td>
            <td className={tone(meta ? specSeverity(meta.colors, GIF_MAX_COLORS) : 'normal')}>{meta?.colors ?? '—'}</td>
            <td className={tone(specSeverity(report.bytes, ROLE_PACK_RECOMMENDED_FILE_BYTES))}>{(report.bytes / 1024).toFixed(1)} KiB</td>
            <td><span className={`dsh_espBuddy_specBadge ${tone(report.severity)}`}>{t(`rolePack.spec.${report.severity}`)}</span></td>
          </tr>
        })}</tbody>
        <tfoot><tr><th scope="row" colSpan={5}>{t('rolePack.spec.total')}<small>≤{ROLE_PACK_RECOMMENDED_TOTAL_BYTES / 1_000_000} MB</small></th>
          <td className={tone(totalSeverity)}>{(totalBytes / 1_000_000).toFixed(2)} MB</td>
          <td><span className={`dsh_espBuddy_specBadge ${tone(totalSeverity)}`}>{t(`rolePack.spec.${totalSeverity}`)}</span></td>
        </tr></tfoot>
      </table>
    </div>
  </>
}
