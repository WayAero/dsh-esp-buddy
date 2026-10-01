import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovalManager } from '../src/approval/approval-manager.ts'

const request = (toolName: string, signal?: AbortSignal) => ({
  agent: { session: { id: 'session-1' } },
  toolName,
  reason: `${toolName} reason`,
  signal,
})
const wait = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

test('offline approvals immediately delegate to Harness', async () => {
  const manager = new ApprovalManager({ timeoutMs: 100, onChanged: () => undefined })
  let delegated = 0
  const outcome = await manager.handle(request('bash') as never, async () => {
    delegated += 1
    return 'unavailable'
  })

  assert.equal(outcome, 'unavailable')
  assert.equal(delegated, 1)
  assert.equal(manager.summary().waiting, 0)
})
test('multiple approvals queue FIFO and accept only the first valid decision', async () => {
  const manager = new ApprovalManager({ timeoutMs: 1_000, onChanged: () => undefined })
  await manager.setConnected(true)

  const first = manager.handle(request('bash') as never, async () => 'unavailable')
  const second = manager.handle(request('write') as never, async () => 'unavailable')
  assert.equal(manager.summary().waiting, 2)
  assert.equal(manager.summary().prompt?.tool, 'bash')

  const firstId = manager.summary().prompt?.id as string
  assert.equal(manager.answer({ cmd: 'permission', id: firstId, decision: 'once' }), true)
  assert.equal(manager.answer({ cmd: 'permission', id: firstId, decision: 'deny' }), false)
  assert.equal(await first, 'allowed-once')
  assert.equal(manager.summary().prompt?.tool, 'write')

  const secondId = manager.summary().prompt?.id as string
  assert.equal(manager.answer({ cmd: 'permission', id: secondId, decision: 'deny' }), true)
  assert.equal(await second, 'rejected')
  assert.equal(manager.summary().waiting, 0)
})

test('disconnect delegates every intercepted approval without auto-rejecting', async () => {
  const manager = new ApprovalManager({ timeoutMs: 1_000, onChanged: () => undefined })
  await manager.setConnected(true)
  let delegated = 0
  const next = async () => {
    delegated += 1
    return 'unavailable' as const
  }
  const first = manager.handle(request('bash') as never, next)
  const second = manager.handle(request('write') as never, next)

  await manager.setConnected(false)
  assert.deepEqual(await Promise.all([first, second]), ['unavailable', 'unavailable'])
  assert.equal(delegated, 2)
  assert.equal(manager.summary().waiting, 0)
})

test('abort cancels a pending approval and stale hardware replies are ignored', async () => {
  const manager = new ApprovalManager({ timeoutMs: 1_000, onChanged: () => undefined })
  await manager.setConnected(true)
  const controller = new AbortController()
  const outcome = manager.handle(request('bash', controller.signal) as never, async () => 'unavailable')
  const id = manager.summary().prompt?.id as string

  controller.abort()
  assert.equal(await outcome, 'cancelled')
  assert.equal(manager.answer({ cmd: 'permission', id, decision: 'once' }), false)
})

test('timeout delegates to the next Harness answerer', async () => {
  const manager = new ApprovalManager({ timeoutMs: 5, onChanged: () => undefined })
  await manager.setConnected(true)
  const outcome = manager.handle(request('bash') as never, async () => 'unavailable')

  await wait(10)
  assert.equal(await outcome, 'unavailable')
  assert.equal(manager.summary().waiting, 0)
})

// 请求 ID 需满足固件长度限制，并隔离重启前设备迟到的回复。
test('request IDs fit the Buddy limit and do not repeat across manager restarts', async () => {
  const ids = new Set<string>()
  for (let index = 0; index < 20; index++) {
    const manager = new ApprovalManager({ timeoutMs: 1_000, onChanged: () => undefined })
    await manager.setConnected(true)
    const outcome = manager.handle(request('bash') as never, async () => 'unavailable')
    const id = manager.summary().prompt!.id
    assert.ok(Buffer.byteLength(id, 'utf8') < 40)
    assert.ok(!ids.has(id))
    ids.add(id)
    manager.answer({ cmd: 'permission', id, decision: 'once' })
    assert.equal(await outcome, 'allowed-once')
    await manager.dispose()
  }
})
