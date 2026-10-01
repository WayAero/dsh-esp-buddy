import assert from 'node:assert/strict'
import test from 'node:test'
import { ApprovalManager } from '../src/approval/approval-manager.ts'
import { OfficialApprovalSync, type OfficialApproval } from '../src/client/official-approval.ts'

function fixture(toolName = 'bash', callId?: string) {
  const result = Promise.withResolvers<'allowed-once' | 'rejected'>()
  let answerable = true
  const pending: OfficialApproval = {
    kind: 'approval', key: 'official-key', sessionId: 'session-1', toolName, callId, reason: 'test',
    result: result.promise,
    get answerable() { return answerable },
    async answer(outcome) { assert.ok(answerable); answerable = false; result.resolve(outcome) },
    abort(reason) { answerable = false; result.reject(reason) },
    delegate() { answerable = false; result.reject(new Error('delegated')) },
  }
  const request = { agent: { session: { id: 'session-1' } }, toolName, callId, reason: 'test' }
  return { pending, request, result }
}

for (const decision of ['once', 'deny'] as const) {
  test(`Buddy ${decision} completes the official card and keeps one outcome`, async () => {
    const manager = new ApprovalManager({ timeoutMs: 1_000, shareOfficialCards: true, onChanged: () => {} })
    await manager.setConnected(true)
    const f = fixture()
    let forwarded = 0
    const outcome = manager.handle({ ...f.request, displayReason: { zh: '允许修改权限，保留文件内容', en: 'Allow permissions' } } as never,
      () => { forwarded++; return f.result.promise })
    await Promise.resolve()
    assert.equal(forwarded, 1)
    const id = manager.summary().prompt!.id
    assert.equal(manager.summary().prompt!.hint, '允许修改权限，保留文件内容')
    assert.equal(manager.answer({ cmd: 'permission', id, decision }), true)
    const expected = decision === 'once' ? 'allowed-once' : 'rejected'
    assert.equal(await outcome, expected)
    assert.equal(manager.summary().waiting, 0)
    const mirrors = manager.officialMirrors('session-1')
    assert.equal(mirrors[0].hint, f.pending.reason)
    assert.equal(mirrors[0].outcome, expected)
    await new OfficialApprovalSync().sync(f.pending, mirrors)
    assert.equal(await f.result.promise, expected)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(manager.officialMirrors('session-1'), [])
    assert.equal(manager.answer({ cmd: 'permission', id, decision: 'deny' }), false)
  })
}

test('official page wins, clears Buddy, and disconnect never invokes next twice', async () => {
  const manager = new ApprovalManager({ timeoutMs: 1_000, shareOfficialCards: true, onChanged: () => {} })
  await manager.setConnected(true)
  const f = fixture('bash', 'call-1')
  let forwarded = 0
  const outcome = manager.handle(f.request as never, () => { forwarded++; return f.result.promise })
  const id = manager.summary().prompt!.id
  await manager.setConnected(false)
  assert.equal(manager.summary().waiting, 0)
  await f.pending.answer('rejected')
  assert.equal(await outcome, 'rejected')
  assert.equal(forwarded, 1)
  assert.equal(manager.answer({ cmd: 'permission', id, decision: 'once' }), false)
})

test('identical requests without callId are presented sequentially and never cross-answer', async () => {
  const manager = new ApprovalManager({ timeoutMs: 1_000, shareOfficialCards: true, onChanged: () => {} })
  await manager.setConnected(true)
  const a = fixture(), b = fixture()
  let forwarded = 0
  const first = manager.handle(a.request as never, () => { forwarded++; return a.result.promise })
  const firstId = manager.summary().prompt!.id
  const second = manager.handle(b.request as never, () => { forwarded++; return b.result.promise })
  await Promise.resolve()
  assert.equal(forwarded, 1)
  manager.answer({ cmd: 'permission', id: firstId, decision: 'once' })
  manager.answer({ cmd: 'permission', id: manager.summary().prompt!.id, decision: 'deny' })
  assert.equal(await first, 'allowed-once')
  assert.equal(await second, 'rejected')
  const sync = new OfficialApprovalSync()
  await sync.sync(a.pending, manager.officialMirrors('session-1'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(forwarded, 2)
  await sync.sync(b.pending, manager.officialMirrors('session-1'))
  assert.equal(await a.result.promise, 'allowed-once')
  assert.equal(await b.result.promise, 'rejected')
})

test('no page answerer leaves the connected Buddy available', async () => {
  const manager = new ApprovalManager({ timeoutMs: 1_000, shareOfficialCards: true, onChanged: () => {} })
  await manager.setConnected(true)
  const f = fixture()
  const outcome = manager.handle(f.request as never, async () => 'unavailable')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(manager.summary().waiting, 1)
  manager.answer({ cmd: 'permission', id: manager.summary().prompt!.id, decision: 'once' })
  assert.equal(await outcome, 'allowed-once')
})

for (const decision of ['allowed-once', 'rejected'] as const) {
  test(`official page ${decision} clears an online Buddy before a late reply`, async () => {
    const manager = new ApprovalManager({ timeoutMs: 1_000, shareOfficialCards: true, onChanged: () => {} })
    await manager.setConnected(true)
    const f = fixture()
    const outcome = manager.handle(f.request as never, () => f.result.promise)
    const id = manager.summary().prompt!.id
    await f.pending.answer(decision)
    assert.equal(await outcome, decision)
    assert.equal(manager.summary().waiting, 0)
    assert.equal(manager.answer({ cmd: 'permission', id, decision: 'once' }), false)
  })
}

test('near-simultaneous contradictory answers keep the first Host decision', async () => {
  const manager = new ApprovalManager({ timeoutMs: 1_000, shareOfficialCards: true, onChanged: () => {} })
  await manager.setConnected(true)
  const f = fixture()
  const outcome = manager.handle(f.request as never, () => f.result.promise)
  manager.answer({ cmd: 'permission', id: manager.summary().prompt!.id, decision: 'once' })
  await f.pending.answer('rejected')
  assert.equal(await outcome, 'allowed-once')
  await new OfficialApprovalSync().sync(f.pending, manager.officialMirrors('session-1'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(manager.officialMirrors('session-1'), [])
})

test('sync cannot answer another session and teardown delegates bound cards', async () => {
  const f = fixture()
  const sync = new OfficialApprovalSync()
  await sync.sync(f.pending, [{ id: 'other', sessionId: 'session-2', tool: 'bash', hint: 'test', outcome: 'allowed-once' }])
  assert.equal(f.pending.answerable, true)
  await sync.sync(f.pending, [{ id: 'own', sessionId: 'session-1', tool: 'bash', hint: 'test' }])
  const failure = assert.rejects(f.result.promise, /delegated/)
  sync.dispose()
  await failure
  assert.equal(f.pending.answerable, false)
})

test('cancelled request clears the device and aborts its official card', async () => {
  const manager = new ApprovalManager({ timeoutMs: 1_000, shareOfficialCards: true, onChanged: () => {} })
  await manager.setConnected(true)
  const f = fixture()
  const controller = new AbortController()
  const outcome = manager.handle({ ...f.request, signal: controller.signal } as never, () => f.result.promise)
  controller.abort()
  assert.equal(await outcome, 'cancelled')
  const failure = assert.rejects(f.result.promise)
  await new OfficialApprovalSync().sync(f.pending, manager.officialMirrors('session-1'))
  await failure
  assert.equal(f.pending.answerable, false)
  assert.equal(manager.summary().waiting, 0)
})
