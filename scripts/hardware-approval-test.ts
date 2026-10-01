import { Context, Service } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

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

// 实机脚本不启动 Web Remote，但 Host 插件仍需要 Typert 注册服务完成激活。
class MockTypert extends Service {
  constructor(ctx: Context) {
    super(ctx, 'typert')
  }

  register(): () => Promise<void> {
    return async () => undefined
  }
}

function waitForConnected(timeoutMs: number): { promise: Promise<void>; dispose: () => void } {
  const original = console.info
  let settled = false
  let resolveConnected!: () => void
  let rejectConnected!: (error: Error) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve
    rejectConnected = reject
  })
  const timeout = setTimeout(() => {
    if (!settled) rejectConnected(new Error('BLE connection timed out'))
  }, timeoutMs)

  console.info = (...args: unknown[]) => {
    original(...args)
    if (!settled && args.map(String).join(' ').includes('[dsh-esp-buddy] BLE connected')) {
      settled = true
      clearTimeout(timeout)
      resolveConnected()
    }
  }

  return {
    promise,
    dispose: () => {
      settled = true
      clearTimeout(timeout)
      console.info = original
    },
  }
}

function request(reason: string): ApprovalRequest {
  return {
    agent: { session: { id: 'hardware-approval-test' } },
    toolName: 'hardware-approval-test',
    callId: reason,
    reason,
  } as ApprovalRequest
}

async function ask(ctx: Context, reason: string): Promise<ApprovalOutcome> {
  console.log(`waiting_for_touch=${reason}`)
  return ctx.waterfall(
    'approval/request',
    request(reason),
    async () => 'unavailable',
  )
}

async function main(): Promise<void> {
  const ctx = new Context()
  await ctx.plugin(MockAgents)
  await ctx.plugin(MockSessions)
  await ctx.plugin(MockSessionProjections)
  await ctx.plugin(MockApproval)
  await ctx.plugin(MockTypert)

  const connected = waitForConnected(45_000)
  const fiber = ctx.plugin(buddyPlugin, {
    enabled: true,
    autoConnect: true,
    approvalTimeoutMs: 120_000,
    heartbeatIntervalMs: 3_000,
    deviceNamePrefix: 'Claude',
  })

  try {
    await fiber
    await connected.promise
    const once = await ask(ctx, 'Tap Allow Once')
    console.log(`allow_once_outcome=${once}`)
    const deny = await ask(ctx, 'Tap Deny')
    console.log(`deny_outcome=${deny}`)
    if (once !== 'allowed-once' || deny !== 'rejected') {
      throw new Error(`unexpected outcomes: once=${once} deny=${deny}`)
    }
  } finally {
    connected.dispose()
    await fiber.dispose()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
