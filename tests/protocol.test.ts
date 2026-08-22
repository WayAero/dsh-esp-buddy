import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUDDY_LIMITS,
  BuddyProtocolError,
  parsePermissionReply,
  serializeBuddyState,
} from '../src/protocol/buddy.ts'
import type { BuddyState } from '../src/protocol/types.ts'

const completeState: BuddyState = {
  total: 3,
  running: 1,
  waiting: 1,
  msg: 'working',
  entries: ['A running'],
  tokens: 18_450,
  prompt: { id: 'p_0001', tool: 'bash', hint: 'git push origin main' },
  usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
  context: { pressure: 100, projected: 120, window: 1_000 },
  contextBreakdown: { system: 1, tools: 2, messages: 3 },
}

test('V1 snapshot keeps mandatory ESP fields and uses zero for unavailable tokens_today', () => {
  const line = serializeBuddyState(completeState, 1)
  const snapshot = JSON.parse(line)

  assert.equal(line.endsWith('\n'), true)
  assert.deepEqual(snapshot.prompt, { id: 'p_0001', tool: 'bash', hint: 'git push origin main' })
  assert.equal(snapshot.tokens_today, 0)
  assert.equal(snapshot.protocol, undefined)
})
test('V2 extends V1 without removing compatibility fields', () => {
  const snapshot = JSON.parse(serializeBuddyState(completeState, 2))

  assert.equal(snapshot.protocol, 2)
  assert.equal(snapshot.source, 'deepseek-harness')
  assert.deepEqual(snapshot.usage, { input: 10, output: 20, cache_read: 30, cache_write: 40 })
  assert.equal(snapshot.total, 3)
  assert.equal(snapshot.tokens_today, 0)
})

test('serializer truncates UTF-8 fields at ESP byte limits', () => {
  const line = serializeBuddyState({
    ...completeState,
    msg: '测'.repeat(100),
    entries: Array.from({ length: 12 }, () => '界'.repeat(100)),
    prompt: { id: 'p_0001', tool: '工具'.repeat(20), hint: '提示'.repeat(40) },
  })
  const snapshot = JSON.parse(line)

  assert.equal(snapshot.entries.length, BUDDY_LIMITS.entryCount)
  assert.ok(Buffer.byteLength(snapshot.msg) <= BUDDY_LIMITS.messageBytes)
  assert.ok(Buffer.byteLength(snapshot.prompt.tool) <= BUDDY_LIMITS.promptToolBytes)
  assert.ok(Buffer.byteLength(snapshot.prompt.hint) <= BUDDY_LIMITS.promptHintBytes)
})

test('permission reply accepts only current prompt decisions', () => {
  assert.deepEqual(
    parsePermissionReply('{"cmd":"permission","id":"p_1","decision":"once"}'),
    { cmd: 'permission', id: 'p_1', decision: 'once' },
  )
  assert.throws(
    () => parsePermissionReply('{"cmd":"permission","id":"p_1","decision":"always"}'),
    BuddyProtocolError,
  )
})
