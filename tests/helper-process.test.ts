import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { HelperProcessManager } from '../src/transport/helper-process.ts'
import type { HelperEvent } from '../src/transport/helper-protocol.ts'

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly pid: number

  constructor(pid: number) {
    super()
    this.pid = pid
    this.stdin.on('data', chunk => {
      if (String(chunk).includes('"type":"stop"')) queueMicrotask(() => this.emit('exit', 0, null))
    })
  }

  kill(): boolean {
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'))
    return true
  }
}

const wait = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

test('process manager exchanges JSONL and stops the child gracefully', async () => {
  const children: FakeChild[] = []
  const events: HelperEvent[] = []
  const writes: string[] = []
  const spawnProcess = () => {
    const child = new FakeChild(100 + children.length)
    children.push(child)
    child.stdin.on('data', chunk => writes.push(String(chunk)))
    queueMicrotask(() => child.emit('spawn'))
    return child
  }
  const manager = new HelperProcessManager({
    executablePath: 'buddy-ble.exe',
    spawnProcess: spawnProcess as never,
    stopGraceMs: 50,
    onEvent: event => events.push(event),
  })

  manager.start()
  await wait()
  assert.equal(manager.getState(), 'running')

  children[0].stdout.write('{"type":"status","connected":true,"mtu":185}\n')
  children[0].stdout.write('{"type":"rx","line":"{\\"cmd\\":\\"permission\\"}"}\n')
  await wait()
  assert.deepEqual(events.slice(0, 2), [
    { type: 'status', connected: true, mtu: 185 },
    { type: 'rx', line: '{"cmd":"permission"}' },
  ])

  assert.equal(manager.sendBuddyLine('{"total":0}\n'), true)
  assert.match(writes.join(''), /"type":"tx"/)

  await manager.stop()
  assert.equal(manager.getState(), 'stopped')
  assert.match(writes.join(''), /"type":"stop"/)
})
test('process manager backs off, restarts, and blocks a crash loop', async () => {
  const children: FakeChild[] = []
  const spawnProcess = () => {
    const child = new FakeChild(200 + children.length)
    children.push(child)
    queueMicrotask(() => child.emit('spawn'))
    return child
  }
  const manager = new HelperProcessManager({
    executablePath: 'buddy-ble.exe',
    spawnProcess: spawnProcess as never,
    restartBaseMs: 1,
    restartMaxMs: 2,
    crashWindowMs: 1_000,
    maxCrashes: 1,
    stopGraceMs: 20,
  })

  manager.start()
  await wait()
  children[0].emit('exit', 1, null)
  await wait(5)
  assert.equal(children.length, 2)
  assert.equal(manager.getState(), 'running')

  children[1].emit('exit', 1, null)
  await wait()
  assert.equal(manager.getState(), 'blocked')
  assert.equal(children.length, 2)

  await manager.stop()
  assert.equal(manager.getState(), 'stopped')
})
