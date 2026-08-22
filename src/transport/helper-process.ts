import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import {
  encodeHelperCommand,
  JsonLineDecoder,
  parseHelperEvent,
  type HelperEvent,
} from './helper-protocol.ts'

export interface HelperProcessOptions {
  executablePath: string
  args?: string[]
  cwd?: string
  restartBaseMs?: number
  restartMaxMs?: number
  crashWindowMs?: number
  maxCrashes?: number
  stopGraceMs?: number
  spawnProcess?: typeof spawn
  onEvent?: (event: HelperEvent) => void
  onLog?: (level: 'info' | 'warning' | 'error', message: string) => void
}

export type HelperProcessState = 'stopped' | 'starting' | 'running' | 'backoff' | 'blocked'

export class HelperProcessManager {
  private readonly options: HelperProcessOptions
  private child?: ChildProcessWithoutNullStreams
  private state: HelperProcessState = 'stopped'
  private stopping = false
  private restartTimer?: NodeJS.Timeout
  private restartAttempt = 0
  private readonly crashes: number[] = []

  constructor(options: HelperProcessOptions) {
    this.options = options
  }

  getState(): HelperProcessState {
    return this.state
  }

  start(): void {
    if (this.child !== undefined || this.restartTimer !== undefined) return
    this.stopping = false
    this.spawnNow()
  }

  sendBuddyLine(line: string): boolean {
    if (this.child === undefined || this.state !== 'running' || !this.child.stdin.writable) return false
    this.child.stdin.write(encodeHelperCommand({ type: 'tx', line }), 'utf8')
    return true
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }

    const child = this.child
    if (child === undefined) {
      this.state = 'stopped'
      return
    }

    const exited = new Promise<void>(resolve => {
      child.once('exit', () => resolve())
      child.once('close', () => resolve())
    })
    if (child.stdin.writable) child.stdin.write(encodeHelperCommand({ type: 'stop' }), 'utf8')

    const graceMs = this.options.stopGraceMs ?? 2_000
    let timer: NodeJS.Timeout | undefined
    const grace = new Promise<void>(resolve => {
      timer = setTimeout(resolve, graceMs)
    })
    await Promise.race([exited, grace])
    if (timer !== undefined) clearTimeout(timer)

    if (this.child === child) {
      child.kill()
      await exited
    }
    this.state = 'stopped'
  }

  private spawnNow(): void {
    this.state = 'starting'
    const spawnProcess = this.options.spawnProcess ?? spawn
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnProcess(
        this.options.executablePath,
        this.options.args ?? [],
        {
          cwd: this.options.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      ) as ChildProcessWithoutNullStreams
    } catch (error) {
      this.log('error', `BLE Helper spawn failed: ${(error as Error).message}`)
      this.scheduleRestart()
      return
    }
    this.child = child

    const decoder = new JsonLineDecoder()
    let exitHandled = false

    child.stdout.on('data', chunk => {
      try {
        for (const line of decoder.push(chunk)) {
          if (line.length === 0) continue
          const event = parseHelperEvent(line)
          if (event.type === 'status' && event.connected) this.restartAttempt = 0
          this.options.onEvent?.(event)
        }
      } catch (error) {
        this.log('error', (error as Error).message)
      }
    })

    child.stderr.on('data', chunk => {
      const message = String(chunk).trimEnd()
      if (message.length > 0) this.log('warning', message)
    })

    child.once('spawn', () => {
      if (this.child !== child) return
      this.state = 'running'
      this.log('info', `BLE Helper started pid=${child.pid ?? 'unknown'}`)
    })

    child.once('error', error => {
      this.log('error', `BLE Helper process error: ${error.message}`)
    })

    const terminated = (code: number | null, signal: NodeJS.Signals | null) => {
      if (exitHandled) return
      exitHandled = true
      if (this.child === child) this.child = undefined
      decoder.reset()
      this.options.onEvent?.({ type: 'status', connected: false })

      if (this.stopping) {
        this.state = 'stopped'
        return
      }
      this.log('warning', `BLE Helper exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
      this.scheduleRestart()
    }
    child.once('exit', terminated)
    child.once('close', terminated)
  }

  private scheduleRestart(): void {
    const now = Date.now()
    const crashWindowMs = this.options.crashWindowMs ?? 60_000
    const maxCrashes = this.options.maxCrashes ?? 5
    this.crashes.push(now)
    while ((this.crashes[0] ?? now) < now - crashWindowMs) this.crashes.shift()

    if (this.crashes.length > maxCrashes) {
      this.state = 'blocked'
      this.log('error', `BLE Helper restart blocked after ${this.crashes.length} crashes`)
      return
    }

    const base = this.options.restartBaseMs ?? 500
    const max = this.options.restartMaxMs ?? 30_000
    const delay = Math.min(max, base * (2 ** this.restartAttempt))
    this.restartAttempt += 1
    this.state = 'backoff'
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (!this.stopping) this.spawnNow()
    }, delay)
  }

  private log(level: 'info' | 'warning' | 'error', message: string): void {
    this.options.onLog?.(level, message)
  }
}
