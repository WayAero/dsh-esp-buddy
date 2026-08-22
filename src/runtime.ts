import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import type { EspBuddyStatus } from './contract.ts'

export class EspBuddyRuntime extends TypertRemoteService {
  private readonly readStatus: () => EspBuddyStatus

  constructor(
    ctx: Context,
    readStatus: () => EspBuddyStatus,
  ) {
    super(ctx, 'espBuddy')
    this.readStatus = readStatus
  }

  status(): EspBuddyStatus {
    return this.readStatus()
  }
}
