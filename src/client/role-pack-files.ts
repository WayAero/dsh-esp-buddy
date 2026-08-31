import type { RolePackWireFile } from '../contract.ts'

export interface SelectedRolePackFile {
  readonly path: string
  readonly file: File
}

const MAX_TOTAL_BYTES = 1_800_000
const MAX_FILE_BYTES = 163_840
const GIF_FILE_NAMES = new Set(['idle.gif', 'busy.gif', 'attention.gif', 'sleep.gif'])

function leafPath(relativePath: string): string {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[1]
  throw new Error(`角色包只允许一层目录：${relativePath}`)
}

export function filesFromInput(files: FileList | readonly File[]): SelectedRolePackFile[] {
  return Array.from(files).map(file => ({
    path: leafPath(file.webkitRelativePath || file.name),
    file,
  }))
}

async function readDirectory(entry: FileSystemDirectoryEntry, root = entry.name): Promise<SelectedRolePackFile[]> {
  const reader = entry.createReader()
  const entries: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    entries.push(...batch)
  }
  const files: SelectedRolePackFile[] = []
  for (const child of entries) {
    if (child.isDirectory) throw new Error(`角色包只允许扁平文件，发现子目录：${root}/${child.name}`)
    const fileEntry = child as FileSystemFileEntry
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject))
    files.push({ path: child.name, file })
  }
  return files
}

export async function filesFromDrop(items: DataTransferItemList): Promise<SelectedRolePackFile[]> {
  const entries = Array.from(items)
    .map(item => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null)
  if (entries.length === 1 && entries[0].isDirectory) return readDirectory(entries[0] as FileSystemDirectoryEntry)
  if (entries.some(entry => entry.isDirectory)) throw new Error('请一次拖入一个角色包文件夹')
  const files: SelectedRolePackFile[] = []
  for (const entry of entries) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    files.push({ path: file.name, file })
  }
  return files
}

export async function validateSelectedFiles(files: readonly SelectedRolePackFile[]): Promise<{ name: string; totalBytes: number }> {
  if (files.length === 0) throw new Error('角色包没有文件')
  const seen = new Set<string>()
  for (const item of files) {
    if (seen.has(item.path)) throw new Error(`角色包包含重复文件：${item.path}`)
    seen.add(item.path)
    if (item.file.size > MAX_FILE_BYTES) throw new Error(`文件超过 163,840 字节：${item.path}`)
  }
  const totalBytes = files.reduce((total, item) => total + item.file.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('角色包总大小超过 1,800,000 字节')
  const manifest = files.find(item => item.path === 'manifest.json')
  if (manifest === undefined) throw new Error('角色包缺少 manifest.json')
  if (manifest.file.size > 8_192) throw new Error('manifest.json 超过 8192 字节')
  const value = JSON.parse(await manifest.file.text()) as Record<string, unknown>
  if (typeof value.name !== 'string' || value.name.length === 0) throw new Error('manifest.json 缺少 name')
  if (value.mode !== 'gif' && value.mode !== 'text') throw new Error('manifest.json 的 mode 只能是 gif 或 text')
  if (value.mode === 'gif') {
    if (!seen.has('idle.gif')) throw new Error('GIF 角色包至少需要 idle.gif')
    for (const path of seen) {
      if (path.endsWith('.gif') && !GIF_FILE_NAMES.has(path)) throw new Error(`GIF 角色包不支持文件名：${path}`)
    }
  }
  return { name: value.name, totalBytes }
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export async function encodeSelectedFiles(files: readonly SelectedRolePackFile[]): Promise<RolePackWireFile[]> {
  return Promise.all(files.map(async item => ({
    path: item.path,
    data: bytesToBase64(await item.file.arrayBuffer()),
  })))
}
