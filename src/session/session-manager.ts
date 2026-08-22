import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'

export interface SessionInfo {
  id: string
  running: boolean
  updatedAt: number
}

export interface SessionSummary {
  total: number
  running: number
  entries: string[]
}

export class SessionManager {
  private readonly ctx: Context
  private readonly onChanged: () => void
  private readonly sessions = new Map<string, SessionInfo>()
  private readonly disposeListeners: Array<() => unknown> = []
  private revision = 0

  constructor(ctx: Context, onChanged: () => void) {
    this.ctx = ctx
    this.onChanged = onChanged
  }

  start(): void {
    for (const session of this.ctx.sessions.list()) this.ensureSession(session)
    for (const agent of this.ctx.agents.list()) this.applyAgent(agent, agent.status)

    this.disposeListeners.push(
      this.ctx.on('session/created', session => {
        this.ensureSession(session)
        this.onChanged()
      }, { global: true }),
      this.ctx.on('session/disposed', session => {
        this.sessions.delete(session.id)
        this.onChanged()
      }, { global: true }),
      this.ctx.on('agent/created', ({ agent }) => {
        this.applyAgent(agent, agent.status)
        this.onChanged()
      }, { global: true }),
      this.ctx.on('agent/status', ({ agent, status }) => {
        this.applyAgent(agent, status)
        this.onChanged()
      }, { global: true }),
      this.ctx.on('agent/disposed', ({ agent }) => {
        const current = this.sessions.get(agent.session.id)
        if (current !== undefined) {
          current.running = false
          current.updatedAt = ++this.revision
        }
        this.onChanged()
      }, { global: true }),
    )

    this.onChanged()
  }

  summary(): SessionSummary {
    const values = [...this.sessions.values()]
    values.sort((left, right) => Number(right.running) - Number(left.running) || right.updatedAt - left.updatedAt)
    return {
      total: values.length,
      running: values.filter(session => session.running).length,
      entries: values.slice(0, 8).map(session => `${session.id.slice(0, 8)} ${session.running ? 'running' : 'idle'}`),
    }
  }

  dispose(): void {
    for (const dispose of this.disposeListeners.splice(0).reverse()) dispose()
    this.sessions.clear()
  }

  private ensureSession(session: Session): SessionInfo {
    const existing = this.sessions.get(session.id)
    if (existing !== undefined) return existing
    const created = { id: session.id, running: false, updatedAt: ++this.revision }
    this.sessions.set(session.id, created)
    return created
  }

  private applyAgent(agent: Agent, status: AgentStatus): void {
    const session = this.ensureSession(agent.session)
    session.running = status === 'running'
    session.updatedAt = ++this.revision
  }
}
