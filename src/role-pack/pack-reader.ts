import {
  assertSafeFileName,
  parseManifest,
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

const GIF_CANDIDATES = ['idle_0.gif', 'idle.gif', 'attention.gif', 'attention_0.gif', 'busy.gif', 'sleep.gif']

function decodeBase64(value: string, path: string): Buffer {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error(`文件不是有效 Base64：${path}`)
  }
  return Buffer.from(value, 'base64')
}

export function validateRolePack(input: readonly RolePackWireFile[]): ValidatedRolePack {
  if (input.length === 0) throw new Error('角色包没有文件')
  const seen = new Set<string>()
  const files = input.map(file => {
    assertSafeFileName(file.path)
    if (seen.has(file.path)) throw new Error(`角色包包含重复文件：${file.path}`)
    seen.add(file.path)
    return { path: file.path, data: decodeBase64(file.data, file.path) }
  })
  const manifestFile = files.find(file => file.path === 'manifest.json')
  if (manifestFile === undefined) throw new Error('角色包缺少 manifest.json')
  const manifest = parseManifest(manifestFile.data)
  if (manifest.mode === 'gif' && !GIF_CANDIDATES.some(name => seen.has(name))) {
    throw new Error('GIF 角色包至少需要 idle.gif')
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
