import assert from 'node:assert/strict'
import test from 'node:test'

import { SessionManager } from '../src/session/session-manager.ts'

function fakeContext(initialSessions: object[] = [], initialAgents: object[] = []) {
  const listeners = new Map<string, Set<Function>>()
  return {
    sessions: { list: () => initialSessions },
    agents: { list: () => initialAgents },
    on(name: string, listener: Function) {
      const set = listeners.get(name) ?? new Set()
      set.add(listener)
      listeners.set(name, set)
      return () => set.delete(listener)
    },
    emit(name: string, payload: unknown) {
      for (const listener of listeners.get(name) ?? []) listener(payload)
    },
  }
}

const session = (id: string) => ({ id })
const agent = (id: string, status: 'idle' | 'running') => ({ id, status, session: session(id) })

test('SessionManager builds baseline and preserves B running when A becomes idle', () => {
  const a = agent('session-A', 'running')
  const b = agent('session-B', 'running')
  const ctx = fakeContext([a.session, b.session], [a, b])
  const manager = new SessionManager(ctx as never, () => undefined)
  manager.start()

  assert.deepEqual(manager.summary(), {
    total: 2,
    running: 2,
    entries: ['session- running', 'session- running'],
  })

  a.status = 'idle'
  ctx.emit('agent/status', { agent: a, status: 'idle' })
  assert.equal(manager.summary().running, 1)

  ctx.emit('session/disposed', b.session)
  assert.deepEqual(manager.summary(), {
    total: 1,
    running: 0,
    entries: ['session- idle'],
  })
})

test('SessionManager keeps a session running while any of its agents runs', () => {
  const shared = session('session-shared')
  const first = { id: 'agent-one', status: 'running' as const, session: shared }
  const second = { id: 'agent-two', status: 'running' as const, session: shared }
  const ctx = fakeContext([shared], [first, second])
  const manager = new SessionManager(ctx as never, () => undefined)
  manager.start()

  first.status = 'idle'
  ctx.emit('agent/status', { agent: first, status: 'idle' })
  assert.equal(manager.summary().running, 1)

  ctx.emit('agent/disposed', { agent: second })
  assert.equal(manager.summary().running, 0)
})
