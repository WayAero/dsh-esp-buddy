import { CommandAckRouter, type RolePackCommand } from './command-ack.ts'
import { validateRolePack, type ValidatedRolePack } from './pack-reader.ts'
import type { RolePackProgress, RolePackWireFile } from '../contract.ts'

const RAW_CHUNK_BYTES = 512
const CLEANUP_ERRORS = new Set(['bad_sequence', 'size_mismatch', 'transfer_failed'])

export interface RolePackTransferOptions {
  readonly ackRouter: CommandAckRouter
  readonly isConnected: () => boolean
  readonly sendReliable: (line: string) => boolean
  readonly onProgress: (progress: RolePackProgress) => void
  readonly onSettled: () => void
}

export class RolePackTransferManager {
  private readonly options: RolePackTransferOptions
  private active = false

  constructor(options: RolePackTransferOptions) {
    this.options = options
  }

  isActive(): boolean {
    return this.active
  }

  async install(files: readonly RolePackWireFile[]): Promise<RolePackProgress> {
    if (this.active) throw new Error('已有角色包正在发送')
    this.active = true
    this.report({ phase: 'validating', sentBytes: 0, totalBytes: 0 })
    let pack: ValidatedRolePack | undefined
    let sentBytes = 0
    try {
      pack = validateRolePack(files)
      this.assertConnected()
      this.report({ phase: 'sending', packName: pack.manifest.name, sentBytes: 0, totalBytes: pack.totalBytes })
      await this.cleanupStaleTransfer()
      await this.sendCommand({ cmd: 'char_begin', name: pack.manifest.name, total: pack.totalBytes })

      for (const file of pack.files) {
        await this.sendCommand({ cmd: 'file', path: file.path, size: file.data.byteLength })
        let fileSent = 0
        for (let offset = 0; offset < file.data.byteLength; offset += RAW_CHUNK_BYTES) {
          const chunk = file.data.subarray(offset, offset + RAW_CHUNK_BYTES)
          fileSent += chunk.byteLength
          await this.sendCommand({ cmd: 'chunk', d: chunk.toString('base64') }, fileSent)
          sentBytes += chunk.byteLength
          this.report({
            phase: 'sending',
            packName: pack.manifest.name,
            file: file.path,
            sentBytes,
            totalBytes: pack.totalBytes,
          })
        }
        await this.sendCommand({ cmd: 'file_end' }, file.data.byteLength)
      }

      this.report({
        phase: 'installing', packName: pack.manifest.name, sentBytes: pack.totalBytes, totalBytes: pack.totalBytes,
      })
      await this.sendCommand({ cmd: 'char_end' }, undefined, undefined, 60_000)
      const completed: RolePackProgress = {
        phase: 'completed', packName: pack.manifest.name, sentBytes: pack.totalBytes, totalBytes: pack.totalBytes,
      }
      this.report(completed)
      return completed
    } catch (error) {
      const failed: RolePackProgress = {
        phase: 'failed',
        ...(pack === undefined ? {} : { packName: pack.manifest.name }),
        totalBytes: pack?.totalBytes ?? 0,
        sentBytes,
        error: (error as Error).message,
      }
      this.report(failed)
      throw error
    } finally {
      this.active = false
      this.options.onSettled()
    }
  }

  private async cleanupStaleTransfer(): Promise<void> {
    await this.sendCommand({ cmd: 'file_end' }, undefined, CLEANUP_ERRORS)
    await this.sendCommand({ cmd: 'char_end' }, undefined, CLEANUP_ERRORS)
  }

  private async sendCommand(
    body: { cmd: RolePackCommand } & Record<string, unknown>,
    expectedN?: number,
    allowedErrors?: ReadonlySet<string>,
    timeoutMs?: number,
  ): Promise<void> {
    this.assertConnected()
    const line = `${JSON.stringify(body)}\n`
    const ack = await this.options.ackRouter.waitFor(
      body.cmd,
      () => this.options.sendReliable(line),
      timeoutMs,
    )
    if (!ack.ok) {
      if (ack.error !== undefined && allowedErrors?.has(ack.error)) return
      throw new Error(`${body.cmd} 被 ESP32 拒绝：${ack.error ?? 'unknown_error'}`)
    }
    if (expectedN !== undefined && ack.n !== expectedN) {
      throw new Error(`${body.cmd} ACK 字节数不匹配：期望 ${expectedN}，实际 ${ack.n}`)
    }
  }

  private assertConnected(): void {
    if (!this.options.isConnected()) throw new Error('ESP Buddy 尚未连接')
  }

  private report(progress: RolePackProgress): void {
    this.options.onProgress(progress)
  }
}
