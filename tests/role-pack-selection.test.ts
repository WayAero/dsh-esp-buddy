import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

// 运行真实组件及文件读取代码，用最小 Hook/JSX 容器检查事件后的可发送状态，无需浏览器或新依赖。
const compiled = await build({
  entryPoints: ['src/client/RolePackSection.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
})
function harness() {
  const slots: any[] = []
  let cursor = 0
  const module = { exports: {} as any }
  const jsx = (type: any, props: any) => ({ type, props })
  const react = {
    useRef: (value: any) => { const index = cursor++; return slots[index] ??= { current: value } },
    useState: (value: any) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value
      return [slots[index], (next: any) => { slots[index] = next }]
    },
  }
  runInNewContext(compiled.outputFiles[0].text, {
    module, exports: module.exports, Uint8Array, DataView, File, console,
    localStorage: { getItem: () => null },
    require: (id: string) => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button' }
      throw new Error(`Unexpected import: ${id}`)
    },
  })
  function render() {
    cursor = 0
    const root = module.exports.RolePackSection({
      connected: true, enabled: true,
      progress: { phase: 'idle', totalBytes: 0, sentBytes: 0 },
      installRolePack: async () => {}, cancelRolePack: async () => {}, t: (key: string) => key,
    })
    const nodes: any[] = []
    function visit(node: any) {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node || typeof node !== 'object') return
      nodes.push(node)
      visit(node.props?.children)
    }
    visit(root)
    return nodes
  }
  return {
    input: (files: File[]) => render().find(node => node.type === 'input').props.onChange({ target: { files, value: 'chosen' } }),
    drop: (items: any[]) => render().find(node => node.props.className?.includes('dropZone')).props.onDrop({
      preventDefault() {}, dataTransfer: { items },
    }),
    summary: () => render().find(node => node.props.className === 'dsh_espBuddy_packSummary'),
    error: () => render().find(node => node.props.className === 'dsh_espBuddy_packError')?.props.children,
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve))
function validFiles() {
  return [new File(['{"name":"A","mode":"text"}'], 'manifest.json')]
}

test('input conversion and drop directory failures clear the previous pack and show errors', async () => {
  const ui = harness()
  const nested = new File(['x'], 'x')
  Object.defineProperty(nested, 'webkitRelativePath', { value: 'B/sub/x' })
  const directory = { name: 'B', isDirectory: true, createReader: () => {
    let first = true
    return { readEntries: (resolve: (entries: any[]) => void) => {
      resolve(first ? [{ name: 'sub', isDirectory: true }] : [])
      first = false
    } }
  } }
  for (const fail of [() => ui.input([nested]), () => ui.drop([{ webkitGetAsEntry: () => directory }]),
    () => ui.input([new File(['invalid JSON'], 'manifest.json')])]) {
    ui.input(validFiles())
    await settle()
    assert.ok(ui.summary())
    assert.doesNotThrow(fail)
    assert.equal(ui.summary(), undefined)
    await settle()
    assert.equal(ui.summary(), undefined)
    assert.ok(ui.error())
  }
  ui.input(validFiles())
  await settle()
  assert.ok(ui.summary())
  assert.equal(ui.error(), undefined)
})

test('a previous directory read cannot restore a pack after a newer selection fails', async () => {
  const ui = harness()
  let finish!: (file: File) => void
  ui.drop([{ webkitGetAsEntry: () => ({ isDirectory: false, file: (resolve: typeof finish) => { finish = resolve } }) }])
  ui.input([new File(['bad'], 'manifest.json')])
  await settle()
  const error = ui.error()
  finish(validFiles()[0])
  await settle()
  assert.equal(ui.summary(), undefined)
  assert.equal(ui.error(), error)
})
