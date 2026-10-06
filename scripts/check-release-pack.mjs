import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

// 检查实际打包结果，避免工作区已有 dist 时掩盖安装包遗漏。
const [pack] = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--json'], { encoding: 'utf8' }))
const paths = new Set(pack.files.map(file => file.path))
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const required = [
  'package.json', manifest.main, 'dist/client.js', 'cordis.patch.yml',
  'assets/plugin-icon.svg', 'helper/buddy_ble.py', 'helper/requirements.txt', 'bin/win32-x64/buddy-ble.exe',
  'README.md', 'LICENSE',
  'role-packs/dsh-pet-maid/NOTICE.txt',
  ...readdirSync('locale').map(name => `locale/${name}`),
  ...readdirSync('role-packs/dsh-pet-maid').map(name => `role-packs/dsh-pet-maid/${name}`),
]
for (const path of required) {
  assert.ok(paths.has(path), `发布包缺少 ${path}`)
  assert.ok(pack.files.find(file => file.path === path).size > 0, `发布包文件为空：${path}`)
}
// 只允许面向用户的运行文件，新增发布目录时需在此明确列出。
for (const path of paths) {
  assert.ok(/^(package\.json|README\.md|LICENSE|cordis\.patch\.yml|assets\/plugin-icon\.svg|locale\/[^/]+\.json|dist\/[^/]+|helper\/(buddy_ble\.py|requirements\.txt)|bin\/win32-x64\/buddy-ble\.exe|role-packs\/dsh-pet-maid\/[^/]+)$/.test(path), `发布包含非预期文件：${path}`)
}
console.log(`发布包内容检查通过：${pack.filename}，${paths.size} 个文件`)
