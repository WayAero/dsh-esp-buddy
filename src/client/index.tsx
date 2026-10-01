import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'

import { EspBuddyConfigPage, type EspBuddySectionInjected } from './SettingsSection.tsx'
import { NS, en, zh } from './locales.ts'
import { ESP_BUDDY_REMOTE } from './remote.ts'
import { adoptStyles } from './styles.ts'
import { isOfficialApproval, OfficialApprovalSync } from './official-approval.ts'

export const inject = ['remote', 'slots', 'locale', 'configForms']

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

export async function apply(ctx: Context): Promise<void> {
  ctx.effect(adoptStyles, 'dsh-esp-buddy: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-esp-buddy: dictionaries')

  const dispose = await ctx.remote.$mount(ESP_BUDDY_REMOTE)
  ctx.effect(() => dispose, 'dsh-esp-buddy: remote')
  const remote = ctx.get('remote.espBuddy') as TypertRemoteNamespaceMap['espBuddy'] | undefined
  if (remote === undefined) throw new Error('dsh-esp-buddy: the espBuddy Remote namespace did not mount')

  const configFace: EspBuddySectionInjected = {
    settingsSource: ctx.configForms.get<Record<string, unknown>>('esp-buddy'),
    readStatus: async () => unwrap(await remote.status()),
    reconnect: async () => unwrap(await remote.reconnect()),
    installRolePack: async files => unwrap(await remote.installRolePack(files)),
    cancelRolePack: async () => unwrap(await remote.cancelRolePack()),
  }
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'dsh-esp-buddy',
    locale: NS,
    inject: () => configFace,
  }, EspBuddyConfigPage))

  // 使用官方会话卡片的公开接口同步设备决定。
  ctx.inject(['uiSession'], scope => {
    const sync = new OfficialApprovalSync()
    scope.effect(() => {
      let active = true
      let running = false
      let failed = false
      const poll = async () => {
        if (!active || running) return
        running = true
        try {
          for (const status of scope.uiSession.sessionStatus.getSnapshot().values()) {
            const pending = status.pendingInteraction
            if (!isOfficialApproval(pending) || !pending.answerable) continue
            const mirrors = unwrap(await remote.officialApprovals(pending.sessionId))
            if (active) await sync.sync(pending, mirrors)
          }
          failed = false
        } catch (error) {
          if (!failed && active) console.error('[dsh-esp-buddy] official approval sync failed:', error)
          failed = true
        } finally { running = false }
      }
      // 订阅触发首次同步，轮询只处理已有官方卡片，不创建替代界面。
      const unsubscribe = scope.uiSession.sessionStatus.subscribe(() => { void poll() })
      const timer = setInterval(() => { void poll() }, 250)
      void poll()
      return () => { active = false; clearInterval(timer); unsubscribe(); sync.dispose() }
    }, 'dsh-esp-buddy: official approval sync')
  })
}
