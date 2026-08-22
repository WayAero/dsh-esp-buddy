import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

import type { PermissionReply } from '../protocol/types.ts'
import { PromptScheduler } from './prompt-scheduler.ts'
import type { ApprovalSummary, PendingApproval } from './types.ts'

interface PendingRuntime {
  approval: PendingApproval
  resolve: (outcome: ApprovalOutcome) => void
  timeout?: NodeJS.Timeout
  abort?: () => void
  settled: boolean
}
export interface ApprovalManagerOptions {
  timeoutMs: number
  onChanged: () => void
  now?: () => number
}

export class ApprovalManager {
  private readonly scheduler = new PromptScheduler()
  private readonly runtimes = new Map<string, PendingRuntime>()
  private timeoutMs: number
  private readonly onChanged: () => void
  private readonly now: () => number
  private connected = false
  private nextId = 1
  private disposing = false

  constructor(options: ApprovalManagerOptions) {
    this.timeoutMs = options.timeoutMs
    this.onChanged = options.onChanged
    this.now = options.now ?? Date.now
  }

  isConnected(): boolean {
    return this.connected
  }

  setTimeoutMs(timeoutMs: number): void {
    this.timeoutMs = timeoutMs
  }

  async setConnected(connected: boolean): Promise<void> {
    if (this.connected === connected) return
    this.connected = connected
    if (!connected) {
      await Promise.all(this.scheduler.values().map(approval => this.delegate(approval.localId)))
    }
    this.onChanged()
  }

  async handle(
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    if (this.disposing || !this.connected) return next()
    if (request.signal?.aborted) return 'cancelled'

    const localId = this.allocateId()
    const approval: PendingApproval = {
      localId,
      sessionId: request.agent.session.id,
      request,
      prompt: {
        id: localId,
        tool: request.toolName,
        hint: request.reason ?? '',
      },
      createdAt: this.now(),
      next,
    }

    const outcome = new Promise<ApprovalOutcome>(resolve => {
      const runtime: PendingRuntime = { approval, resolve, settled: false }
      if (this.timeoutMs > 0) {
        runtime.timeout = setTimeout(() => {
          void this.delegate(localId)
        }, this.timeoutMs)
      }
      if (request.signal !== undefined) {
        const onAbort = () => this.settle(localId, 'cancelled')
        request.signal.addEventListener('abort', onAbort, { once: true })
        runtime.abort = () => request.signal?.removeEventListener('abort', onAbort)
      }
      this.runtimes.set(localId, runtime)
      this.scheduler.enqueue(approval)
      this.onChanged()
    })

    return outcome
  }

  answer(reply: PermissionReply): boolean {
    const runtime = this.runtimes.get(reply.id)
    if (runtime === undefined || runtime.settled) return false
    this.settle(reply.id, reply.decision === 'once' ? 'allowed-once' : 'rejected')
    return true
  }

  summary(): ApprovalSummary {
    const current = this.scheduler.current()
    return {
      waiting: this.scheduler.size,
      ...(current === undefined ? {} : { prompt: { ...current.prompt } }),
    }
  }

  async dispose(): Promise<void> {
    this.disposing = true
    this.connected = false
    await Promise.all(this.scheduler.values().map(approval => this.delegate(approval.localId)))
    this.scheduler.clear()
    this.runtimes.clear()
  }

  private allocateId(): string {
    for (let attempts = 0; attempts < Number.MAX_SAFE_INTEGER; attempts += 1) {
      const id = `p_${String(this.nextId).padStart(4, '0')}`
      this.nextId = this.nextId >= Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1
      if (!this.runtimes.has(id)) return id
    }
    throw new Error('no local prompt id available')
  }

  private settle(localId: string, outcome: ApprovalOutcome): boolean {
    const runtime = this.take(localId)
    if (runtime === undefined) return false
    runtime.resolve(outcome)
    this.onChanged()
    return true
  }

  private async delegate(localId: string): Promise<void> {
    const runtime = this.take(localId)
    if (runtime === undefined) return
    this.onChanged()
    try {
      runtime.resolve(await runtime.approval.next())
    } catch {
      runtime.resolve('unavailable')
    }
  }

  private take(localId: string): PendingRuntime | undefined {
    const runtime = this.runtimes.get(localId)
    if (runtime === undefined || runtime.settled) return undefined
    runtime.settled = true
    if (runtime.timeout !== undefined) clearTimeout(runtime.timeout)
    runtime.abort?.()
    this.runtimes.delete(localId)
    this.scheduler.remove(localId)
    return runtime
  }
}
