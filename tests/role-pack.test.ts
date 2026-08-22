import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CommandAckRouter } from '../src/role-pack/command-ack.ts'
import { normalizePackId } from '../src/role-pack/manifest.ts'
import { validateRolePack, type RolePackWireFile } from '../src/role-pack/pack-reader.ts'
import { RolePackTransferManager } from '../src/role-pack/transfer-manager.ts'

function wire(path: string, data: string | Buffer): RolePackWireFile {
  return { path, data: Buffer.from(data).toString('base64') }
}

test('bundled dsh-pet maid role pack is valid and fits ESP32 limits', () => {
  const root = fileURLToPath(new URL('../role-packs/dsh-pet-maid/', import.meta.url))
  const pack = validateRolePack(readdirSync(root).map(path => wire(path, readFileSync(`${root}${path}`))))
  assert.equal(pack.manifest.name, 'dsh-pet-maid')
  assert.equal(pack.manifest.mode, 'gif')
  assert.ok(pack.totalBytes < 1_800_000)
  assert.ok(pack.files.some(file => file.path === 'NOTICE.txt'))
})

test('role-pack validation matches firmware naming and size constraints', () => {
  assert.equal(normalizePackId('DeepSeek_Whale.Girl'), 'deepseek-whale-girl')
  const pack = validateRolePack([
    wire('idle.gif', Buffer.from('GIF89a')),
    wire('manifest.json', '{"name":"DeepSeek Whale Girl","mode":"gif"}'),
  ])
  assert.equal(pack.manifest.name, 'DeepSeek Whale Girl')
  assert.equal(pack.files[0].path, 'manifest.json')
  assert.throws(() => validateRolePack([wire('../idle.gif', 'x')]), /非法文件名/)
  assert.throws(() => validateRolePack([wire('manifest.json', '{"name":"x","mode":"gif"}')]), /idle\.gif/)
  assert.throws(
    () => validateRolePack([wire('manifest.json', '{"name":"x","mode":"text"}'), wire('large.bin', Buffer.alloc(1_800_001))]),
    /1,800,000/,
  )
})

test('ACK router separates ACK messages and rejects mismatches', async () => {
  const router = new CommandAckRouter()
  assert.equal(router.route('{"cmd":"permission","id":1}'), false)
  const waiting = router.waitFor('file', () => true)
  assert.equal(router.route('{"ack":"chunk","ok":true,"n":1}'), true)
  await assert.rejects(waiting, /Expected file ACK/)
})

test('role-pack transfer sends one reliable command at a time and validates cumulative n', async () => {
  const router = new CommandAckRouter()
  const commands: Array<Record<string, unknown>> = []
  const phases: string[] = []
  let currentFileBytes = 0
  const manager = new RolePackTransferManager({
    ackRouter: router,
    isConnected: () => true,
    sendReliable: line => {
      const command = JSON.parse(line) as Record<string, unknown>
      commands.push(command)
      const name = command.cmd as string
      if (name === 'file') currentFileBytes = 0
      if (name === 'chunk') currentFileBytes += Buffer.from(command.d as string, 'base64').byteLength
      const n = name === 'chunk'
        ? currentFileBytes
        : name === 'file_end'
          ? currentFileBytes
          : 0
      queueMicrotask(() => router.route(JSON.stringify({
        ack: name,
        ok: commands.length > 2 || !['file_end', 'char_end'].includes(name),
        n,
        ...(commands.length <= 2 ? { error: 'bad_sequence' } : {}),
      })))
      return true
    },
    onProgress: progress => phases.push(progress.phase),
    onSettled: () => undefined,
  })
  const idle = Buffer.alloc(500, 1)
  const result = await manager.install([
    wire('manifest.json', '{"name":"whale-girl","mode":"gif"}'),
    wire('idle.gif', idle),
  ])
  assert.equal(result.phase, 'completed')
  assert.equal(commands.filter(item => item.cmd === 'chunk').length, 3)
  assert.deepEqual(commands.slice(0, 4).map(item => item.cmd), ['file_end', 'char_end', 'char_begin', 'file'])
  assert.ok(phases.includes('installing'))
})

test('negative chunk ACK fails without retry and concurrent installs are rejected', async () => {
  const router = new CommandAckRouter()
  let chunkCommands = 0
  let releaseBegin!: () => void
  const beginGate = new Promise<void>(resolve => { releaseBegin = resolve })
  const manager = new RolePackTransferManager({
    ackRouter: router,
    isConnected: () => true,
    sendReliable: line => {
      const command = JSON.parse(line) as Record<string, unknown>
      const name = command.cmd as string
      if (name === 'chunk') chunkCommands += 1
      queueMicrotask(async () => {
        if (name === 'char_begin') await beginGate
        router.route(JSON.stringify({
          ack: name,
          ok: name !== 'chunk' && (name !== 'file_end' && name !== 'char_end' || chunkCommands > 0),
          n: 0,
          error: name === 'chunk' ? 'transfer_failed' : 'bad_sequence',
        }))
      })
      return true
    },
    onProgress: () => undefined,
    onSettled: () => undefined,
  })
  const files = [wire('manifest.json', '{"name":"whale","mode":"gif"}'), wire('idle.gif', 'GIF89a')]
  const first = manager.install(files)
  await assert.rejects(manager.install(files), /正在发送/)
  releaseBegin()
  await assert.rejects(first, /chunk 被 ESP32 拒绝/)
  assert.equal(chunkCommands, 1)
})
