export type RolePackCommand = 'char_begin' | 'file' | 'chunk' | 'file_end' | 'char_end' | 'char_abort'

export interface CommandAck {
  readonly ack: RolePackCommand
  readonly ok: boolean
  readonly n: number
  readonly error?: string
}

interface PendingAck {
  readonly command: RolePackCommand
  readonly resolve: (ack: CommandAck) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

export class CommandAckRouter {
  private pending?: PendingAck

  waitFor(command: RolePackCommand, send: () => boolean, timeoutMs = 15_000): Promise<CommandAck> {
    if (this.pending !== undefined) return Promise.reject(new Error('Another ESP command is awaiting ACK'))

    return new Promise<CommandAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.command !== command) return
        this.pending = undefined
        reject(new Error(`${command} ACK timeout`))
      }, timeoutMs)
      this.pending = { command, resolve, reject, timer }
      if (!send()) this.rejectPending(new Error('BLE Helper is not ready for reliable TX'))
    })
  }

  route(line: string): boolean {
    let ack: CommandAck | undefined
    try {
      ack = parseCommandAck(line)
    } catch (error) {
      this.rejectPending(error as Error)
      throw error
    }
    if (ack === undefined) return false

    const pending = this.pending
    if (pending === undefined) return true
    clearTimeout(pending.timer)
    this.pending = undefined
    if (ack.ack !== pending.command) {
      pending.reject(new Error(`Expected ${pending.command} ACK, received ${ack.ack}`))
    } else {
      pending.resolve(ack)
    }
    return true
  }

  disconnect(): void {
    this.rejectPending(new Error('BLE disconnected during role-pack transfer'))
  }

  private rejectPending(error: Error): void {
    const pending = this.pending
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending = undefined
    pending.reject(error)
  }
}

export function parseCommandAck(line: string): CommandAck | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !('ack' in value)) return undefined

  const record = value as Record<string, unknown>
  if (!['char_begin', 'file', 'chunk', 'file_end', 'char_end', 'char_abort'].includes(String(record.ack))) {
    throw new Error('Invalid role-pack ACK command')
  }
  if (typeof record.ok !== 'boolean') throw new Error('Role-pack ACK ok must be boolean')
  if (!Number.isSafeInteger(record.n) || (record.n as number) < 0) {
    throw new Error('Role-pack ACK n must be a non-negative integer')
  }
  if (record.error !== undefined && typeof record.error !== 'string') {
    throw new Error('Role-pack ACK error must be a string')
  }
  return {
    ack: record.ack as RolePackCommand,
    ok: record.ok,
    n: record.n as number,
    ...(record.error === undefined ? {} : { error: record.error }),
  }
}
