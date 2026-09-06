import { CommandAckRouter, type CommandAck, type RolePackCommand } from './command-ack.ts'
import { validateRolePack, type ValidatedRolePack } from './pack-reader.ts'
import type { RolePackProgress, RolePackWireFile } from '../contract.ts'

export const ROLE_PACK_TRANSFER_VERSION = 2
export const RAW_CHUNK_BYTES = 512
export const REQUESTED_WINDOW_SIZE = 4

class RolePackTransferCancelledError extends Error {
  constructor() {
    super('角色包传输已取消')
  }
}

export interface RolePackTransferOptions {
  readonly ackRouter: CommandAckRouter
  readonly isConnected: () => boolean
  readonly sendControl: (line: string) => boolean
  readonly sendBulk: (line: string) => boolean
  readonly onWindowAck: () => void
  readonly onProgress: (progress: RolePackProgress) => void
  readonly onSettled: () => void
  readonly ackTimeoutMs?: number
  readonly now?: () => number
}

export function crc32IsoHdlc(data: Buffer): number {
  let crc = 0xffff_ffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1))
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

export class RolePackTransferManager {
  private readonly options: RolePackTransferOptions
  private active = false
  private cancelRequested = false
  private snapshotDispatchAllowed = true
  private lastProgress: RolePackProgress = { phase: 'idle', sentBytes: 0, totalBytes: 0 }
  private readonly now: () => number
  private speedSamples: Array<{ at: number; sentBytes: number }> = []

  constructor(options: RolePackTransferOptions) {
    this.options = options
    this.now = options.now ?? Date.now
  }

  isActive(): boolean {
    return this.active
  }

  canDispatchSnapshot(): boolean {
    return !this.active || this.snapshotDispatchAllowed
  }

  cancel(): RolePackProgress {
    if (!this.active) throw new Error('当前没有角色包传输')
    this.cancelRequested = true
    const cancelling: RolePackProgress = { ...this.lastProgress, phase: 'cancelling' }
    this.report(cancelling)
    return cancelling
  }

  async install(files: readonly RolePackWireFile[]): Promise<RolePackProgress> {
    if (this.active) throw new Error('已有角色包正在发送')
    this.active = true
    this.cancelRequested = false
    this.snapshotDispatchAllowed = false
    this.report({ phase: 'validating', sentBytes: 0, totalBytes: 0, protocolVersion: ROLE_PACK_TRANSFER_VERSION })
    let pack: ValidatedRolePack | undefined
    let sentBytes = 0
    let transferStarted = false
    try {
      pack = validateRolePack(files)
      this.throwIfCancellationRequested()
      this.assertConnected()
      const begin = await this.sendCommand({
        cmd: 'char_begin', v: ROLE_PACK_TRANSFER_VERSION, name: pack.manifest.name, total: pack.totalBytes, window: REQUESTED_WINDOW_SIZE,
      })
      const windowSize = this.validateWindowSize(begin.n)
      transferStarted = true
      this.throwIfCancellationRequested()
      const startedAt = this.now()
      this.speedSamples = [{ at: startedAt, sentBytes: 0 }]
      this.report({
        phase: 'sending', packName: pack.manifest.name, sentBytes, totalBytes: pack.totalBytes,
        protocolVersion: ROLE_PACK_TRANSFER_VERSION, windowSize,
      })

      let completedFiles = 0
      for (const [fileIndex, file] of pack.files.entries()) {
        await this.sendCommand({ cmd: 'file', path: file.path, size: file.data.byteLength, crc32: crc32IsoHdlc(file.data) }, 0)
        this.throwIfCancellationRequested()
        for (let offset = 0; offset < file.data.byteLength; offset += RAW_CHUNK_BYTES * windowSize) {
          const end = Math.min(file.data.byteLength, offset + RAW_CHUNK_BYTES * windowSize)
          await this.sendChunkWindow(file.data, offset, end)
          this.throwIfCancellationRequested()
          sentBytes += end - offset
          this.reportSending(pack, file.path, sentBytes, startedAt, windowSize, completedFiles)
        }
        await this.sendCommand({ cmd: 'file_end' }, file.data.byteLength)
        this.throwIfCancellationRequested()
        completedFiles = fileIndex + 1
        this.reportSending(pack, file.path, sentBytes, startedAt, windowSize, completedFiles)
      }

      this.report({
        phase: 'installing', packName: pack.manifest.name, sentBytes: pack.totalBytes, totalBytes: pack.totalBytes,
        protocolVersion: ROLE_PACK_TRANSFER_VERSION, windowSize, fileIndex: completedFiles, fileCount: pack.files.length,
      })
      await this.sendCommand({ cmd: 'char_end' }, pack.totalBytes, 60_000)
      const completed: RolePackProgress = {
        phase: 'completed', packName: pack.manifest.name, sentBytes: pack.totalBytes, totalBytes: pack.totalBytes,
        protocolVersion: ROLE_PACK_TRANSFER_VERSION, windowSize, fileIndex: completedFiles, fileCount: pack.files.length,
      }
      this.report(completed)
      return completed
    } catch (error) {
      if (transferStarted) await this.abortAfterFailure()
      if (error instanceof RolePackTransferCancelledError) {
        const cancelled: RolePackProgress = {
          phase: 'cancelled',
          ...(pack === undefined ? {} : { packName: pack.manifest.name }),
          totalBytes: pack?.totalBytes ?? 0,
          sentBytes,
          protocolVersion: ROLE_PACK_TRANSFER_VERSION,
        }
        this.report(cancelled)
        return cancelled
      }
      const failed: RolePackProgress = {
        phase: 'failed',
        ...(pack === undefined ? {} : { packName: pack.manifest.name }),
        totalBytes: pack?.totalBytes ?? 0,
        sentBytes,
        protocolVersion: ROLE_PACK_TRANSFER_VERSION,
        error: (error as Error).message,
      }
      this.report(failed)
      throw error
    } finally {
      this.active = false
      this.snapshotDispatchAllowed = true
      this.speedSamples = []
      this.options.onSettled()
    }
  }

  private validateWindowSize(actual: number): number {
    if (actual === 0) throw new Error('ESP32 固件不支持角色包传输 V2，请升级配套固件')
    if (actual < 1 || actual > REQUESTED_WINDOW_SIZE) throw new Error(`ESP32 返回的 V2 窗口无效：${actual}`)
    return actual
  }

  private async sendChunkWindow(data: Buffer, start: number, end: number): Promise<void> {
    this.assertConnected()
    const ack = await this.options.ackRouter.waitFor('chunk', () => {
      for (let offset = start; offset < end; offset += RAW_CHUNK_BYTES) {
        const chunk = data.subarray(offset, Math.min(offset + RAW_CHUNK_BYTES, end))
        const line = `${JSON.stringify({ cmd: 'chunk', offset, d: chunk.toString('base64') })}\n`
        if (!this.options.sendBulk(line)) return false
      }
      return true
    })
    this.assertAck('chunk', ack, end)
    this.snapshotDispatchAllowed = true
    try {
      this.options.onWindowAck()
    } finally {
      this.snapshotDispatchAllowed = false
    }
  }

  private reportSending(
    pack: ValidatedRolePack,
    file: string,
    sentBytes: number,
    startedAt: number,
    windowSize: number,
    completedFiles: number,
  ): void {
    const now = this.now()
    this.speedSamples.push({ at: now, sentBytes })
    const windowStartedAt = now - 5_000
    while (this.speedSamples.length > 1 && this.speedSamples[1].at <= windowStartedAt) this.speedSamples.shift()
    const sample = this.speedSamples[0] ?? { at: startedAt, sentBytes: 0 }
    const elapsedMs = Math.max(1, now - sample.at)
    const bytesPerSecond = Math.max(0, sentBytes - sample.sentBytes) * 1_000 / elapsedMs
    const remainingMs = bytesPerSecond === 0 ? 0 : Math.ceil((pack.totalBytes - sentBytes) * 1_000 / bytesPerSecond)
    this.report({
      phase: 'sending', packName: pack.manifest.name, file, sentBytes, totalBytes: pack.totalBytes,
      protocolVersion: ROLE_PACK_TRANSFER_VERSION, windowSize, bytesPerSecond, remainingMs,
      fileIndex: completedFiles, fileCount: pack.files.length,
    })
  }

  private async abortAfterFailure(): Promise<void> {
    if (!this.options.isConnected()) return
    try {
      await this.sendCommand({ cmd: 'char_abort' })
    } catch (abortError) {
      console.warn(`[dsh-esp-buddy] role-pack abort failed: ${(abortError as Error).message}`)
    }
  }

  private async sendCommand(
    body: { cmd: RolePackCommand } & Record<string, unknown>,
    expectedN?: number,
    timeoutMs?: number,
  ): Promise<CommandAck> {
    this.assertConnected()
    const line = `${JSON.stringify(body)}\n`
    const ack = await this.options.ackRouter.waitFor(body.cmd, () => this.options.sendControl(line), timeoutMs ?? this.options.ackTimeoutMs)
    this.assertAck(body.cmd, ack, expectedN)
    return ack
  }

  private assertAck(command: RolePackCommand, ack: CommandAck, expectedN?: number): void {
    if (!ack.ok) {
      throw new Error(`${command} 被 ESP32 拒绝：${ack.error ?? 'unknown_error'}（设备已确认 ${ack.n} 原始字节）`)
    }
    if (expectedN !== undefined && ack.n !== expectedN) {
      throw new Error(`${command} ACK 字节数不匹配：期望 ${expectedN}，实际 ${ack.n}`)
    }
  }

  private throwIfCancellationRequested(): void {
    if (this.cancelRequested) throw new RolePackTransferCancelledError()
  }

  private assertConnected(): void {
    if (!this.options.isConnected()) throw new Error('ESP Buddy 尚未连接')
  }

  private report(progress: RolePackProgress): void {
    this.lastProgress = progress
    this.options.onProgress(progress)
  }
}
