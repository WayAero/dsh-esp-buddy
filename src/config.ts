import Schema from '@deepseek-ai/schemastery'

export interface Config {
  enabled?: boolean
  autoConnect?: boolean
  approvalTimeoutMs?: number
  heartbeatIntervalMs?: number
  deviceNamePrefix?: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  autoConnect: Schema.boolean().default(true),
  approvalTimeoutMs: Schema.number().step(1).min(1_000).default(300_000),
  heartbeatIntervalMs: Schema.number().step(1).min(1_000).default(3_000),
  deviceNamePrefix: Schema.string().default('Claude'),
})

export type ResolvedConfig = Required<Config>
