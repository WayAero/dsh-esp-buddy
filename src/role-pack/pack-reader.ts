import {
  assertSafeFileName,
  parseManifest,
  ROLE_PACK_MAX_FILE_BYTES,
  ROLE_PACK_MAX_TOTAL_BYTES,
  type RolePackManifest,
} from './manifest.ts'
import type { RolePackWireFile } from '../contract.ts'

export type { RolePackWireFile } from '../contract.ts'

export interface RolePackFile {
  readonly path: string
  readonly data: Buffer
}

export interface ValidatedRolePack {
  readonly manifest: RolePackManifest
  readonly files: readonly RolePackFile[]
  readonly totalBytes: number
}

const GIF_FILE_NAMES = new Set(['idle.gif', 'busy.gif', 'attention.gif', 'sleep.gif'])
const GIF_MAX_DIMENSION = 84
const GIF_MAX_FRAMES = 60
const GIF_MAX_COLORS = 64
const GIF_MAX_FPS = 8

interface GifMetadata {
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly colors: number
  readonly totalDelayCentiseconds: number
}

function decodeBase64(value: string, path: string): Buffer {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error(`文件不是有效 Base64：${path}`)
  }
  return Buffer.from(value, 'base64')
}

function readColorTable(data: Buffer, offset: number, packed: number): { offset: number, colors: number } {
  if ((packed & 0x80) === 0) return { offset, colors: 0 }
  const colors = 1 << ((packed & 0x07) + 1)
  const next = offset + colors * 3
  if (next > data.byteLength) throw new Error('GIF 调色板不完整')
  return { offset: next, colors }
}

function skipSubBlocks(data: Buffer, initialOffset: number): number {
  let offset = initialOffset
  while (true) {
    if (offset >= data.byteLength) throw new Error('GIF 子块不完整')
    const size = data[offset++]
    if (size === 0) return offset
    offset += size
    if (offset > data.byteLength) throw new Error('GIF 子块不完整')
  }
}

export function inspectGif(data: Buffer): GifMetadata {
  if (data.byteLength < 13 || (data.subarray(0, 6).toString('ascii') !== 'GIF87a' && data.subarray(0, 6).toString('ascii') !== 'GIF89a')) {
    throw new Error('不是有效 GIF 文件')
  }
  const width = data.readUInt16LE(6)
  const height = data.readUInt16LE(8)
  if (width === 0 || height === 0) throw new Error('GIF 画布尺寸无效')
  let offset = 13
  let colors = 0
  let table = readColorTable(data, offset, data[10])
  offset = table.offset
  colors = Math.max(colors, table.colors)
  let frames = 0
  let pendingDelay = 0
  let totalDelayCentiseconds = 0
  while (offset < data.byteLength) {
    const marker = data[offset++]
    if (marker === 0x3b) break
    if (marker === 0x21) {
      if (offset >= data.byteLength) throw new Error('GIF 扩展块不完整')
      const label = data[offset++]
      if (label === 0xf9) {
        if (offset + 6 > data.byteLength || data[offset] !== 4 || data[offset + 5] !== 0) throw new Error('GIF 图形控制扩展无效')
        pendingDelay = data.readUInt16LE(offset + 2)
        offset += 6
      } else {
        offset = skipSubBlocks(data, offset)
      }
      continue
    }
    if (marker !== 0x2c) throw new Error('GIF 图像块无效')
    if (offset + 9 > data.byteLength) throw new Error('GIF 图像描述符不完整')
    table = readColorTable(data, offset + 9, data[offset + 8])
    offset = table.offset
    colors = Math.max(colors, table.colors)
    if (offset >= data.byteLength) throw new Error('GIF 图像数据不完整')
    offset = skipSubBlocks(data, offset + 1)
    frames += 1
    totalDelayCentiseconds += pendingDelay
    pendingDelay = 0
  }
  if (frames === 0) throw new Error('GIF 不包含动画帧')
  return { width, height, frames, colors, totalDelayCentiseconds }
}

function validateGif(path: string, data: Buffer): void {
  const metadata = inspectGif(data)
  if (metadata.width > GIF_MAX_DIMENSION || metadata.height > GIF_MAX_DIMENSION) {
    throw new Error(`${path} 画布超过 ${GIF_MAX_DIMENSION}×${GIF_MAX_DIMENSION}`)
  }
  if (metadata.frames > GIF_MAX_FRAMES) throw new Error(`${path} 帧数超过 ${GIF_MAX_FRAMES}`)
  if (metadata.colors > GIF_MAX_COLORS) throw new Error(`${path} 颜色数超过 ${GIF_MAX_COLORS}`)
  if (metadata.totalDelayCentiseconds > 0 && metadata.frames * 100 > metadata.totalDelayCentiseconds * GIF_MAX_FPS) {
    throw new Error(`${path} 帧率高于约 6 FPS 的安全上限`)
  }
}

export function validateRolePack(input: readonly RolePackWireFile[]): ValidatedRolePack {
  if (input.length === 0) throw new Error('角色包没有文件')
  const seen = new Set<string>()
  const files = input.map(file => {
    assertSafeFileName(file.path)
    if (seen.has(file.path)) throw new Error(`角色包包含重复文件：${file.path}`)
    seen.add(file.path)
    const data = decodeBase64(file.data, file.path)
    if (data.byteLength > ROLE_PACK_MAX_FILE_BYTES) throw new Error(`文件超过 163,840 字节：${file.path}`)
    return { path: file.path, data }
  })
  const manifestFile = files.find(file => file.path === 'manifest.json')
  if (manifestFile === undefined) throw new Error('角色包缺少 manifest.json')
  const manifest = parseManifest(manifestFile.data)
  if (manifest.mode === 'gif' && !seen.has('idle.gif')) {
    throw new Error('GIF 角色包至少需要 idle.gif')
  }
  if (manifest.mode === 'gif') {
    for (const file of files) {
      if (!file.path.endsWith('.gif')) continue
      if (!GIF_FILE_NAMES.has(file.path)) throw new Error(`GIF 角色包不支持文件名：${file.path}`)
      validateGif(file.path, file.data)
    }
  }
  const totalBytes = files.reduce((total, file) => total + file.data.byteLength, 0)
  if (totalBytes > ROLE_PACK_MAX_TOTAL_BYTES) throw new Error('角色包总大小超过 1,800,000 字节')
  const ordered = [...files].sort((left, right) => {
    if (left.path === 'manifest.json') return -1
    if (right.path === 'manifest.json') return 1
    return left.path.localeCompare(right.path, 'en')
  })
  return { manifest, files: ordered, totalBytes }
}
