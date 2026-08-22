import { existsSync } from 'node:fs'
import path from 'node:path'

import { bundledHelperPath } from './platform.ts'

export interface HelperLaunch {
  executablePath: string
  args: string[]
  cwd: string
  bundled: boolean
}
export function resolveHelperLaunch(packageRoot: string): HelperLaunch {
  const bundled = bundledHelperPath(packageRoot)
  if (existsSync(bundled)) {
    return { executablePath: bundled, args: [], cwd: packageRoot, bundled: true }
  }

  const source = path.join(packageRoot, 'helper', 'buddy_ble.py')
  if (!existsSync(source)) throw new Error(`BLE Helper not found: ${bundled}`)
  return {
    executablePath: process.env.DSH_ESP_BUDDY_PYTHON ?? 'python',
    args: [source],
    cwd: packageRoot,
    bundled: false,
  }
}
