import assert from 'node:assert/strict'
import test from 'node:test'

import type { EspBuddySettings, EspBuddyStatus } from '../src/contract.ts'
import { ESP_BUDDY_INVOCATIONS } from '../src/contract.ts'
import { connectionTone, formatDiagnostics } from '../src/client/model.ts'

const baseStatus: EspBuddyStatus = {
  enabled: true,
  autoConnect: true,
  helperState: 'running',
  connected: false,
  everConnected: false,
  sessions: 0,
  running: 0,
  waiting: 0,
  tokens: 0,
}

const settings: EspBuddySettings = {
  enabled: true,
  autoConnect: true,
  approvalTimeoutMs: 300_000,
  heartbeatIntervalMs: 3_000,
  deviceNamePrefix: 'Claude',
}

test('connection tone distinguishes initial, connected, failed, and later-disconnected states', () => {
  assert.equal(connectionTone(baseStatus), 'idle')
  assert.equal(connectionTone({ ...baseStatus, connected: true, everConnected: true }), 'connected')
  assert.equal(connectionTone({ ...baseStatus, lastError: 'device not found' }), 'error')
  assert.equal(connectionTone({ ...baseStatus, everConnected: true }), 'error')
  assert.equal(connectionTone(undefined, true), 'error')
})

test('diagnostics include status and non-secret settings in a stable text envelope', () => {
  const text = formatDiagnostics(baseStatus, settings, '2026-08-22T10:00:00.000Z')
  assert.match(text, /^dsh-esp-buddy diagnostics/m)
  assert.match(text, /generatedAt: 2026-08-22T10:00:00.000Z/)
  assert.match(text, /"deviceNamePrefix": "Claude"/)
  assert.match(text, /"everConnected": false/)
})

test('remote contract exposes status and reconnect under one namespace', () => {
  assert.deepEqual(
    ESP_BUDDY_INVOCATIONS.map(invocation => `${invocation.namespace}/${invocation.method}`),
    ['espBuddy/status', 'espBuddy/reconnect'],
  )
})
