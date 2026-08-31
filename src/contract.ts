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
  readonly phase: 'idle' | 'validating' | 'sending' | 'installing' | 'cancelling' | 'completed' | 'cancelled' | 'failed'
  readonly packName?: string
  readonly file?: string
  readonly sentBytes: number
  readonly totalBytes: number
  readonly protocolVersion?: 2
  readonly windowSize?: number
  readonly bytesPerSecond?: number
  readonly remainingMs?: number
  readonly fileIndex?: number
  readonly fileCount?: number
  readonly error?: string
}

export const rolePackProgressSchema = z.object({
  phase: z.enum(['idle', 'validating', 'sending', 'installing', 'cancelling', 'completed', 'cancelled', 'failed']),
  packName: z.string().optional(),
  file: z.string().optional(),
  sentBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  protocolVersion: z.literal(2).optional(),
  windowSize: z.number().int().min(1).max(4).optional(),
  bytesPerSecond: z.number().nonnegative().optional(),
  remainingMs: z.number().int().nonnegative().optional(),
  fileIndex: z.number().int().nonnegative().optional(),
  fileCount: z.number().int().positive().optional(),
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
  readonly lastInstalledRolePack?: string
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
  lastInstalledRolePack: z.string().optional(),
  sessions: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  tokens: z.number().nonnegative(),
}).readonly()

export const rolePackFilesSchema = z.array(z.object({
  path: z.string().min(1).max(64),
  data: z.string(),
}).readonly()).min(1)

export const pluginUninstallSchema = z.object({
  reloadRequired: z.literal(true),
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
  {
    id: 'dsh-esp-buddy#espBuddy/cancelRolePack',
    service: 'espBuddy',
    namespace: 'espBuddy',
    method: 'cancelRolePack',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-esp-buddy#RolePackProgress',
      schema: rolePackProgressSchema,
    },
  },
  {
    id: 'dsh-esp-buddy#espBuddy/uninstall',
    service: 'espBuddy',
    namespace: 'espBuddy',
    method: 'uninstall',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-esp-buddy#PluginUninstallResult',
      schema: pluginUninstallSchema,
    },
  },
]
