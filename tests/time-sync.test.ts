import assert from 'node:assert/strict'
import test from 'node:test'
import { TimeSyncScheduler, TIME_SYNC_INTERVAL_MS } from '../src/transport/time-sync.ts'

function fixture() {
  const clock = { wall: 1791158400123, monotonic: 0, offset: -480 }
  let sends = 0
  let accepted = true
  const warnings: string[] = []
  const scheduler = new TimeSyncScheduler(() => { sends++; return accepted }, message => warnings.push(message), () => ({ ...clock }))
  const advance = (ms: number) => { clock.wall += ms; clock.monotonic += ms }
  return { scheduler, clock, advance, warnings, sends: () => sends, reject: () => { accepted = false } }
}

test('ready, duplicate ready, reconnect and stop bound time requests to the current connection', () => {
  const f = fixture()
  f.scheduler.tick()
  assert.equal(f.sends(), 0)
  f.scheduler.setConnected(true)
  f.scheduler.setConnected(true)
  assert.equal(f.sends(), 1)
  f.scheduler.setConnected(false)
  f.advance(TIME_SYNC_INTERVAL_MS)
  f.scheduler.tick()
  assert.equal(f.sends(), 1)
  f.scheduler.setConnected(true)
  assert.equal(f.sends(), 2)
  f.scheduler.reset()
  f.advance(TIME_SYNC_INTERVAL_MS)
  f.scheduler.tick()
  assert.equal(f.sends(), 2)
})

test('ten minute sync uses heartbeat and role transfers defer and merge requests', () => {
  const f = fixture()
  f.scheduler.setConnected(true)
  for (let i = 0; i < TIME_SYNC_INTERVAL_MS / 3000 - 1; i++) { f.advance(3000); f.scheduler.tick() }
  assert.equal(f.sends(), 1)
  f.advance(3000)
  f.scheduler.tick(true)
  f.clock.offset = -345
  f.scheduler.tick(true)
  f.scheduler.tick()
  assert.equal(f.sends(), 2)
  f.scheduler.tick()
  assert.equal(f.sends(), 2)
})

test('forward/backward wall jumps, timezone changes and resume trigger fresh requests', () => {
  const f = fixture()
  f.scheduler.setConnected(true)
  f.clock.wall += 6000
  f.scheduler.tick()
  f.clock.wall -= 6000
  f.scheduler.tick()
  f.clock.offset = 0
  f.scheduler.tick()
  f.advance(20000)
  f.scheduler.tick()
  assert.equal(f.sends(), 5)
})

test('congestion retries at most three times across heartbeat ticks and clears on disconnect', () => {
  const f = fixture()
  f.reject()
  f.scheduler.setConnected(true)
  for (let i = 0; i < 10; i++) { f.advance(3000); f.scheduler.tick() }
  assert.equal(f.sends(), 3)
  assert.equal(f.warnings.length, 1)
  f.scheduler.setConnected(false)
  f.advance(TIME_SYNC_INTERVAL_MS)
  f.scheduler.tick()
  assert.equal(f.sends(), 3)
})

test('send exceptions have a bounded retry budget without escaping the heartbeat', () => {
  let attempts = 0
  const scheduler = new TimeSyncScheduler(() => { attempts++; throw new Error('pipe closed') }, () => undefined)
  scheduler.setConnected(true)
  for (let i = 0; i < 10; i++) scheduler.tick()
  assert.equal(attempts, 3)
  scheduler.reset()
  scheduler.tick()
  assert.equal(attempts, 3)
})
