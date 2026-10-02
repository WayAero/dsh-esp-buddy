import assert from 'node:assert/strict'
import test from 'node:test'

import type { EspBuddySettings, EspBuddyStatus } from '../src/contract.ts'
import { ESP_BUDDY_INVOCATIONS } from '../src/contract.ts'
import { connectionTone, formatDiagnostics, configNotice, inheritedConfigOps } from '../src/client/model.ts'

test('configuration notices distinguish loading, unavailable, memory and read-only states', () => {
  assert.equal(configNotice({ status: 'loading', mode: 'host', writable: false }), 'config.loading')
  assert.equal(configNotice({ status: 'unavailable', mode: 'host', writable: false }), 'config.unavailable')
  assert.equal(configNotice({ status: 'unavailable', mode: 'memory', writable: false }), 'config.memory')
  assert.equal(configNotice({ status: 'ready', mode: 'host', writable: false }), 'config.readonly')
  assert.equal(configNotice({ status: 'ready', mode: 'host', writable: true }), undefined)
})

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
  rolePackWriteDelayMs: 0,
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

test('remote contract exposes status, role-pack transfer, and session approvals under one namespace', () => {
  assert.deepEqual(
    ESP_BUDDY_INVOCATIONS.map(invocation => `${invocation.namespace}/${invocation.method}`),
    ['espBuddy/officialApprovals', 'espBuddy/status', 'espBuddy/reconnect', 'espBuddy/installRolePack', 'espBuddy/cancelRolePack'],
  )
  for (const invocation of ESP_BUDDY_INVOCATIONS) {
    assert.equal(invocation.result.mode, 'strict')
    if (invocation.result.mode === 'strict') assert.equal(typeof invocation.result.create, 'function')
    for (const parameter of invocation.parameters) {
      if (parameter.codec.mode === 'strict') assert.equal(typeof parameter.codec.create, 'function')
    }
  }
  const pending = ESP_BUDDY_INVOCATIONS.find(invocation => invocation.method === 'officialApprovals')
  assert.equal(pending?.result.mode, 'strict')
  if (pending?.result.mode === 'strict') {
    const card = { id: 'p_0001', sessionId: 'session-a', tool: 'write', hint: 'example' }
    assert.deepEqual(pending.result.create().parse([card]), [card])
    assert.throws(() => pending.result.create().parse([{ ...card, sessionId: undefined }]))
  }
})


test('inheritance removes present known overrides including equal defaults, preserving unknown fields', () => {
  assert.deepEqual(inheritedConfigOps({ enabled: true, approvalTimeoutMs: 300000, future: 1 }), [
    { op: 'unset', path: ['enabled'] }, { op: 'unset', path: ['approvalTimeoutMs'] },
  ])
  assert.deepEqual(inheritedConfigOps(Object.create({ enabled: true })), [])
  for (const value of [undefined, null, [], 'invalid']) assert.deepEqual(inheritedConfigOps(value), [])
})
