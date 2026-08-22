import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

import type { BuddyPrompt } from '../protocol/types.ts'

export interface PendingApproval {
  localId: string
  sessionId: string
  request: ApprovalRequest
  prompt: BuddyPrompt
  createdAt: number
  next: () => Promise<ApprovalOutcome>
}
export interface ApprovalSummary {
  waiting: number
  prompt?: BuddyPrompt
}
