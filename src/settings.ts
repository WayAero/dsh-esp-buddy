import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'

import { Config, type ResolvedConfig } from './config.ts'

export const ESP_BUDDY_NAMESPACE = settingsNamespace('esp-buddy')

export function registerEspBuddySettings(
  ctx: Context,
  base: ResolvedConfig,
): SettingsScope<ResolvedConfig> {
  return ctx.settings.register(
    ESP_BUDDY_NAMESPACE,
    Config as unknown as Schema<ResolvedConfig>,
    { base, applies: 'live' },
  )
}
