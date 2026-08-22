export interface BuddyPrompt {
  id: string
  tool: string
  hint: string
}
export interface BuddyUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface BuddyContext {
  pressure?: number
  projected?: number
  window?: number
}

export interface BuddyContextBreakdown {
  system: number
  tools: number
  messages: number
}

export interface BuddyState {
  total: number
  running: number
  waiting: number
  msg: string
  entries: string[]
  tokens: number
  /** Undefined means the exact local-day total is unavailable. V1 encodes the compatibility sentinel 0. */
  tokensToday?: number
  prompt?: BuddyPrompt
  usage?: BuddyUsage
  context?: BuddyContext
  contextBreakdown?: BuddyContextBreakdown
}

export interface PermissionReply {
  cmd: 'permission'
  id: string
  decision: 'once' | 'deny'
}
