import assert from 'node:assert/strict'
import test from 'node:test'
import { validateSelectedFiles, RolePackSelectionError } from '../src/client/role-pack-files.ts'
import { readSkipRolePackWarning, saveSkipRolePackWarning } from '../src/client/role-pack-warning.ts'
import { validateRolePack } from '../src/role-pack/pack-reader.ts'
import { rolePackFileWarnings, inspectRolePackFile, inspectGif, specSeverity } from '../src/role-pack/recommendations.ts'

const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
function gif(width: number, frames: number, colors = 2, delay = 13): Buffer {
  const header = Buffer.from(pixel.subarray(0, 13))
  header.writeUInt16LE(width, 6)
  header[10] = 0x80 | (Math.log2(colors) - 1)
  const frame = pixel.subarray(19, -1)
  const control = Buffer.from([0x21, 0xf9, 4, 0, delay, 0, 0, 0])
  return Buffer.concat([header, Buffer.alloc(colors * 3), ...Array.from({ length: frames }, () => Buffer.concat([control, frame])), Buffer.from([0x3b])])
}
function files(data: Uint8Array) {
  return [
    { path: 'manifest.json', file: new File(['{"name":"test","mode":"gif"}'], 'manifest.json') },
    { path: 'idle.gif', file: new File([new Uint8Array(data)], 'idle.gif') },
  ]
}

test('recommended specs produce warnings and host accepts the same oversized GIF', async () => {
  const data = gif(85, 81, 256, 10)
  const selection = await validateSelectedFiles(files(data))
  assert.equal(selection.warnings.length, 4)
  const host = validateRolePack([
    { path: 'manifest.json', data: Buffer.from('{"name":"test","mode":"gif"}').toString('base64') },
    { path: 'idle.gif', data: data.toString('base64') },
  ])
  assert.equal(host.files.length, 2)
})

test('recommended boundaries do not warn and large valid GIFs only warn', async () => {
  assert.deepEqual(rolePackFileWarnings('idle.gif', gif(84, 80, 64)), [])
  const data = Buffer.concat([pixel, Buffer.alloc(1_800_001)])
  const result = await validateSelectedFiles(files(data))
  assert.equal(result.warnings.length, 2)
  assert.ok(result.totalBytes > 1_800_000)
})

test('damaged GIF remains an error rather than a recommendation warning', async () => {
  await assert.rejects(validateSelectedFiles(files(new Uint8Array([1, 2, 3]))), /不是有效 GIF/)
})

test('host and client reject missing trailer, empty frames and frames outside the canvas', async () => {
  const cases: Array<[Buffer, RegExp]> = [[pixel.subarray(0, -1), /缺少结束标记/]]
  // 此样本的图像描述符在字节 20 开始；分别修改偏移和尺寸。
  for (const [offset, value, error] of [
    [24, 65535, /超出画布/], [26, 65535, /超出画布/],
    [24, 0, /帧尺寸无效/], [26, 0, /帧尺寸无效/],
    [20, 1, /超出画布/], [22, 1, /超出画布/],
  ] as const) {
    const data = Buffer.from(pixel)
    data.writeUInt16LE(value, offset)
    cases.push([data, error])
  }
  for (const [data, error] of cases) {
    assert.throws(() => inspectGif(data), error)
    const report = inspectRolePackFile('idle.gif', data)
    assert.equal(report.severity, 'invalid')
    assert.match(report.error!, error)
    assert.throws(() => validateRolePack([
      { path: 'manifest.json', data: Buffer.from('{"name":"test","mode":"gif"}').toString('base64') },
      { path: 'idle.gif', data: data.toString('base64') },
    ]), error)
    await assert.rejects(validateSelectedFiles(files(data)), (cause: unknown) => {
      assert.ok(cause instanceof RolePackSelectionError)
      assert.equal(cause.reports.find(row => row.path === 'idle.gif')?.severity, 'invalid')
      assert.match(cause.message, error)
      return true
    })
  }
})

test('partial frame ending at canvas boundary is valid and oversized canvas only warns', async () => {
  const data = gif(168, 1)
  data.writeUInt16LE(167, 28) // 控制扩展后，帧左偏移 + 1 像素恰好落在画布右边界。
  const metadata = inspectGif(data)
  assert.equal(metadata.width, 168)
  const result = await validateSelectedFiles(files(data))
  assert.equal(result.reports.find(row => row.path === 'idle.gif')?.severity, 'severe')
  assert.equal(validateRolePack([
    { path: 'manifest.json', data: Buffer.from('{"name":"test","mode":"gif"}').toString('base64') },
    { path: 'idle.gif', data: data.toString('base64') },
  ]).files.length, 2)
})

test('warning preference defaults to every send, persists opt-out and can be restored', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  assert.equal(readSkipRolePackWarning(storage), false)
  saveSkipRolePackWarning(storage, true)
  assert.equal(readSkipRolePackWarning(storage), true)
  saveSkipRolePackWarning(storage, false)
  assert.equal(readSkipRolePackWarning(storage), false)
})

test('table reports normal, yellow excess and red double-size excess without blocking valid GIFs', async () => {
  assert.equal(specSeverity(84, 84), 'normal')
  assert.equal(specSeverity(85, 84), 'warning')
  assert.equal(specSeverity(167, 84), 'warning')
  assert.equal(specSeverity(168, 84), 'severe')
  const normal = inspectRolePackFile('idle.gif', gif(84, 80, 64))
  assert.equal(normal.severity, 'normal')
  const warning = inspectRolePackFile('idle.gif', gif(128, 80, 64))
  assert.equal(warning.severity, 'warning')
  const severe = await validateSelectedFiles(files(gif(168, 160, 128, 5)))
  assert.equal(severe.reports.find(row => row.path === 'idle.gif')?.severity, 'severe')
  assert.equal(severe.reports.find(row => row.path === 'idle.gif')?.fps, 20)
})

test('wrong file type and damaged GIF retain invalid rows for the red error table', async () => {
  const wrongType = [...files(pixel), { path: 'busy.png', file: new File(['png'], 'busy.png') }]
  await assert.rejects(validateSelectedFiles(wrongType), (error: unknown) => {
    assert.ok(error instanceof RolePackSelectionError)
    const report = error.reports.find(row => row.path === 'busy.png')
    assert.equal(report?.severity, 'invalid')
    assert.match(report?.error ?? '', /文件类型不符/)
    return true
  })
  await assert.rejects(validateSelectedFiles(files(new Uint8Array([1, 2, 3]))), (error: unknown) => {
    assert.ok(error instanceof RolePackSelectionError)
    assert.equal(error.reports.find(row => row.path === 'idle.gif')?.severity, 'invalid')
    return true
  })
})
