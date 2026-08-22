import type { PendingApproval } from './types.ts'

export class PromptScheduler {
  private readonly pending = new Map<string, PendingApproval>()

  enqueue(approval: PendingApproval): void {
    if (this.pending.has(approval.localId)) throw new Error(`duplicate prompt id: ${approval.localId}`)
    this.pending.set(approval.localId, approval)
  }

  get(localId: string): PendingApproval | undefined {
    return this.pending.get(localId)
  }

  current(): PendingApproval | undefined {
    return this.pending.values().next().value
  }

  remove(localId: string): PendingApproval | undefined {
    const approval = this.pending.get(localId)
    this.pending.delete(localId)
    return approval
  }

  values(): PendingApproval[] {
    return [...this.pending.values()]
  }

  get size(): number {
    return this.pending.size
  }

  clear(): void {
    this.pending.clear()
  }
}
