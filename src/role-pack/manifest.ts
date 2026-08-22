export const ROLE_PACK_MAX_TOTAL_BYTES = 1_800_000
export const ROLE_PACK_MAX_MANIFEST_BYTES = 8_192
export const ROLE_PACK_MAX_FILE_NAME_BYTES = 64
export const ROLE_PACK_MAX_NAME_BYTES = 64
export const ROLE_PACK_MAX_ID_LENGTH = 32

export interface RolePackManifest {
  readonly name: string
  readonly mode: 'gif' | 'text'
}

export function normalizePackId(sourceName: string): string {
  let result = ''
  let lastWasSeparator = true
  for (const sourceChar of sourceName) {
    let char = sourceChar
    if (char >= 'A' && char <= 'Z') char = char.toLowerCase()
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
      result += char
      lastWasSeparator = false
    } else if (['-', '_', ' ', '.'].includes(char) && !lastWasSeparator) {
      result += '-'
      lastWasSeparator = true
    }
    if (result.length > ROLE_PACK_MAX_ID_LENGTH) throw new Error('角色包名称规范化后超过 32 个字符')
  }
  result = result.replace(/[-_]+$/u, '')
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(result)) throw new Error('角色包名称无法生成有效 pack_id')
  return result
}

export function parseManifest(data: Buffer): RolePackManifest {
  if (data.byteLength > ROLE_PACK_MAX_MANIFEST_BYTES) throw new Error('manifest.json 超过 8192 字节')
  let value: unknown
  try {
    value = JSON.parse(data.toString('utf8'))
  } catch (error) {
    throw new Error(`manifest.json 不是有效 JSON：${(error as Error).message}`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('manifest.json 必须是 JSON 对象')
  }
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || record.name.length === 0) throw new Error('manifest.json 缺少 name')
  if (Buffer.byteLength(record.name, 'utf8') > ROLE_PACK_MAX_NAME_BYTES) throw new Error('角色包名称超过 64 字节')
  if (record.mode !== 'gif' && record.mode !== 'text') throw new Error('manifest.json 的 mode 只能是 gif 或 text')
  normalizePackId(record.name)
  return { name: record.name, mode: record.mode }
}

export function assertSafeFileName(path: string): void {
  if (path.length === 0 || path.includes('/') || path.includes('\\') || path.includes('..')) {
    throw new Error(`角色包包含非法文件名：${path || '(空)'}`)
  }
  if (Buffer.byteLength(path, 'utf8') > ROLE_PACK_MAX_FILE_NAME_BYTES) {
    throw new Error(`角色包文件名超过 64 字节：${path}`)
  }
}
