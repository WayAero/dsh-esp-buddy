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

test('diagnostics provide concise status, safe configuration, and actionable next steps', () => {
  const text = formatDiagnostics({ ...baseStatus, lastError: 'Buddy device not found' }, settings, '2026-08-22T10:00:00.000Z', '0.3.7')
  assert.match(text, /^ESP Buddy 诊断信息/m)
  assert.match(text, /生成时间 \(UTC\): 2026-08-22T10:00:00.000Z/)
  assert.match(text, /插件版本: 0.3.7/)
  assert.match(text, /连接状态: 未连接（尚未连接成功）/)
  assert.match(text, /最近错误: Buddy device not found/)
  assert.match(text, /设备名前缀: Claude/)
  assert.match(text, /确认 ESP32 已上电并处于可发现状态/)
  assert.match(text, /未包含会话内容、审批内容或角色包文件数据。/)
  assert.doesNotMatch(text, /"deviceNamePrefix"/)
})

test('remote contract exposes status, reconnect, role-pack install, and uninstall under one namespace', () => {
  assert.deepEqual(
    ESP_BUDDY_INVOCATIONS.map(invocation => `${invocation.namespace}/${invocation.method}`),
    ['espBuddy/status', 'espBuddy/reconnect', 'espBuddy/installRolePack', 'espBuddy/uninstall'],
  )
})
