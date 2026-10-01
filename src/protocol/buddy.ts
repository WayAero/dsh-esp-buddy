import type { BuddyState, PermissionReply } from './types.ts'

export const BUDDY_LIMITS = Object.freeze({
  lineBytes: 4096,
  entryCount: 8,
  entryBytes: 92,
  messageBytes: 96,
  promptIdBytes: 40,
  promptToolBytes: 20,
  promptHintBytes: 1024,
})

/** 当前插件发送的 Buddy 状态快照版本。 */
export const BUDDY_STATE_PROTOCOL_VERSION = 2

export class BuddyProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuddyProtocolError'
  }
}
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const hintTruncationNotice = '【说明未完整显示】\n'

function boundedCounter(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER)
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = encoder.encode(value)
  if (encoded.byteLength <= maxBytes) return value

  let end = maxBytes
  while (end > 0) {
    try {
      return decoder.decode(encoded.subarray(0, end))
    } catch {
      end -= 1
    }
  }
  return ''
}

/** 截断标记放在正文开头，避免用户滚动前把不完整说明当成全文。 */
function encodePromptHint(value: string, maxBytes: number): string {
  if (encoder.encode(value).byteLength <= maxBytes) return value
  const noticeBytes = encoder.encode(hintTruncationNotice).byteLength
  return hintTruncationNotice + truncateUtf8(value, maxBytes - noticeBytes)
}

function v1Snapshot(state: BuddyState): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    total: boundedCounter(state.total),
    running: boundedCounter(state.running),
    waiting: boundedCounter(state.waiting),
    msg: truncateUtf8(state.msg, BUDDY_LIMITS.messageBytes),
    entries: state.entries
      .slice(0, BUDDY_LIMITS.entryCount)
      .map(entry => truncateUtf8(entry, BUDDY_LIMITS.entryBytes)),
    tokens: boundedCounter(state.tokens),
    // 为兼容 ESP 的 V1 解析保留此数值字段；零表示没有精确日统计。
    tokens_today: boundedCounter(state.tokensToday ?? 0),
  }

  if (state.prompt !== undefined) {
    const id = truncateUtf8(state.prompt.id, BUDDY_LIMITS.promptIdBytes)
    if (id.length === 0) throw new BuddyProtocolError('prompt id must not be empty')
    snapshot.prompt = {
      id,
      tool: truncateUtf8(state.prompt.tool, BUDDY_LIMITS.promptToolBytes),
      hint: encodePromptHint(state.prompt.hint, BUDDY_LIMITS.promptHintBytes),
    }
  }

  return snapshot
}

function addV2(snapshot: Record<string, unknown>, state: BuddyState): void {
  snapshot.protocol = 2
  snapshot.source = 'deepseek-harness'

  if (state.usage !== undefined) {
    snapshot.usage = {
      input: boundedCounter(state.usage.input),
      output: boundedCounter(state.usage.output),
      cache_read: boundedCounter(state.usage.cacheRead),
      cache_write: boundedCounter(state.usage.cacheWrite),
    }
  }

  if (state.context !== undefined) {
    snapshot.context = {
      ...(state.context.pressure === undefined ? {} : { pressure: boundedCounter(state.context.pressure) }),
      ...(state.context.projected === undefined ? {} : { projected: boundedCounter(state.context.projected) }),
      ...(state.context.window === undefined ? {} : { window: boundedCounter(state.context.window) }),
    }
  }

  if (state.contextBreakdown !== undefined) {
    snapshot.context_breakdown = {
      system: boundedCounter(state.contextBreakdown.system),
      tools: boundedCounter(state.contextBreakdown.tools),
      messages: boundedCounter(state.contextBreakdown.messages),
    }
  }
}

export function serializeBuddyState(state: BuddyState, protocol: 1 | 2 = 1): string {
  const snapshot = v1Snapshot(state)
  if (protocol === 2) addV2(snapshot, state)

  let json = JSON.stringify(snapshot)
  const fits = () => encoder.encode(json).byteLength <= BUDDY_LIMITS.lineBytes
  if (state.prompt !== undefined && !fits()) {
    // JSON 转义可能把一个原始字节扩为六个；先让会话摘要为审批正文留出空间。
    const entries = snapshot.entries as string[]
    while (entries.length > 0 && !fits()) {
      entries.pop()
      json = JSON.stringify(snapshot)
    }
    if (!fits()) {
      const prompt = snapshot.prompt as { hint: string }
      // 按实际序列化大小查找可用正文预算，字符边界与截断标记由同一编码流程处理。
      let low = encoder.encode(hintTruncationNotice).byteLength
      let high = BUDDY_LIMITS.promptHintBytes
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        prompt.hint = encodePromptHint(state.prompt.hint, middle)
        json = JSON.stringify(snapshot)
        if (fits()) low = middle
        else high = middle - 1
      }
      prompt.hint = encodePromptHint(state.prompt.hint, low)
      json = JSON.stringify(snapshot)
    }
  }
  if (!fits()) {
    throw new BuddyProtocolError(`Buddy snapshot exceeds ${BUDDY_LIMITS.lineBytes} bytes`)
  }
  return `${json}\n`
}

export function parsePermissionReply(line: string): PermissionReply {
  const trimmed = line.replace(/[\r\n]+$/, '')
  if (encoder.encode(trimmed).byteLength > BUDDY_LIMITS.lineBytes) {
    throw new BuddyProtocolError('permission reply exceeds Buddy line limit')
  }

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (error) {
    throw new BuddyProtocolError(`invalid permission JSON: ${(error as Error).message}`)
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BuddyProtocolError('permission reply must be a JSON object')
  }

  const candidate = value as Record<string, unknown>
  if (candidate.cmd !== 'permission') throw new BuddyProtocolError('unsupported Buddy command')
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new BuddyProtocolError('permission id must be a non-empty string')
  }
  if (encoder.encode(candidate.id).byteLength > BUDDY_LIMITS.promptIdBytes) {
    throw new BuddyProtocolError('permission id exceeds Buddy prompt id limit')
  }
  if (candidate.decision !== 'once' && candidate.decision !== 'deny') {
    throw new BuddyProtocolError('unsupported permission decision')
  }

  return {
    cmd: 'permission',
    id: candidate.id,
    decision: candidate.decision,
  }
}
