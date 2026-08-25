import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-typert-registry'

import { ApprovalManager } from './approval/approval-manager.ts'
import { Config, type Config as PluginConfig, type ResolvedConfig } from './config.ts'
import type { EspBuddyStatus, RolePackProgress, RolePackWireFile } from './contract.ts'
import { parsePermissionReply, serializeBuddyState } from './protocol/buddy.ts'
import { ProjectionManager } from './projection/projection-manager.ts'
import { CommandAckRouter } from './role-pack/command-ack.ts'
import { RolePackTransferManager } from './role-pack/transfer-manager.ts'
import { EspBuddyRuntime } from './runtime.ts'
import { SessionManager } from './session/session-manager.ts'
import { installEspBuddySettings } from './settings.ts'
import { BuddyStateStore } from './state/buddy-state.ts'
import { HelperProcessManager } from './transport/helper-process.ts'
import { resolveHelperLaunch } from './transport/launch.ts'
import { TYPERT_MANIFEST } from './typert.ts'

export const name = 'dsh-esp-buddy'
export const inject = ['agents', 'sessions', 'sessionProjections', 'approval', 'typert']
export { Config }

const execFileAsync = promisify(execFile)

async function uninstallFromCurrentProfile(): Promise<void> {
  const profile = process.env.DSH_PROFILE?.trim() || 'web'
  const command = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  try {
    await execFileAsync(command, ['plugin', '--profile', profile, 'remove', 'dsh-esp-buddy'], {
      windowsHide: true,
      timeout: 120_000,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to remove dsh-esp-buddy from profile "${profile}": ${detail}`)
  }
}

export function apply(ctx: Context, rawConfig: PluginConfig): void {
  // Cordis validates Config and fills its schema defaults before calling apply().
  const settings = installEspBuddySettings(ctx, rawConfig as ResolvedConfig)
  let activeConfig = settings.get()
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
  approvals = new ApprovalManager({ timeoutMs: activeConfig.approvalTimeoutMs, onChanged: refresh })
  sessions.start()
  projections.start()
  refresh()

  ctx.on('approval/request', async (
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> => {
    if (!settings.get().enabled) return next()
    return approvals.handle(request, next)
  }, { global: true, prepend: true })

  let helper: HelperProcessManager | undefined
  let buddyConnected = false
  let everConnected = false
  let buddyDevice: string | undefined
  let buddyMtu: number | undefined
  let lastStatusAt: string | undefined
  let lastRxAt: string | undefined
  let lastTxAt: string | undefined
  let lastError: string | undefined
  let rolePackProgress: RolePackProgress = { phase: 'idle', sentBytes: 0, totalBytes: 0 }
  let stopHeartbeat: (() => void) | undefined
  let stopStateListener: (() => void) | undefined

  const ackRouter = new CommandAckRouter()
  const rolePackTransfer = new RolePackTransferManager({
    ackRouter,
    isConnected: () => buddyConnected,
    sendReliable: line => helper?.sendBuddyLine(line, 'reliable') ?? false,
    onProgress: progress => { rolePackProgress = progress },
    onSettled: () => sendSnapshot(),
  })

  function sendSnapshot(): void {
    if (!buddyConnected || helper === undefined || rolePackTransfer.isActive()) return
    try {
      if (helper.sendBuddyLine(serializeBuddyState(state.snapshot(), 1))) {
        lastTxAt = new Date().toISOString()
      } else {
        console.warn('[dsh-esp-buddy] BLE Helper is not ready for snapshot tx')
      }
    } catch (error) {
      lastError = (error as Error).message
      console.error(`[dsh-esp-buddy] snapshot serialization failed: ${lastError}`)
    }
  }

  const clearTransportHooks = () => {
    stopHeartbeat?.()
    stopHeartbeat = undefined
    stopStateListener?.()
    stopStateListener = undefined
  }

  const startTransport = (config: ResolvedConfig, manual = false) => {
    if (helper !== undefined || !config.enabled || (!config.autoConnect && !manual)) return
    lastError = undefined
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
          if (!event.connected) ackRouter.disconnect()
          if (event.connected) everConnected = true
          buddyDevice = event.connected ? event.device : undefined
          buddyMtu = event.connected ? event.mtu : undefined
          if (event.connected) lastError = undefined
          lastStatusAt = new Date().toISOString()
          void approvals.setConnected(event.connected).then(() => {
            if (event.connected) sendSnapshot()
          })
          return
        }
        if (event.type === 'rx') {
          lastRxAt = new Date().toISOString()
          try {
            if (ackRouter.route(event.line)) return
            const reply = parsePermissionReply(event.line)
            if (!approvals.answer(reply)) console.warn(`[dsh-esp-buddy] ignored stale prompt reply id=${reply.id}`)
          } catch (error) {
            lastError = (error as Error).message
            console.warn(`[dsh-esp-buddy] ignored malformed Buddy reply: ${lastError}`)
          }
          return
        }
        lastError = event.message
        console.warn(`[dsh-esp-buddy] BLE Helper: ${event.message}`)
      },
      onLog: (level, message) => {
        if (level === 'error') {
          lastError = message
          console.error(`[dsh-esp-buddy] ${message}`)
        } else if (level === 'warning') {
          console.warn(`[dsh-esp-buddy] ${message}`)
        } else {
          console.info(`[dsh-esp-buddy] ${message}`)
        }
      },
    })
    stopStateListener = state.onChanged(sendSnapshot)
    const heartbeat = setInterval(sendSnapshot, config.heartbeatIntervalMs)
    stopHeartbeat = () => clearInterval(heartbeat)
    helper.start()
  }

  const stopTransport = async () => {
    clearTransportHooks()
    buddyConnected = false
    buddyDevice = undefined
    buddyMtu = undefined
    ackRouter.disconnect()
    await approvals.setConnected(false)
    const current = helper
    helper = undefined
    await current?.stop()
  }

  const restartTransport = async (config: ResolvedConfig, manual = false) => {
    await stopTransport()
    startTransport(config, manual)
  }

  let transportTail = Promise.resolve()
  const runTransport = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const run = transportTail.then(operation, operation)
    transportTail = run.then(() => undefined, () => undefined)
    return run
  }

  const readStatus = (): EspBuddyStatus => {
    const current = state.snapshot()
    return {
      enabled: activeConfig.enabled,
      autoConnect: activeConfig.autoConnect,
      helperState: helper?.getState() ?? 'stopped',
      connected: buddyConnected,
      everConnected,
      ...(buddyDevice === undefined ? {} : { device: buddyDevice }),
      ...(buddyMtu === undefined ? {} : { mtu: buddyMtu }),
      ...(lastStatusAt === undefined ? {} : { lastStatusAt }),
      ...(lastRxAt === undefined ? {} : { lastRxAt }),
      ...(lastTxAt === undefined ? {} : { lastTxAt }),
      ...(lastError === undefined ? {} : { lastError }),
      rolePack: rolePackProgress,
      sessions: current.total,
      running: current.running,
      waiting: current.waiting,
      tokens: current.tokens,
    }
  }

  const reconnectTransport = (): Promise<EspBuddyStatus> => runTransport(async () => {
    if (!activeConfig.enabled) throw new Error('ESP Buddy is disabled')
    if (rolePackTransfer.isActive()) throw new Error('A role pack is being transferred')
    await restartTransport(activeConfig, true)
    return readStatus()
  })
  const installRolePack = async (files: readonly RolePackWireFile[]): Promise<RolePackProgress> => {
    if (!activeConfig.enabled) throw new Error('ESP Buddy is disabled')
    return rolePackTransfer.install(files)
  }
  new EspBuddyRuntime(ctx, readStatus, reconnectTransport, installRolePack, uninstallFromCurrentProfile)
  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => { void dispose() }
  }, 'dsh-esp-buddy: typert manifest')

  const stopSettingsWatch = settings.watch((next, previous) => {
    activeConfig = next
    approvals.setTimeoutMs(next.approvalTimeoutMs)
    const needsRestart = helper !== undefined && (
      next.deviceNamePrefix !== previous.deviceNamePrefix
      || next.heartbeatIntervalMs !== previous.heartbeatIntervalMs
    )
    void runTransport(async () => {
      if (!next.enabled) await stopTransport()
      else if (next.autoConnect !== previous.autoConnect) {
        if (next.autoConnect) startTransport(next)
        else await stopTransport()
      } else if (!previous.enabled && next.enabled) {
        startTransport(next)
      } else if (needsRestart) {
        await restartTransport(next, true)
      }
    }).catch(error => {
      lastError = (error as Error).message
      console.error(`[dsh-esp-buddy] settings apply failed: ${lastError}`)
    })
  })

  startTransport(activeConfig)
  const initial = state.snapshot()
  console.info(`[dsh-esp-buddy] loaded: sessions=${initial.total} running=${initial.running}`)

  ctx.effect(() => async () => {
    stopSettingsWatch()
    await runTransport(stopTransport)
    await approvals.dispose()
    projections.dispose()
    sessions.dispose()
    state.clear()
    console.info('[dsh-esp-buddy] unloaded')
  }, 'dsh-esp-buddy lifecycle')
}
