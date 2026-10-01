import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { ApprovalMirror, EspBuddyStatus, RolePackProgress, RolePackWireFile } from './contract.ts'

export class EspBuddyRuntime extends TypertRemoteService {
  private readonly readStatus: () => EspBuddyStatus
  private readonly reconnectTransport: () => Promise<EspBuddyStatus>
  private readonly installRolePackTransfer: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>
  private readonly cancelRolePackTransfer: () => RolePackProgress
  private readonly readOfficialApprovals: (sessionId: string) => ApprovalMirror[]

  constructor(
    ctx: Context,
    readStatus: () => EspBuddyStatus,
    reconnectTransport: () => Promise<EspBuddyStatus>,
    installRolePackTransfer: (files: readonly RolePackWireFile[]) => Promise<RolePackProgress>,
    cancelRolePackTransfer: () => RolePackProgress,
    readOfficialApprovals: (sessionId: string) => ApprovalMirror[] = () => [],
  ) {
    super(ctx, 'espBuddy')
    this.readStatus = readStatus
    this.reconnectTransport = reconnectTransport
    this.installRolePackTransfer = installRolePackTransfer
    this.cancelRolePackTransfer = cancelRolePackTransfer
    this.readOfficialApprovals = readOfficialApprovals
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

  officialApprovals(sessionId: string): ApprovalMirror[] {
    return this.readOfficialApprovals(sessionId).filter(item => item.sessionId === sessionId)
  }
}
