export const TIME_SYNC_INTERVAL_MS = 10 * 60_000
const CLOCK_JUMP_MS = 5_000
const MAX_ATTEMPTS = 3

/** 只安排校时请求；Helper 在真正写入 BLE 前读取电脑时间。复用心跳，无独立定时器。 */
export class TimeSyncScheduler {
  private connected = false
  private previous?: { wall: number; monotonic: number; offset: number }
  private nextAt = 0
  private attempts = 0
  private pending = false
  private readonly send: () => boolean
  private readonly warn: (message: string) => void
  private readonly clock: () => { wall: number; monotonic: number; offset: number }

  constructor(send: () => boolean, warn: (message: string) => void,
    clock = () => ({ wall: Date.now(), monotonic: performance.now(), offset: new Date().getTimezoneOffset() })) {
    this.send = send
    this.warn = warn
    this.clock = clock
  }

  setConnected(connected: boolean): void {
    if (connected === this.connected) return
    this.reset()
    this.connected = connected
    if (connected) {
      this.pending = true
      this.tick()
    }
  }

  reset(): void {
    this.connected = false
    this.previous = undefined
    this.pending = false
    this.attempts = 0
    this.nextAt = 0
  }

  tick(blocked = false, heartbeatMs = 3_000): void {
    if (!this.connected) return
    const now = this.clock()
    const previous = this.previous
    this.previous = now
    // 心跳延迟可发现休眠恢复；墙上时间与单调时间差可发现前跳和后跳。
    if (previous && (previous.offset !== now.offset
      || Math.abs((now.wall - previous.wall) - (now.monotonic - previous.monotonic)) >= CLOCK_JUMP_MS
      || now.monotonic - previous.monotonic > Math.max(15_000, heartbeatMs * 3))) {
      this.pending = true
      this.attempts = 0
    }
    if (now.monotonic >= this.nextAt && !this.pending) {
      this.pending = true
      this.attempts = 0
    }
    if (!this.pending || blocked) return
    this.attempts += 1
    try {
      if (this.send()) {
        this.pending = false
        this.nextAt = now.monotonic + TIME_SYNC_INTERVAL_MS
        return
      }
    } catch (error) {
      this.warn(`BLE time request failed: ${(error as Error).message}`)
    }
    if (this.attempts >= MAX_ATTEMPTS) {
      this.pending = false
      this.nextAt = now.monotonic + TIME_SYNC_INTERVAL_MS
      this.warn('BLE time request abandoned after 3 attempts; retry on next sync trigger')
    }
  }
}
