import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUDDY_STATE_PROTOCOL_VERSION,
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
  const snapshot = JSON.parse(serializeBuddyState(completeState, BUDDY_STATE_PROTOCOL_VERSION))

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

test('long official Chinese approval is transmitted verbatim without adding command fields', () => {
  const hint = '允许本次操作使用 danger-full-access 权限：这条一次性操作需要在完全权限下运行。它会检查工作区及其上级目录的 Windows 文件权限，仅在缺少权限的位置为当前登录用户补上完全控制项，并删除外来的应用包权限项。不修改任何文件内容和所有者，同时打印可撤销本次权限改动的恢复命令。'
  const snapshot = JSON.parse(serializeBuddyState({ ...completeState, prompt: { id: 'p_1', tool: 'pwsh', hint } }, 2))
  assert.deepEqual(snapshot.prompt, { id: 'p_1', tool: 'pwsh', hint })
})

test('hint byte boundaries preserve complete text or visibly mark a valid UTF-8 prefix', () => {
  const notice = '【说明未完整显示】\n'
  for (const hint of ['a'.repeat(1024), '测'.repeat(341), '😀'.repeat(256), '测'.repeat(341) + 'é', '😀'.repeat(257)]) {
    const snapshot = JSON.parse(serializeBuddyState({ ...completeState, prompt: { id: 'p_1', tool: 'pwsh', hint } }, 2))
    const output = snapshot.prompt.hint as string
    assert.ok(Buffer.byteLength(output) <= 1024)
    if (Buffer.byteLength(hint) <= 1024) assert.equal(output, hint)
    else {
      assert.ok(output.startsWith(notice))
      assert.ok(hint.startsWith(output.slice(notice.length)))
      assert.ok(!output.includes('\ufffd'))
    }
  }
})

test('JSON escape expansion reduces entries before approval text and preserves decision identity', () => {
  // 控制字符在 JSON 中膨胀为六字节转义；全部状态字段同时存在时检查整行预算。
  const entries = Array.from({ length: 8 }, () => '\u0001'.repeat(92))
  for (const hint of ['正常审批说明', '\u0001'.repeat(1024), '\"\\\n\t'.repeat(256)]) {
    const line = serializeBuddyState({ ...completeState, entries, prompt: { id: 'p_1', tool: 'pwsh', hint } }, 2)
    const snapshot = JSON.parse(line)
    assert.ok(Buffer.byteLength(line.slice(0, -1)) <= 4096)
    assert.equal(snapshot.prompt.id, 'p_1')
    assert.equal(snapshot.prompt.tool, 'pwsh')
    assert.equal(snapshot.waiting, completeState.waiting)
    assert.deepEqual(snapshot.usage, { input: 10, output: 20, cache_read: 30, cache_write: 40 })
    assert.ok(snapshot.entries.length < entries.length)
    assert.ok(Buffer.byteLength(snapshot.prompt.hint) <= 1024)
    if (hint === '正常审批说明' || hint.startsWith('"')) assert.equal(snapshot.prompt.hint, hint)
    else assert.ok(snapshot.prompt.hint.startsWith('【说明未完整显示】\n'))
    assert.equal(entries.length, 8)
  }
})

test('nonapproval overlong snapshots still report errors and a normal clear omits prompt', () => {
  const { prompt: _prompt, ...clearState } = completeState
  assert.equal(JSON.parse(serializeBuddyState(clearState, 2)).prompt, undefined)
  assert.throws(() => serializeBuddyState({ ...clearState, entries: Array.from({ length: 8 }, () => '\u0001'.repeat(92)) }, 2), BuddyProtocolError)
})

test('4096 serialized bytes fit without counting the trailing newline; an extra byte is reclaimed from entries', () => {
  const state: BuddyState = {
    total: 1, running: 0, waiting: 1, msg: 'approval', entries: [''], tokens: 0,
    prompt: { id: 'p_1', tool: 'pwsh', hint: '' },
  }
  const envelopeBytes = Buffer.byteLength(serializeBuddyState(state, 2).slice(0, -1))
  // 留约 50 字节给一个摘要项，以构造真正落在传输上限的消息。
  state.prompt!.hint = '\u0001'.repeat(Math.floor((4096 - envelopeBytes - 50) / 6))
  const baseline = serializeBuddyState(state, 2)
  const padding = 4096 - Buffer.byteLength(baseline.slice(0, -1))
  assert.ok(padding >= 0 && padding < BUDDY_LIMITS.entryBytes)
  const exact = serializeBuddyState({ ...state, entries: ['a'.repeat(padding)] }, 2)
  assert.equal(Buffer.byteLength(exact), 4097)
  assert.equal(JSON.parse(exact).prompt.hint, state.prompt!.hint)
  const over = serializeBuddyState({ ...state, entries: ['a'.repeat(padding + 1)] }, 2)
  assert.ok(Buffer.byteLength(over.slice(0, -1)) <= 4096)
  assert.deepEqual(JSON.parse(over).entries, [])
  assert.equal(JSON.parse(over).prompt.hint, state.prompt!.hint)
})
