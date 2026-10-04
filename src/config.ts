import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

export interface Config {
  enabled: Volatile<boolean>
  autoConnect: Volatile<boolean>
  approvalTimeoutMs: Volatile<number>
  heartbeatIntervalMs: Volatile<number>
  deviceAddress: Volatile<string>
  rolePackWriteDelayMs: Volatile<number>
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  autoConnect: Schema.boolean().default(true).volatile(),
  approvalTimeoutMs: Schema.number().step(1).min(1_000).default(300_000).volatile(),
  heartbeatIntervalMs: Schema.number().step(1).min(1_000).max(29_000).default(3_000).volatile(),
  deviceAddress: Schema.string().max(36).default('').volatile(),
  rolePackWriteDelayMs: Schema.number().step(1).min(0).max(4).default(0).volatile(),
})

export interface ResolvedConfig {
  enabled: boolean
  autoConnect: boolean
  approvalTimeoutMs: number
  heartbeatIntervalMs: number
  deviceAddress: string
  rolePackWriteDelayMs: number
}

/** 读取同一时刻的动态配置，避免一次操作跨多个版本混用字段。 */
export function readConfig(config: Config): ResolvedConfig {
  return {
    enabled: config.enabled.get(),
    autoConnect: config.autoConnect.get(),
    approvalTimeoutMs: config.approvalTimeoutMs.get(),
    heartbeatIntervalMs: config.heartbeatIntervalMs.get(),
    deviceAddress: config.deviceAddress.get(),
    rolePackWriteDelayMs: config.rolePackWriteDelayMs.get(),
  }
}
