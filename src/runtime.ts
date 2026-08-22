import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { EspBuddyStatus } from './contract.ts'

export class EspBuddyRuntime extends TypertRemoteService {
  private readonly readStatus: () => EspBuddyStatus
  private readonly reconnectTransport: () => Promise<EspBuddyStatus>

  constructor(
    ctx: Context,
    readStatus: () => EspBuddyStatus,
    reconnectTransport: () => Promise<EspBuddyStatus>,
  ) {
    super(ctx, 'espBuddy')
    this.readStatus = readStatus
    this.reconnectTransport = reconnectTransport
  }

  status(): EspBuddyStatus {
    return this.readStatus()
  }

  reconnect(): Promise<EspBuddyStatus> {
    return this.reconnectTransport()
  }
}
