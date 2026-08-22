import assert from 'node:assert/strict'
import test from 'node:test'

import { PromptScheduler } from '../src/approval/prompt-scheduler.ts'

const pending = (id: string) => ({ localId: id, prompt: { id, tool: 'bash', hint: '' } })

test('PromptScheduler keeps FIFO order when the current prompt resolves', () => {
  const scheduler = new PromptScheduler()
  scheduler.enqueue(pending('p_1') as never)
  scheduler.enqueue(pending('p_2') as never)
  scheduler.enqueue(pending('p_3') as never)

  assert.equal(scheduler.size, 3)
  assert.equal(scheduler.current()?.localId, 'p_1')
  scheduler.remove('p_1')
  assert.equal(scheduler.current()?.localId, 'p_2')
  scheduler.remove('p_2')
  assert.equal(scheduler.current()?.localId, 'p_3')
})
