import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { EspBuddyStatus, RolePackProgress, RolePackWireFile } from './contract.ts'

export class EspBuddyRuntime extends TypertRemoteService {
  private readonly readStatus: () => EspBuddyStatus
  private readonly reconnectTransport: () => Promise<EspBuddyStatus>
  private readonly installRolePackTransfer: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>
  private readonly cancelRolePackTransfer: () => RolePackProgress
  private readonly uninstallPlugin: () => Promise<void>

  constructor(
    ctx: Context,
    readStatus: () => EspBuddyStatus,
    reconnectTransport: () => Promise<EspBuddyStatus>,
    installRolePackTransfer: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>,
    cancelRolePackTransfer: () => RolePackProgress,
    uninstallPlugin: () => Promise<void>,
  ) {
    super(ctx, 'espBuddy')
    this.readStatus = readStatus
    this.reconnectTransport = reconnectTransport
    this.installRolePackTransfer = installRolePackTransfer
    this.cancelRolePackTransfer = cancelRolePackTransfer
    this.uninstallPlugin = uninstallPlugin
  }

  status(): EspBuddyStatus {
    return this.readStatus()
  }

  reconnect(): Promise<EspBuddyStatus> {
    return this.reconnectTransport()
  }

  installRolePack(files: readonly RolePackWireFile[]): Promise<RolePackProgress> {
    return this.installRolePackTransfer(files)
  }

  cancelRolePack(): RolePackProgress {
    return this.cancelRolePackTransfer()
  }

  async uninstall(): Promise<{ reloadRequired: true }> {
    await this.uninstallPlugin()
    return { reloadRequired: true }
  }
}
