import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CommandAckRouter } from '../src/role-pack/command-ack.ts'
import { normalizePackId, ROLE_PACK_MAX_FILE_BYTES } from '../src/role-pack/manifest.ts'
import { validateRolePack, type RolePackWireFile } from '../src/role-pack/pack-reader.ts'
import { crc32IsoHdlc, RolePackTransferManager } from '../src/role-pack/transfer-manager.ts'

const ONE_PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

function wire(path: string, data: string | Buffer): RolePackWireFile {
  return { path, data: Buffer.from(data).toString('base64') }
}

function createManager(
  router: CommandAckRouter,
  phases: Array<Record<string, unknown>>,
  sendReliable: (line: string) => boolean,
  ackTimeoutMs?: number,
): RolePackTransferManager {
  return new RolePackTransferManager({
    ackRouter: router,
    isConnected: () => true,
    sendReliable,
    onProgress: progress => phases.push(progress),
    onSettled: () => undefined,
    ackTimeoutMs,
  })
}

test('bundled dsh-pet maid role pack is valid and fits ESP32 V2 limits', () => {
  const root = fileURLToPath(new URL('../role-packs/dsh-pet-maid/', import.meta.url))
  const pack = validateRolePack(readdirSync(root).map(path => wire(path, readFileSync(`${root}${path}`))))
  assert.equal(pack.manifest.name, 'dsh-pet-maid')
  assert.equal(pack.manifest.mode, 'gif')
  assert.ok(pack.totalBytes < 700_000)
  assert.ok(pack.files.some(file => file.path === 'NOTICE.txt'))
  assert.deepEqual(
    pack.files.filter(file => file.path.endsWith('.gif')).map(file => file.path).sort(),
    ['attention.gif', 'busy.gif', 'idle.gif', 'sleep.gif'],
  )
})

test('role-pack validation enforces V2 file cap and fixed GIF names', () => {
  assert.equal(normalizePackId('DeepSeek_Whale.Girl'), 'deepseek-whale-girl')
  const pack = validateRolePack([
    wire('idle.gif', ONE_PIXEL_GIF),
    wire('manifest.json', '{"name":"DeepSeek Whale Girl","mode":"gif"}'),
  ])
  assert.equal(pack.manifest.name, 'DeepSeek Whale Girl')
  assert.equal(pack.files[0].path, 'manifest.json')
  assert.throws(() => validateRolePack([wire('../idle.gif', 'x')]), /非法文件名/)
  assert.throws(() => validateRolePack([wire('manifest.json', '{"name":"x","mode":"gif"}')]), /idle\.gif/)
  assert.throws(() => validateRolePack([
    wire('manifest.json', '{"name":"x","mode":"gif"}'), wire('idle_0.gif', ONE_PIXEL_GIF),
  ]), /idle\.gif/)
  assert.throws(() => validateRolePack([
    wire('manifest.json', '{"name":"x","mode":"text"}'), wire('large.bin', Buffer.alloc(ROLE_PACK_MAX_FILE_BYTES + 1)),
  ]), /163,840/)
})

test('CRC-32/ISO-HDLC matches its fixed test vector', () => {
  assert.equal(crc32IsoHdlc(Buffer.from('123456789')), 0xcbf43926)
})

test('ACK router accepts char_abort and rejects mismatches', async () => {
  const router = new CommandAckRouter()
  assert.equal(router.route('{"cmd":"permission","id":1}'), false)
  const waiting = router.waitFor('char_abort', () => true)
  assert.equal(router.route('{"ack":"chunk","ok":true,"n":1}'), true)
  await assert.rejects(waiting, /Expected char_abort ACK/)
})

test('V2 transfer sends four chunks before one cumulative ACK and validates CRC', async () => {
  const router = new CommandAckRouter()
  const phases: Array<Record<string, unknown>> = []
  const commands: Array<Record<string, unknown>> = []
  let fileBytes = 0
  let chunksInFile = 0
  let totalBytes = 0
  const manager = createManager(router, phases, line => {
    const command = JSON.parse(line) as Record<string, unknown>
    commands.push(command)
    const name = command.cmd as string
    if (name === 'file') {
      fileBytes = 0
      chunksInFile = 0
    }
    if (name === 'chunk') {
      const bytes = Buffer.from(command.d as string, 'base64').byteLength
      assert.equal(command.offset, fileBytes)
      fileBytes += bytes
      totalBytes += bytes
      chunksInFile += 1
      if (chunksInFile % 4 === 0 || bytes < 512) {
        queueMicrotask(() => router.route(JSON.stringify({ ack: 'chunk', ok: true, n: fileBytes })))
      }
      return true
    }
    const n = name === 'char_begin' ? 4 : name === 'file_end' ? fileBytes : name === 'char_end' ? totalBytes : 0
    queueMicrotask(() => router.route(JSON.stringify({ ack: name, ok: true, n })))
    return true
  })
  const payload = Buffer.alloc(2_049, 1)
  const result = await manager.install([
    wire('manifest.json', '{"name":"whale","mode":"text"}'),
    wire('payload.bin', payload),
  ])
  assert.equal(result.phase, 'completed')
  assert.deepEqual(commands.slice(0, 2).map(item => item.cmd), ['char_begin', 'file'])
  assert.equal(commands[0].v, 2)
  assert.equal(commands[0].window, 4)
  assert.equal(commands.filter(item => item.cmd === 'char_abort').length, 0)
  const payloadChunks = commands.filter(item => item.cmd === 'chunk').slice(1)
  assert.equal(payloadChunks.length, 5)
  assert.deepEqual(payloadChunks.map(item => item.offset), [0, 512, 1024, 1536, 2048])
  assert.ok(payloadChunks.every(item => Buffer.from(item.d as string, 'base64').byteLength <= 512))
  const payloadFile = commands.find(item => item.cmd === 'file' && item.path === 'payload.bin')
  assert.equal(payloadFile?.crc32, crc32IsoHdlc(payload))
  assert.ok(phases.some(progress => progress.windowSize === 4 && typeof progress.bytesPerSecond === 'number'))
  assert.equal(result.fileIndex, 2)
  assert.equal(result.fileCount, 2)
})

test('cancellation waits for the current command, aborts, and settles as cancelled', async () => {
  const router = new CommandAckRouter()
  const phases: Array<Record<string, unknown>> = []
  const commands: string[] = []
  let releaseBegin!: () => void
  const beginGate = new Promise<void>(resolve => { releaseBegin = resolve })
  const manager = createManager(router, phases, line => {
    const name = (JSON.parse(line) as Record<string, unknown>).cmd as string
    commands.push(name)
    queueMicrotask(async () => {
      if (name === 'char_begin') {
        await beginGate
        router.route('{"ack":"char_begin","ok":true,"n":4}')
      } else if (name === 'char_abort') {
        router.route('{"ack":"char_abort","ok":true,"n":0}')
      }
    })
    return true
  })
  const transfer = manager.install([
    wire('manifest.json', '{"name":"whale","mode":"text"}'), wire('payload.bin', 'x'),
  ])
  assert.equal(manager.cancel().phase, 'cancelling')
  releaseBegin()
  const result = await transfer
  assert.equal(result.phase, 'cancelled')
  assert.deepEqual(commands, ['char_begin', 'char_abort'])
  assert.ok(phases.some(progress => progress.phase === 'cancelling'))
})

test('old firmware n=0 stops V2 transfer without V1 fallback', async () => {
  const router = new CommandAckRouter()
  const phases: Array<Record<string, unknown>> = []
  const commands: Array<Record<string, unknown>> = []
  const manager = createManager(router, phases, line => {
    const command = JSON.parse(line) as Record<string, unknown>
    commands.push(command)
    queueMicrotask(() => router.route('{"ack":"char_begin","ok":true,"n":0}'))
    return true
  })
  await assert.rejects(manager.install([
    wire('manifest.json', '{"name":"whale","mode":"text"}'), wire('payload.bin', 'x'),
  ]), /不支持角色包传输 V2/)
  assert.deepEqual(commands.map(command => command.cmd), ['char_begin'])
})

test('checksum mismatch aborts the started V2 transfer', async () => {
  const router = new CommandAckRouter()
  const phases: Array<Record<string, unknown>> = []
  const commands: string[] = []
  let fileBytes = 0
  const manager = createManager(router, phases, line => {
    const command = JSON.parse(line) as Record<string, unknown>
    const name = command.cmd as string
    commands.push(name)
    if (name === 'chunk') fileBytes += Buffer.from(command.d as string, 'base64').byteLength
    const ack = name === 'char_begin'
      ? { ack: name, ok: true, n: 4 }
      : name === 'file_end'
        ? { ack: name, ok: false, n: fileBytes, error: 'checksum_mismatch' }
        : { ack: name, ok: true, n: name === 'chunk' ? fileBytes : 0 }
    queueMicrotask(() => router.route(JSON.stringify(ack)))
    return true
  })
  await assert.rejects(manager.install([
    wire('manifest.json', '{"name":"whale","mode":"text"}'), wire('payload.bin', 'x'),
  ]), /file_end 被 ESP32 拒绝：checksum_mismatch（设备已确认/)
  assert.deepEqual(commands, ['char_begin', 'file', 'chunk', 'file_end', 'char_abort'])
})

test('timeout after negotiation aborts, while a BLE disconnect does not queue an abort', async () => {
  const timeoutRouter = new CommandAckRouter()
  const timeoutPhases: Array<Record<string, unknown>> = []
  const timeoutCommands: string[] = []
  const timeoutManager = createManager(timeoutRouter, timeoutPhases, line => {
    const name = (JSON.parse(line) as Record<string, unknown>).cmd as string
    timeoutCommands.push(name)
    if (name === 'char_begin' || name === 'char_abort') {
      queueMicrotask(() => timeoutRouter.route(JSON.stringify({ ack: name, ok: true, n: name === 'char_begin' ? 4 : 0 })))
    }
    return true
  }, 1)
  await assert.rejects(timeoutManager.install([
    wire('manifest.json', '{"name":"whale","mode":"text"}'), wire('payload.bin', 'x'),
  ]), /file ACK timeout/)
  assert.deepEqual(timeoutCommands, ['char_begin', 'file', 'char_abort'])

  const disconnectRouter = new CommandAckRouter()
  const disconnectPhases: Array<Record<string, unknown>> = []
  const disconnectCommands: string[] = []
  let connected = true
  const disconnectManager = new RolePackTransferManager({
    ackRouter: disconnectRouter,
    isConnected: () => connected,
    sendReliable: line => {
      const name = (JSON.parse(line) as Record<string, unknown>).cmd as string
      disconnectCommands.push(name)
      if (name === 'char_begin') queueMicrotask(() => disconnectRouter.route('{"ack":"char_begin","ok":true,"n":4}'))
      if (name === 'file') queueMicrotask(() => {
        connected = false
        disconnectRouter.disconnect()
      })
      return true
    },
    onProgress: progress => disconnectPhases.push(progress),
    onSettled: () => undefined,
  })
  await assert.rejects(disconnectManager.install([
    wire('manifest.json', '{"name":"whale","mode":"text"}'), wire('payload.bin', 'x'),
  ]), /BLE disconnected/)
  assert.deepEqual(disconnectCommands, ['char_begin', 'file'])
})

test('negative chunk ACK aborts once and concurrent installs are rejected', async () => {
  const router = new CommandAckRouter()
  const phases: Array<Record<string, unknown>> = []
  let releaseBegin!: () => void
  const beginGate = new Promise<void>(resolve => { releaseBegin = resolve })
  const commands: string[] = []
  const manager = createManager(router, phases, line => {
    const command = JSON.parse(line) as Record<string, unknown>
    const name = command.cmd as string
    commands.push(name)
    queueMicrotask(async () => {
      if (name === 'char_begin') {
        await beginGate
        router.route('{"ack":"char_begin","ok":true,"n":4}')
      } else if (name === 'chunk') {
        router.route('{"ack":"chunk","ok":false,"n":0,"error":"offset_mismatch"}')
      } else {
        router.route(JSON.stringify({ ack: name, ok: true, n: 0 }))
      }
    })
    return true
  })
  const files = [wire('manifest.json', '{"name":"whale","mode":"text"}'), wire('payload.bin', 'x')]
  const first = manager.install(files)
  await assert.rejects(manager.install(files), /正在发送/)
  releaseBegin()
  await assert.rejects(first, /chunk 被 ESP32 拒绝：offset_mismatch（设备已确认 0 原始字节）/)
  assert.deepEqual(commands, ['char_begin', 'file', 'chunk', 'char_abort'])
})
