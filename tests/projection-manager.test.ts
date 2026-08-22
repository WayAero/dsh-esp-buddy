import assert from 'node:assert/strict'
import test from 'node:test'

import { ProjectionManager } from '../src/projection/projection-manager.ts'

function fakeContext(snapshots: Map<string, Record<string, unknown>>) {
  const sessions = [...snapshots.keys()].map(id => ({ id }))
  const listeners = new Map<string, Set<Function>>()
  let projectionListener: Function | undefined
  return {
    sessions: { list: () => sessions },
    sessionProjections: {
      snapshot: (session: { id: string }) => ({ asOfSeq: 0, values: snapshots.get(session.id) ?? {} }),
      onChanged: (listener: Function) => {
        projectionListener = listener
        return () => { projectionListener = undefined }
      },
    },
    on(name: string, listener: Function) {
      const set = listeners.get(name) ?? new Set()
      set.add(listener)
      listeners.set(name, set)
      return () => set.delete(listener)
    },
    projection(session: object, key: string, value: unknown) {
      projectionListener?.(session, key, value, 1)
    },
  }
}

test('ProjectionManager aggregates disjoint usage buckets without reasoning duplication', () => {
  const snapshots = new Map([
    ['A', {
      tokenUsage: { uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
      contextPressure: { pressureTokens: 50, projectedTokens: 60, contextWindow: 1_000 },
    }],
    ['B', {
      tokenUsage: { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
    }],
  ])
  const ctx = fakeContext(snapshots)
  const manager = new ProjectionManager(ctx as never, () => undefined)
  manager.start()

  assert.deepEqual(manager.summary().usage, { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 })
  assert.equal(manager.summary().tokens, 110)

  const sessionB = { id: 'B' }
  ctx.projection(sessionB, 'contextPressure', { pressureTokens: 70, projectedTokens: 80, contextWindow: 2_000 })
  assert.deepEqual(manager.summary().context, { pressure: 70, projected: 80, window: 2_000 })
})
