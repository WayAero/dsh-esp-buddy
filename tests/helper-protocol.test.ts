import assert from 'node:assert/strict'
import test from 'node:test'

import {
  encodeHelperCommand,
  HelperProtocolError,
  JsonLineDecoder,
  parseHelperEvent,
} from '../src/transport/helper-protocol.ts'
import { bundledHelperPath } from '../src/transport/platform.ts'

test('JSONL decoder reconstructs split and coalesced lines', () => {
  const decoder = new JsonLineDecoder()
  assert.deepEqual(decoder.push('{"type":"status"'), [])
  assert.deepEqual(
    decoder.push(',"connected":true}\n{"type":"error","message":"x"}\r\n'),
    ['{"type":"status","connected":true}', '{"type":"error","message":"x"}'],
  )
})
test('Helper protocol validates both directions', () => {
  assert.equal(
    encodeHelperCommand({ type: 'tx', line: '{"total":0}\n', mode: 'snapshot' }),
    '{"type":"tx","line":"{\\"total\\":0}\\n","mode":"snapshot"}\n',
  )
  assert.deepEqual(
    parseHelperEvent('{"type":"status","connected":true,"mtu":185}'),
    { type: 'status', connected: true, mtu: 185 },
  )
  assert.throws(() => encodeHelperCommand({ type: 'tx', line: '{}' }), HelperProtocolError)
  assert.throws(() => parseHelperEvent('{"type":"status","connected":"yes"}'), HelperProtocolError)
})

test('platform mapping prefers the Windows x64 bundled executable', () => {
  assert.equal(
    bundledHelperPath('C:\\plugin', 'win32', 'x64'),
    'C:\\plugin\\bin\\win32-x64\\buddy-ble.exe',
  )
  assert.throws(() => bundledHelperPath('/plugin', 'win32', 'arm64'), /unsupported/)
})
