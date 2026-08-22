import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import type { EspBuddySettings, EspBuddyStatus, RolePackProgress, RolePackWireFile } from '../contract.ts'
import { EspBuddySection, type EspBuddySectionInjected } from './SettingsSection.tsx'
import { NS, en, zh } from './locales.ts'
import { ESP_BUDDY_REMOTE } from './remote.ts'
import { adoptStyles } from './styles.ts'

export const inject = ['remote', 'slots', 'locale', 'settingsScope']

interface EspBuddyNamespaceFace {
  status(): Promise<{ ok: true; value: EspBuddyStatus } | { ok: false; error: { code: string; message: string; details: object } }>
  reconnect(): Promise<{ ok: true; value: EspBuddyStatus } | { ok: false; error: { code: string; message: string; details: object } }>
  installRolePack(files: readonly RolePackWireFile[]): Promise<{ ok: true; value: RolePackProgress } | { ok: false; error: { code: string; message: string; details: object } }>
}

export function apply(ctx: ClientContext): void {
  adoptStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-esp-buddy: dictionaries')

  let remote: EspBuddyNamespaceFace | undefined
  ctx.effect(async () => {
    const dispose = await ctx.remote.$mount(ESP_BUDDY_REMOTE)
    remote = (ctx.reflect as unknown as { get(name: string): unknown }).get('remote.espBuddy') as EspBuddyNamespaceFace | undefined
    if (remote === undefined) throw new Error('dsh-esp-buddy: the espBuddy Remote namespace did not mount')
    return () => {
      remote = undefined
      void dispose()
    }
  }, 'dsh-esp-buddy: remote')

  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind<EspBuddySettings>({ namespace: 'esp-buddy' })
  const readStatus = async (): Promise<EspBuddyStatus> => {
    if (remote === undefined) throw new Error('dsh-esp-buddy: status service is not mounted')
    const result = await remote.status()
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const reconnect = async (): Promise<EspBuddyStatus> => {
    if (remote === undefined) throw new Error('dsh-esp-buddy: status service is not mounted')
    const result = await remote.reconnect()
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const installRolePack = async (files: readonly RolePackWireFile[]): Promise<RolePackProgress> => {
    if (remote === undefined) throw new Error('dsh-esp-buddy: role-pack service is not mounted')
    const result = await remote.installRolePack(files)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'esp-buddy',
    order: 56,
    label: () => t('nav'),
    locale: NS,
    inject: (): EspBuddySectionInjected => ({
      hooks: { scope },
      readStatus,
      reconnect,
      installRolePack,
      setSetting: async (field, value) => { await scope.set(field, value) },
    }),
  }, EspBuddySection))
}
