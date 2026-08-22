import type { BuddyState } from '../protocol/types.ts'

export const EMPTY_BUDDY_STATE: BuddyState = Object.freeze({
  total: 0,
  running: 0,
  waiting: 0,
  msg: 'idle',
  entries: [],
  tokens: 0,
})

export type BuddyStateListener = (state: Readonly<BuddyState>) => void

function copyState(state: BuddyState): BuddyState {
  return {
    ...state,
    entries: [...state.entries],
    prompt: state.prompt === undefined ? undefined : { ...state.prompt },
    usage: state.usage === undefined ? undefined : { ...state.usage },
    context: state.context === undefined ? undefined : { ...state.context },
    contextBreakdown: state.contextBreakdown === undefined ? undefined : { ...state.contextBreakdown },
  }
}
export class BuddyStateStore {
  private state: BuddyState = copyState(EMPTY_BUDDY_STATE)
  private readonly listeners = new Set<BuddyStateListener>()

  snapshot(): BuddyState {
    return copyState(this.state)
  }

  replace(state: BuddyState): void {
    this.state = copyState(state)
    this.emit()
  }

  update(patch: Partial<BuddyState>): void {
    this.state = copyState({ ...this.state, ...patch })
    this.emit()
  }

  onChanged(listener: BuddyStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.listeners.clear()
    this.state = copyState(EMPTY_BUDDY_STATE)
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
