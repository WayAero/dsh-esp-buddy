import assert from 'node:assert/strict'
import test from 'node:test'

import { adoptStyles, cssText, STYLE_ID } from '../src/client/styles.ts'

test('loading and unloading another client module preserves Buddy styles until Buddy disposes', () => {
  const elements: Array<{
    id: string
    textContent: string
    attributes: Map<string, string>
    setAttribute: (name: string, value: string) => void
    remove: () => void
  }> = []
  const document = {
    getElementById: (id: string) => elements.find(element => element.id === id) ?? null,
    createElement: () => {
      const attributes = new Map<string, string>()
      const element = {
        id: '', textContent: '', attributes,
        setAttribute: (name: string, value: string) => { attributes.set(name, value) },
        remove: () => {
          const index = elements.indexOf(element)
          if (index >= 0) elements.splice(index, 1)
        },
      }
      return element
    },
    head: { appendChild: (element: typeof elements[number]) => { elements.push(element) } },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  try {
    const dispose = adoptStyles()
    const buddyStyle = document.getElementById(STYLE_ID)!
    assert.equal(buddyStyle.textContent, cssText)

    // 模拟 rc.2 claimStyles：后加载的模块认领所有尚未声明 data-plugin 的样式。
    const skinStyle = document.createElement()
    document.head.appendChild(skinStyle)
    for (const element of elements) {
      if (!element.attributes.has('data-plugin')) element.setAttribute('data-plugin', 'dsh-claude-style')
    }
    // 模拟 removeOwnedStyles：只删除已停用模块所属的样式。
    for (const element of [...elements]) {
      if (element.attributes.get('data-plugin') === 'dsh-claude-style') element.remove()
    }
    assert.equal(elements.length, 1)
    assert.equal(document.getElementById(STYLE_ID), buddyStyle)
    assert.equal(buddyStyle.attributes.get('data-plugin'), 'dsh-esp-buddy')

    // 重复挂载不重复添加样式，也不能清除原调用持有的样式。
    adoptStyles()()
    assert.equal(elements.length, 1)
    dispose()
    assert.equal(elements.length, 0)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
