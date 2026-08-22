import type { EspBuddySettings, EspBuddyStatus } from '../contract.ts'

export type ConnectionTone = 'idle' | 'connected' | 'error'

export function connectionTone(status: EspBuddyStatus | undefined, statusUnavailable = false): ConnectionTone {
  if (statusUnavailable) return 'error'
  if (status?.connected) return 'connected'
  if (status?.everConnected || status?.lastError !== undefined || status?.helperState === 'blocked') return 'error'
  return 'idle'
}

export function formatDiagnostics(
  status: EspBuddyStatus,
  settings: EspBuddySettings,
  generatedAt = new Date().toISOString(),
): string {
  return [
    'dsh-esp-buddy diagnostics',
    `generatedAt: ${generatedAt}`,
    `status: ${JSON.stringify(status, null, 2)}`,
    `settings: ${JSON.stringify(settings, null, 2)}`,
  ].join('\n')
}
