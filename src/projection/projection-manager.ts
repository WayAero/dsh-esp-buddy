import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-token-meter'

import type { BuddyContext, BuddyContextBreakdown, BuddyUsage } from '../protocol/types.ts'

interface TokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface ContextPressureProjection {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

interface ContextBreakdownProjection {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

interface SessionProjectionState {
  tokenUsage?: TokenUsageProjection
  contextPressure?: ContextPressureProjection
  contextBreakdown?: ContextBreakdownProjection
  updatedAt: number
}

export interface ProjectionSummary {
  tokens: number
  usage: BuddyUsage
  context?: BuddyContext
  contextBreakdown?: BuddyContextBreakdown
}

function counter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined
}

function tokenUsage(value: unknown): TokenUsageProjection | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const uncachedInputTokens = counter(record.uncachedInputTokens)
  const outputTokens = counter(record.outputTokens)
  const cacheReadTokens = counter(record.cacheReadTokens)
  const cacheWriteTokens = counter(record.cacheWriteTokens)
  if ([uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens].includes(undefined)) return undefined
  return { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } as TokenUsageProjection
}

function contextPressure(value: unknown): ContextPressureProjection | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const pressureTokens = counter(record.pressureTokens)
  const projectedTokens = counter(record.projectedTokens)
  const contextWindow = counter(record.contextWindow)
  return {
    ...(pressureTokens === undefined ? {} : { pressureTokens }),
    ...(projectedTokens === undefined ? {} : { projectedTokens }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  }
}

function contextBreakdown(value: unknown): ContextBreakdownProjection | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const systemTokens = counter(record.systemTokens)
  const toolsTokens = counter(record.toolsTokens)
  const messageTokens = counter(record.messageTokens)
  if ([systemTokens, toolsTokens, messageTokens].includes(undefined)) return undefined
  return { systemTokens, toolsTokens, messageTokens } as ContextBreakdownProjection
}

export class ProjectionManager {
  private readonly ctx: Context
  private readonly onChanged: () => void
  private readonly sessions = new Map<string, SessionProjectionState>()
  private readonly disposeListeners: Array<() => unknown> = []
  private revision = 0

  constructor(ctx: Context, onChanged: () => void) {
    this.ctx = ctx
    this.onChanged = onChanged
  }

  start(): void {
    for (const session of this.ctx.sessions.list()) this.seed(session)

    this.disposeListeners.push(
      this.ctx.on('session/created', session => {
        this.seed(session)
        this.onChanged()
      }, { global: true }),
      this.ctx.on('session/disposed', session => {
        this.sessions.delete(session.id)
        this.onChanged()
      }, { global: true }),
      this.ctx.sessionProjections.onChanged((session, key, value) => {
        this.applyValue(session, key, value)
        this.onChanged()
      }),
    )

    this.onChanged()
  }

  summary(): ProjectionSummary {
    const states = [...this.sessions.values()]
    const usage: BuddyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    for (const state of states) {
      if (state.tokenUsage === undefined) continue
      usage.input += state.tokenUsage.uncachedInputTokens
      usage.output += state.tokenUsage.outputTokens
      usage.cacheRead += state.tokenUsage.cacheReadTokens
      usage.cacheWrite += state.tokenUsage.cacheWriteTokens
    }

    const latestContext = states
      .filter(state => state.contextPressure !== undefined || state.contextBreakdown !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]

    return {
      tokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
      usage,
      ...(latestContext?.contextPressure === undefined ? {} : {
        context: {
          pressure: latestContext.contextPressure.pressureTokens,
          projected: latestContext.contextPressure.projectedTokens,
          window: latestContext.contextPressure.contextWindow,
        },
      }),
      ...(latestContext?.contextBreakdown === undefined ? {} : {
        contextBreakdown: {
          system: latestContext.contextBreakdown.systemTokens,
          tools: latestContext.contextBreakdown.toolsTokens,
          messages: latestContext.contextBreakdown.messageTokens,
        },
      }),
    }
  }

  dispose(): void {
    for (const dispose of this.disposeListeners.splice(0).reverse()) dispose()
    this.sessions.clear()
  }

  private seed(session: Session): void {
    const snapshot = this.ctx.sessionProjections.snapshot(session)
    const state: SessionProjectionState = { updatedAt: ++this.revision }
    this.sessions.set(session.id, state)
    for (const [key, value] of Object.entries(snapshot.values)) this.applyValue(session, key, value)
  }

  private applyValue(session: Session, key: string, value: unknown): void {
    const state = this.sessions.get(session.id) ?? { updatedAt: 0 }
    if (key === 'tokenUsage') state.tokenUsage = tokenUsage(value)
    else if (key === 'contextPressure') state.contextPressure = contextPressure(value)
    else if (key === 'contextBreakdown') state.contextBreakdown = contextBreakdown(value)
    else return
    state.updatedAt = ++this.revision
    this.sessions.set(session.id, state)
  }
}
