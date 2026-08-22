import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

import type { ResolvedConfig } from './config.ts'
import type { HelperProcessState } from './transport/helper-process.ts'

export type EspBuddySettings = ResolvedConfig

export interface RolePackWireFile {
  readonly path: string
  readonly data: string
}

export interface RolePackProgress {
  readonly phase: 'idle' | 'validating' | 'sending' | 'installing' | 'completed' | 'failed'
  readonly packName?: string
  readonly file?: string
  readonly sentBytes: number
  readonly totalBytes: number
  readonly error?: string
}

export const rolePackProgressSchema = z.object({
  phase: z.enum(['idle', 'validating', 'sending', 'installing', 'completed', 'failed']),
  packName: z.string().optional(),
  file: z.string().optional(),
  sentBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  error: z.string().optional(),
}).readonly()

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
  readonly rolePack: RolePackProgress
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
  rolePack: rolePackProgressSchema,
  sessions: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  tokens: z.number().nonnegative(),
}).readonly()

export const rolePackFilesSchema = z.array(z.object({
  path: z.string().min(1).max(64),
  data: z.string(),
}).readonly()).min(1)

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
  {
    id: 'dsh-esp-buddy#espBuddy/installRolePack',
    service: 'espBuddy',
    namespace: 'espBuddy',
    method: 'installRolePack',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'files',
      wire: 'files',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-esp-buddy#RolePackWireFile[]',
        schema: rolePackFilesSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-esp-buddy#RolePackProgress',
      schema: rolePackProgressSchema,
    },
  },
]
