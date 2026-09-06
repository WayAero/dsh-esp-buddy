export const HELPER_IPC_LINE_MAX = 16 * 1024

export type HelperCommand =
  | { type: 'tx'; line: string; mode?: 'snapshot' | 'control' | 'bulk' }
  | { type: 'stop' }

export type HelperEvent =
  | { type: 'status'; connected: boolean; device?: string; mtu?: number }
  | { type: 'rx'; line: string }
  | { type: 'error'; message: string }

export class HelperProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HelperProtocolError'
  }
}

export class JsonLineDecoder {
  private buffered = Buffer.alloc(0)
  private readonly maxLineBytes: number

  constructor(maxLineBytes = HELPER_IPC_LINE_MAX) {
    this.maxLineBytes = maxLineBytes
  }

  push(chunk: Buffer | string): string[] {
    const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    this.buffered = Buffer.concat([this.buffered, incoming])

    const lines: string[] = []
    while (true) {
      const newline = this.buffered.indexOf(0x0a)
      if (newline < 0) break
      if (newline > this.maxLineBytes) throw new HelperProtocolError('Helper IPC line is too long')

      let line = this.buffered.subarray(0, newline)
      this.buffered = this.buffered.subarray(newline + 1)
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1)
      lines.push(line.toString('utf8'))
    }

    if (this.buffered.byteLength > this.maxLineBytes) {
      throw new HelperProtocolError('Helper IPC line is too long')
    }
    return lines
  }

  reset(): void {
    this.buffered = Buffer.alloc(0)
  }
}

export function encodeHelperCommand(command: HelperCommand): string {
  if (command.type === 'tx' && !command.line.endsWith('\n')) {
    throw new HelperProtocolError('Buddy tx line must end with a newline')
  }
  const encoded = `${JSON.stringify(command)}\n`
  if (Buffer.byteLength(encoded, 'utf8') > HELPER_IPC_LINE_MAX) {
    throw new HelperProtocolError('Helper command exceeds IPC line limit')
  }
  return encoded
}

export function parseHelperEvent(line: string): HelperEvent {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw new HelperProtocolError(`invalid Helper JSON: ${(error as Error).message}`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HelperProtocolError('Helper event must be a JSON object')
  }

  const event = value as Record<string, unknown>
  if (event.type === 'status') {
    if (typeof event.connected !== 'boolean') throw new HelperProtocolError('status.connected must be boolean')
    if (event.device !== undefined && typeof event.device !== 'string') {
      throw new HelperProtocolError('status.device must be string')
    }
    if (event.mtu !== undefined && (!Number.isSafeInteger(event.mtu) || (event.mtu as number) < 23)) {
      throw new HelperProtocolError('status.mtu must be an integer >= 23')
    }
    return {
      type: 'status',
      connected: event.connected,
      ...(event.device === undefined ? {} : { device: event.device as string }),
      ...(event.mtu === undefined ? {} : { mtu: event.mtu as number }),
    }
  }

  if (event.type === 'rx') {
    if (typeof event.line !== 'string') throw new HelperProtocolError('rx.line must be string')
    return { type: 'rx', line: event.line }
  }

  if (event.type === 'error') {
    if (typeof event.message !== 'string' || event.message.length === 0) {
      throw new HelperProtocolError('error.message must be a non-empty string')
    }
    return { type: 'error', message: event.message.slice(0, 1024) }
  }

  throw new HelperProtocolError('unknown Helper event type')
}
