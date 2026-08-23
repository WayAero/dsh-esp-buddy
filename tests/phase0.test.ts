import assert from 'node:assert/strict'
import test from 'node:test'

import { Context, Service } from '@deepseek-ai/cordis'

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

test('plugin loads, delegates approval while offline, and unloads cleanly', async () => {
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

  const outcome = await ctx.waterfall(
    'approval/request',
    { toolName: 'bash' },
    async () => 'unavailable',
  )
  assert.equal(outcome, 'unavailable')

  await fiber.update({
    enabled: true,
    autoConnect: false,
    approvalTimeoutMs: 300_000,
    heartbeatIntervalMs: 3_000,
    deviceNamePrefix: 'Claude',
  })
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
