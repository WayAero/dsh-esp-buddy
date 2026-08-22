import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

import type { ResolvedConfig } from './config.ts'
import type { HelperProcessState } from './transport/helper-process.ts'

export type EspBuddySettings = ResolvedConfig

export interface EspBuddyStatus {
  readonly enabled: boolean
  readonly autoConnect: boolean
  readonly helperState: HelperProcessState
  readonly connected: boolean
  readonly everConnected: boolean
  readonly device?: string
  readonly mtu?: number
  readonly lastStatusAt?: string
  readonly lastRxAt?: string
  readonly lastTxAt?: string
  readonly lastError?: string
  readonly sessions: number
  readonly running: number
  readonly waiting: number
  readonly tokens: number
}

export const espBuddyStatusSchema = z.object({
  enabled: z.boolean(),
  autoConnect: z.boolean(),
  helperState: z.enum(['stopped', 'starting', 'running', 'backoff', 'blocked']),
  connected: z.boolean(),
  everConnected: z.boolean(),
  device: z.string().optional(),
  mtu: z.number().int().min(23).optional(),
  lastStatusAt: z.string().optional(),
  lastRxAt: z.string().optional(),
  lastTxAt: z.string().optional(),
  lastError: z.string().optional(),
  sessions: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  tokens: z.number().nonnegative(),
}).readonly()

export const ESP_BUDDY_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-esp-buddy#espBuddy/status',
    service: 'espBuddy',
    namespace: 'espBuddy',
    method: 'status',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-esp-buddy#EspBuddyStatus',
      schema: espBuddyStatusSchema,
    },
  },
  {
    id: 'dsh-esp-buddy#espBuddy/reconnect',
    service: 'espBuddy',
    namespace: 'espBuddy',
    method: 'reconnect',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-esp-buddy#EspBuddyStatus',
      schema: espBuddyStatusSchema,
    },
  },
]
