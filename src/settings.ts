import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'

import { readConfig, type Config, type ResolvedConfig } from './config.ts'

export interface EspBuddySettingsSource {
  get(): ResolvedConfig
  watch(callback: (next: ResolvedConfig, previous: ResolvedConfig) => void): () => void
}

export function installEspBuddySettings(
  ctx: Context,
  config: Config,
): EspBuddySettingsSource {
  let current = readConfig(config)
  const watchers = new Set<(next: ResolvedConfig, previous: ResolvedConfig) => void>()
  // rc.2 的 ConfigEditor 负责持久化 volatile 字段；这里只响应已生效的配置。
  ctx.on('loader/volatile-update', () => {
    const next = readConfig(config)
    if (Object.keys(next).every(key => next[key as keyof ResolvedConfig] === current[key as keyof ResolvedConfig])) return
    const previous = current
    current = next
    for (const watcher of watchers) watcher(next, previous)
  })

  return {
    get: () => current,
    watch(callback) {
      watchers.add(callback)
      return () => watchers.delete(callback)
    },
  }
}
