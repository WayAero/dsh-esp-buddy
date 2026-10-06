export const ROLE_PACK_RECOMMENDED_FILE_BYTES = 210 * 1024
export const ROLE_PACK_RECOMMENDED_TOTAL_BYTES = 1_800_000

export const GIF_MAX_DIMENSION = 84
export const GIF_MAX_FRAMES = 80
export const GIF_MAX_COLORS = 64
export const GIF_MAX_FPS = 8

export interface GifMetadata {
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly colors: number
  readonly totalDelayCentiseconds: number
}

export type SpecSeverity = 'normal' | 'warning' | 'severe' | 'invalid'
export interface RolePackFileReport {
  readonly path: string
  readonly bytes: number
  readonly metadata?: GifMetadata
  readonly fps?: number
  readonly severity: SpecSeverity
  readonly error?: string
}

/** 两倍及以上用红色提醒；分辨率比较最长边，格式错误另行阻止发送。 */
export function specSeverity(value: number, recommended: number): SpecSeverity {
  return value >= recommended * 2 ? 'severe' : value > recommended ? 'warning' : 'normal'
}

export function inspectRolePackFile(path: string, data: Uint8Array): RolePackFileReport {
  const base = { path, bytes: data.byteLength }
  if (/\.(png|jpe?g|webp|bmp|svg|apng|gif)$/i.test(path) && !path.endsWith('.gif')) {
    return { ...base, severity: 'invalid', error: '文件类型不符，角色动画需要 GIF' }
  }
  try {
    const metadata = path.endsWith('.gif') ? inspectGif(data) : undefined
    const fps = metadata && metadata.frames > 1
      ? metadata.totalDelayCentiseconds > 0 ? metadata.frames * 100 / metadata.totalDelayCentiseconds : Infinity
      : undefined
    const ratios = [data.byteLength / ROLE_PACK_RECOMMENDED_FILE_BYTES]
    if (metadata) ratios.push(Math.max(metadata.width, metadata.height) / GIF_MAX_DIMENSION,
      metadata.frames / GIF_MAX_FRAMES, metadata.colors / GIF_MAX_COLORS)
    if (fps !== undefined) ratios.push(fps / GIF_MAX_FPS)
    return { ...base, metadata, fps, severity: specSeverity(Math.max(...ratios), 1) }
  } catch (cause) {
    return { ...base, severity: 'invalid', error: (cause as Error).message }
  }
}

function readUint16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true)
}

function readColorTable(data: Uint8Array, offset: number, packed: number): { offset: number, colors: number } {
  if ((packed & 0x80) === 0) return { offset, colors: 0 }
  const colors = 1 << ((packed & 0x07) + 1)
  const next = offset + colors * 3
  if (next > data.byteLength) throw new Error('GIF 调色板不完整')
  return { offset: next, colors }
}

function skipSubBlocks(data: Uint8Array, initialOffset: number): number {
  let offset = initialOffset
  while (true) {
    if (offset >= data.byteLength) throw new Error('GIF 子块不完整')
    const size = data[offset++]
    if (size === 0) return offset
    offset += size
    if (offset > data.byteLength) throw new Error('GIF 子块不完整')
  }
}

export function inspectGif(data: Uint8Array): GifMetadata {
  if (data.byteLength < 13 || (String.fromCharCode(...data.subarray(0, 6)) !== 'GIF87a' && String.fromCharCode(...data.subarray(0, 6)) !== 'GIF89a')) {
    throw new Error('不是有效 GIF 文件')
  }
  const width = readUint16(data, 6)
  const height = readUint16(data, 8)
  if (width === 0 || height === 0) throw new Error('GIF 画布尺寸无效')
  let offset = 13
  let colors = 0
  let table = readColorTable(data, offset, data[10])
  offset = table.offset
  colors = Math.max(colors, table.colors)
  let frames = 0
  let pendingDelay = 0
  let totalDelayCentiseconds = 0
  let hasTrailer = false
  while (offset < data.byteLength) {
    const marker = data[offset++]
    if (marker === 0x3b) {
      hasTrailer = true
      break
    }
    if (marker === 0x21) {
      if (offset >= data.byteLength) throw new Error('GIF 扩展块不完整')
      const label = data[offset++]
      if (label === 0xf9) {
        if (offset + 6 > data.byteLength || data[offset] !== 4 || data[offset + 5] !== 0) throw new Error('GIF 图形控制扩展无效')
        pendingDelay = readUint16(data, offset + 2)
        offset += 6
      } else {
        offset = skipSubBlocks(data, offset)
      }
      continue
    }
    if (marker !== 0x2c) throw new Error('GIF 图像块无效')
    if (offset + 9 > data.byteLength) throw new Error('GIF 图像描述符不完整')
    const left = readUint16(data, offset)
    const top = readUint16(data, offset + 2)
    const frameWidth = readUint16(data, offset + 4)
    const frameHeight = readUint16(data, offset + 6)
    // 帧可只更新画布的一部分，但不能为空或超出画布；与推荐分辨率无关。
    if (frameWidth === 0 || frameHeight === 0) throw new Error('GIF 帧尺寸无效')
    if (left + frameWidth > width || top + frameHeight > height) throw new Error('GIF 帧超出画布范围')
    table = readColorTable(data, offset + 9, data[offset + 8])
    offset = table.offset
    colors = Math.max(colors, table.colors)
    if (offset >= data.byteLength) throw new Error('GIF 图像数据不完整')
    offset = skipSubBlocks(data, offset + 1)
    frames += 1
    totalDelayCentiseconds += pendingDelay
    pendingDelay = 0
  }
  if (!hasTrailer) throw new Error('GIF 缺少结束标记')
  if (frames === 0) throw new Error('GIF 不包含动画帧')
  return { width, height, frames, colors, totalDelayCentiseconds }
}

/** 推荐规格只产生提醒；文件损坏仍由 GIF 结构解析报错。 */
export function rolePackFileWarnings(path: string, data: Uint8Array): string[] {
  const warnings: string[] = []
  if (data.byteLength > ROLE_PACK_RECOMMENDED_FILE_BYTES) warnings.push(`${path} 大小 ${(data.byteLength / 1024).toFixed(1)} KiB，推荐不超过 210 KiB`)
  if (!path.endsWith('.gif')) return warnings
  const metadata = inspectGif(data)
  if (metadata.width > GIF_MAX_DIMENSION || metadata.height > GIF_MAX_DIMENSION) warnings.push(`${path} 画布 ${metadata.width}×${metadata.height}，推荐不超过 84×84`)
  if (metadata.frames > GIF_MAX_FRAMES) warnings.push(`${path} 共 ${metadata.frames} 帧，推荐不超过 80 帧`)
  if (metadata.colors > GIF_MAX_COLORS) warnings.push(`${path} 调色板 ${metadata.colors} 色，推荐不超过 64 色`)
  if (metadata.frames > 1 && (metadata.totalDelayCentiseconds === 0 || metadata.frames * 100 > metadata.totalDelayCentiseconds * GIF_MAX_FPS)) {
    warnings.push(`${path} 帧率高于推荐的约 8 FPS`)
  }
  return warnings
}
