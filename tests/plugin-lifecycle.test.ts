import assert from 'node:assert/strict'
import test from 'node:test'

import { Context, Service } from '@deepseek-ai/cordis'
import TimerService from '@deepseek-ai/cordis-plugin-timer'

import * as buddyPlugin from '../src/index.ts'

class MockAgents extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  list(): never[] {
    return []
  }
}

class MockSessions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  list(): never[] {
    return []
  }
}

class MockSessionProjections extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionProjections')
  }

  snapshot(): { asOfSeq: number; values: object } {
    return { asOfSeq: -1, values: {} }
  }

  onChanged(): () => void {
    return () => undefined
  }
}

class MockApproval extends Service {
  constructor(ctx: Context) {
    super(ctx, 'approval')
  }
}

class MockSettings extends Service {
  constructor(ctx: Context) {
    super(ctx, 'settings')
  }

  register(_namespace: string, schema: (value: unknown) => unknown, options?: { base?: unknown }) {
    const value = schema(options?.base ?? {})
    return {
      get: () => value,
      watch: () => () => undefined,
    }
  }
}

class MockTypert extends Service {
  constructor(ctx: Context) {
    super(ctx, 'typert')
  }

  register(): () => void {
    return () => undefined
  }
}

async function createContext(withSettings = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TimerService)
  await ctx.plugin(MockAgents)
  await ctx.plugin(MockSessions)
  await ctx.plugin(MockSessionProjections)
  await ctx.plugin(MockApproval)
  if (withSettings) await ctx.plugin(MockSettings)
  await ctx.plugin(MockTypert)
  return ctx
}

test('plugin remains active without an optional settings provider', async () => {
  const ctx = await createContext(false)
  const fiber = ctx.plugin(buddyPlugin, { enabled: false })
  await fiber

  assert.notEqual(fiber.uid, null)
  await fiber.dispose()
})

test('offline approvals delegate to Harness and unload cleanly', async () => {
  const ctx = await createContext()
  const approvalHooks = () => ctx.events._hooks['approval/request']?.length ?? 0
  const fiber = ctx.plugin(buddyPlugin, {
    enabled: true,
    autoConnect: false,
    approvalTimeoutMs: 300_000,
    heartbeatIntervalMs: 3_000,
    deviceNamePrefix: 'Claude',
  })
  await fiber

  assert.notEqual(fiber.uid, null)
  assert.equal(approvalHooks(), 1)

  const runtime = ctx.get('espBuddy') as {
    officialApprovals(sessionId: string): { id: string }[]
  }
  let delegated = 0
  const outcome = ctx.waterfall(
    'approval/request',
    { toolName: 'bash', agent: { session: { id: 'session-1' } } },
    async () => { delegated += 1; return 'allowed-once' },
  )
  const cards = runtime.officialApprovals('session-1')
  assert.deepEqual(cards, [])
  assert.equal(await outcome, 'allowed-once')
  assert.equal(delegated, 1)

  await fiber.update({
    enabled: true,
    autoConnect: false,
    approvalTimeoutMs: 300_000,
    heartbeatIntervalMs: 3_000,
    deviceNamePrefix: 'Claude',
  })
  await fiber.await()
  assert.equal(approvalHooks(), 1)

  await fiber.dispose()
  assert.equal(fiber.uid, null)
  assert.equal(approvalHooks(), 0)
})

test('disabled plugin has no active business effects', async () => {
  const ctx = await createContext()
  const fiber = ctx.plugin(buddyPlugin, { enabled: false })
  await fiber

  assert.notEqual(fiber.uid, null)
  await fiber.dispose()
})


test('framework intervals stop both on early cancellation and plugin disposal', async () => {
  const ctx = new Context()
  const timerFiber = ctx.plugin(TimerService)
  await timerFiber
  let ticks = 0
  let cancel: () => void
  const fiber = ctx.plugin({ inject: ['timer'], apply(scope: Context) {
    cancel = scope.interval(() => { ticks += 1 }, 2)
  } })
  await fiber
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(ticks > 0)
  cancel!()
  const stopped = ticks
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(ticks, stopped)
  await fiber.dispose()
  const second = ctx.plugin({ inject: ['timer'], apply(scope: Context) {
    scope.interval(() => { ticks += 1 }, 2)
  } })
  await second
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(ticks > stopped)
  await second.dispose()
  const disposed = ticks
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(ticks, disposed)
  await timerFiber.dispose()
})
