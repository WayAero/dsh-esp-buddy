import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-token-meter'

import { ApprovalManager } from './approval/approval-manager.ts'
import { Config, type Config as PluginConfig, type ResolvedConfig } from './config.ts'
import { parsePermissionReply, serializeBuddyState } from './protocol/buddy.ts'
import { ProjectionManager } from './projection/projection-manager.ts'
import { SessionManager } from './session/session-manager.ts'
import { BuddyStateStore } from './state/buddy-state.ts'
import { HelperProcessManager } from './transport/helper-process.ts'
import { resolveHelperLaunch } from './transport/launch.ts'

export const name = 'dsh-esp-buddy'
export const inject = ['agents', 'sessions', 'sessionProjections', 'approval']
export { Config }

function resolvedConfig(config: PluginConfig): ResolvedConfig {
  return {
    enabled: config.enabled ?? true,
    autoConnect: config.autoConnect ?? true,
    approvalTimeoutMs: config.approvalTimeoutMs ?? 300_000,
    heartbeatIntervalMs: config.heartbeatIntervalMs ?? 3_000,
    deviceNamePrefix: config.deviceNamePrefix ?? 'Claude',
  }
}

export function apply(ctx: Context, rawConfig: PluginConfig): void {
  const config = resolvedConfig(rawConfig)
  if (!config.enabled) return

  const state = new BuddyStateStore()
  let sessions!: SessionManager
  let projections!: ProjectionManager
  let approvals!: ApprovalManager
  const refresh = () => {
    if (sessions === undefined || projections === undefined || approvals === undefined) return
    const sessionSummary = sessions.summary()
    const projectionSummary = projections.summary()
    const approvalSummary = approvals.summary()
    state.update({
      ...sessionSummary,
      ...approvalSummary,
      prompt: approvalSummary.prompt,
      msg: approvalSummary.waiting > 0 ? 'approval' : sessionSummary.running > 0 ? 'working' : 'idle',
      tokens: projectionSummary.tokens,
      usage: projectionSummary.usage,
      context: projectionSummary.context,
      contextBreakdown: projectionSummary.contextBreakdown,
    })
  }

  sessions = new SessionManager(ctx, refresh)
  projections = new ProjectionManager(ctx, refresh)
  approvals = new ApprovalManager({ timeoutMs: config.approvalTimeoutMs, onChanged: refresh })
  sessions.start()
  projections.start()
  refresh()
  const initial = state.snapshot()
  console.info(`[dsh-esp-buddy] loaded: sessions=${initial.total} running=${initial.running}`)

  ctx.on('approval/request', async (
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> => approvals.handle(request, next), { global: true, prepend: true })

  let helper: HelperProcessManager | undefined
  let buddyConnected = false
  let stopHeartbeat: (() => void) | undefined
  let stopStateListener: (() => void) | undefined
  const sendSnapshot = () => {
    if (!buddyConnected || helper === undefined) return
    try {
      if (!helper.sendBuddyLine(serializeBuddyState(state.snapshot(), 1))) {
        console.warn('[dsh-esp-buddy] BLE Helper is not ready for snapshot tx')
      }
    } catch (error) {
      console.error(`[dsh-esp-buddy] snapshot serialization failed: ${(error as Error).message}`)
    }
  }

  if (config.autoConnect) {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url))
    const launch = resolveHelperLaunch(packageRoot)
    helper = new HelperProcessManager({
      executablePath: launch.executablePath,
      args: [...launch.args, '--device-name-prefix', config.deviceNamePrefix],
      cwd: launch.cwd,
      onEvent: event => {
        if (event.type === 'status') {
          if (buddyConnected !== event.connected) {
            const detail = event.connected && event.device ? ` device=${event.device}` : ''
            console.info(`[dsh-esp-buddy] BLE ${event.connected ? 'connected' : 'disconnected'}${detail}`)
          }
          buddyConnected = event.connected
          void approvals.setConnected(event.connected).then(() => {
            if (event.connected) sendSnapshot()
          })
          return
        }
        if (event.type === 'rx') {
          try {
            const reply = parsePermissionReply(event.line)
            if (!approvals.answer(reply)) console.warn(`[dsh-esp-buddy] ignored stale prompt reply id=${reply.id}`)
          } catch (error) {
            console.warn(`[dsh-esp-buddy] ignored malformed Buddy reply: ${(error as Error).message}`)
          }
          return
        }
        console.warn(`[dsh-esp-buddy] BLE Helper: ${event.message}`)
      },
      onLog: (level, message) => {
        if (level === 'error') console.error(`[dsh-esp-buddy] ${message}`)
        else if (level === 'warning') console.warn(`[dsh-esp-buddy] ${message}`)
        else console.info(`[dsh-esp-buddy] ${message}`)
      },
    })
    stopStateListener = state.onChanged(sendSnapshot)
    const heartbeat = setInterval(sendSnapshot, config.heartbeatIntervalMs)
    stopHeartbeat = () => clearInterval(heartbeat)
    helper.start()
  }

  ctx.effect(() => async () => {
      stopHeartbeat?.()
      stopStateListener?.()
      buddyConnected = false
      await helper?.stop()
      await approvals.dispose()
      projections.dispose()
      sessions.dispose()
      state.clear()
      console.info('[dsh-esp-buddy] unloaded')
    }, 'dsh-esp-buddy lifecycle')
}
