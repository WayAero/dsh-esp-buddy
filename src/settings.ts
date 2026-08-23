import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

import { Config, type ResolvedConfig } from './config.ts'

export const ESP_BUDDY_NAMESPACE = settingsNamespace('esp-buddy')

export interface EspBuddySettingsSource {
  get(): ResolvedConfig
  watch(callback: (next: ResolvedConfig, previous: ResolvedConfig) => void): () => void
}

export function installEspBuddySettings(
  ctx: Context,
  base: ResolvedConfig,
): EspBuddySettingsSource {
  let source = () => base
  let current = base
  const watchers = new Set<(next: ResolvedConfig, previous: ResolvedConfig) => void>()
  const publish = () => {
    const previous = current
    current = source()
    if (current === previous) return
    for (const watcher of watchers) watcher(current, previous)
  }

  installSettingsSection(
    ctx,
    ESP_BUDDY_NAMESPACE,
    Config as unknown as Schema<ResolvedConfig>,
    base,
    {
      setSource: currentSource => { source = currentSource },
      onChange: publish,
    },
  )

  return {
    get: () => current,
    watch(callback) {
      watchers.add(callback)
      return () => watchers.delete(callback)
    },
  }
}
