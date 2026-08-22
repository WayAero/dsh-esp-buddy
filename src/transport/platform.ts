import path from 'node:path'

export function bundledHelperPath(
  packageRoot: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32' && arch === 'x64') {
    return path.join(packageRoot, 'bin', 'win32-x64', 'buddy-ble.exe')
  }
  if (platform === 'linux' && arch === 'x64') {
    return path.join(packageRoot, 'bin', 'linux-x64', 'buddy-ble')
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return path.join(packageRoot, 'bin', 'darwin-arm64', 'buddy-ble')
  }
  throw new Error(`unsupported BLE Helper platform: ${platform}-${arch}`)
}
