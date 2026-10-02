import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'

mkdirSync('dist', { recursive: true })

const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*']
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const defines = { __ESP_BUDDY_VERSION__: JSON.stringify(packageVersion) }

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: dshExternal,
  define: defines,
  logLevel: 'info',
})

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  jsx: 'automatic',
  external: [...dshExternal, 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  define: defines,
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'dsh-esp-buddy', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'info',
})
