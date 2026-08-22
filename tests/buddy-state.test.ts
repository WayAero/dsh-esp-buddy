import assert from 'node:assert/strict'
import test from 'node:test'

import { BuddyStateStore } from '../src/state/buddy-state.ts'

test('BuddyStateStore emits owned snapshots and does not expose mutable state', () => {
  const store = new BuddyStateStore()
  const observed: string[][] = []
  store.onChanged(state => observed.push([...state.entries]))

  const entries = ['A running']
  store.update({ total: 1, running: 1, entries })
  entries[0] = 'mutated outside'

  const snapshot = store.snapshot()
  snapshot.entries[0] = 'mutated snapshot'

  assert.deepEqual(observed, [['A running']])
  assert.deepEqual(store.snapshot().entries, ['A running'])
})
