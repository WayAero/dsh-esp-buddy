import type { ApprovalMirror } from '../contract.ts'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'

/** 官方 PendingApproval 的公开字段及方法；不访问其私有状态或宿主 DOM。 */
export type OfficialApproval = Pick<PendingApproval,
  'kind' | 'sessionId' | 'key' | 'toolName' | 'callId' | 'reason' | 'answerable' | 'result' | 'answer' | 'abort' | 'delegate'>

export function isOfficialApproval(value: unknown): value is OfficialApproval {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<OfficialApproval>
  return item.kind === 'approval' && typeof item.answer === 'function' && typeof item.abort === 'function'
    && typeof item.delegate === 'function'
    && typeof item.result?.then === 'function'
}

export class OfficialApprovalSync {
  private readonly bindings = new WeakMap<OfficialApproval, string>()
  private readonly owned = new Set<OfficialApproval>()

  dispose(): void {
    // 卸载时不留下绑定到旧 Host 队列的卡片；官方消费者负责继续 next 并注销显示。
    for (const pending of this.owned) if (pending.answerable) pending.delegate()
    this.owned.clear()
  }

  async sync(pending: OfficialApproval, mirrors: readonly ApprovalMirror[]): Promise<void> {
    if (!pending.answerable) { this.owned.delete(pending); return }
    let id = this.bindings.get(pending)
    if (id === undefined) {
      const matches = mirrors.filter(item => item.sessionId === pending.sessionId
        && item.tool === pending.toolName && item.hint === (pending.reason ?? '')
        && item.callId === pending.callId)
      // Host 对相同身份串行转发；若契约被破坏，拒绝猜测并暴露错误。
      if (matches.length > 1) throw new Error('ambiguous official approval mirror')
      if (matches.length === 0) return
      id = matches[0].id
      this.bindings.set(pending, id)
      this.owned.add(pending)
      // 页面先答时，状态快照已移除该对象；通过结果清理引用，避免跨会话累积。
      void pending.result.then(() => this.owned.delete(pending), () => this.owned.delete(pending))
    }
    const outcome = mirrors.find(item => item.id === id)?.outcome
    if (outcome === 'allowed-once' || outcome === 'rejected') await pending.answer(outcome)
    else if (outcome !== undefined) pending.abort(new Error(`Buddy approval ended: ${outcome}`))
    if (!pending.answerable) this.owned.delete(pending)
  }
}
