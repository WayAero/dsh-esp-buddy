import { randomBytes } from 'node:crypto'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

import type { ApprovalMirror } from '../contract.ts'
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
  shareOfficialCards?: boolean
}

interface OfficialBranch {
  mirror: ApprovalMirror
  key: string
  started: boolean
  next: () => Promise<ApprovalOutcome>
  result: Promise<ApprovalOutcome>
  resolve: (outcome: ApprovalOutcome) => void
}

export class ApprovalManager {
  private readonly scheduler = new PromptScheduler()
  private readonly runtimes = new Map<string, PendingRuntime>()
  private timeoutMs: number
  private readonly onChanged: () => void
  private readonly now: () => number
  private connected = false
  private disposing = false
  private readonly shareOfficialCards: boolean
  private readonly official = new Map<string, OfficialBranch>()

  constructor(options: ApprovalManagerOptions) {
    this.timeoutMs = options.timeoutMs
    this.onChanged = options.onChanged
    this.now = options.now ?? Date.now
    this.shareOfficialCards = options.shareOfficialCards ?? false
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
      for (const approval of this.scheduler.values()) {
        void this.delegate(approval.localId)
      }
    }
    this.onChanged()
  }

  async handle(
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    if (this.disposing) return next()
    if (request.signal?.aborted) return 'cancelled'
    const sessionId = request.agent.session.id
    if (!this.connected) return next()

    const localId = this.allocateId()
    const branch = this.shareOfficialCards ? this.createOfficialBranch(localId, request, next) : undefined
    const approval: PendingApproval = {
      localId,
      sessionId,
      request,
      prompt: {
        id: localId,
        tool: request.toolName,
        // 设备采用官方中文说明；镜像仍保留原始 reason，避免改变官方卡片匹配身份。
        hint: [request.displayReason?.zh, request.displayReason?.en, request.reason]
          .find(text => text !== undefined && text.trim().length > 0)
          ?? '请在官方会话卡片查看审批原因',
      },
      createdAt: this.now(),
      next: branch === undefined ? next : () => branch.result,
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

    if (branch !== undefined) this.startOfficialBranch(branch.key)

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

  /** 只返回已转发的请求；相同显示身份一次只转发一个，避免无 callId 时误匹配。 */
  officialMirrors(sessionId: string): ApprovalMirror[] {
    return [...this.official.values()]
      .filter(branch => branch.started && branch.mirror.sessionId === sessionId)
      .map(branch => ({ ...branch.mirror }))
  }

  private createOfficialBranch(id: string, request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): OfficialBranch {
    let resolve!: (outcome: ApprovalOutcome) => void
    const result = new Promise<ApprovalOutcome>(complete => { resolve = complete })
    const mirror: ApprovalMirror = {
      id, sessionId: request.agent.session.id, tool: request.toolName,
      hint: request.reason ?? '',
      ...(request.callId === undefined ? {} : { callId: request.callId }),
    }
    const branch: OfficialBranch = {
      mirror, key: JSON.stringify([mirror.sessionId, mirror.tool, mirror.hint, mirror.callId ?? null]),
      started: false, next, result, resolve,
    }
    this.official.set(id, branch)
    return branch
  }

  private startOfficialBranch(key: string): void {
    const branches = [...this.official.values()].filter(branch => branch.key === key)
    if (branches.some(branch => branch.started)) return
    const branch = branches[0]
    if (branch === undefined) return
    branch.started = true
    // next 只调用一次。设备先答后保留镜像，直到官方卡片结算并退出应答链。
    void Promise.resolve().then(branch.next).catch(error => {
      if (branch.mirror.outcome === undefined) console.error('[dsh-esp-buddy] official approval answerer failed:', error)
      return 'unavailable' as const
    }).then(outcome => {
      branch.resolve(outcome)
      if (outcome !== 'unavailable') this.settle(branch.mirror.id, outcome)
      this.official.delete(branch.mirror.id)
      this.startOfficialBranch(key)
    })
  }

  async dispose(): Promise<void> {
    this.disposing = true
    this.connected = false
    this.delegateAll()
    this.scheduler.clear()
  }

  /** 先清除本插件的提示再继续应答链，卸载不等待用户在后续卡片上操作。 */
  delegateAll(): void {
    for (const approval of this.scheduler.values()) void this.delegate(approval.localId)
  }

  private allocateId(): string {
    for (let attempts = 0; attempts < Number.MAX_SAFE_INTEGER; attempts += 1) {
      // 34 个 ASCII 字节满足固件 40 字节上限，并避免重启后旧卡命中新请求。
      const id = `p_${randomBytes(16).toString('hex')}`
      if (!this.runtimes.has(id)) return id
    }
    throw new Error('no local prompt id available')
  }

  private settle(localId: string, outcome: ApprovalOutcome): boolean {
    const runtime = this.take(localId)
    if (runtime === undefined) return false
    const branch = this.official.get(localId)
    if (branch !== undefined) branch.mirror = { ...branch.mirror, outcome }
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
