import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { en } from '../src/i18n/en.js'
import { zh } from '../src/i18n/zh.js'

test('中英文案 key 双向对齐：多一侧或少一侧都是文案缺失', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  // zh 用 as const 推导 key 类型、en 用 satisfies 约束；satisfies 会在编译期拦住 en 多出的 key，
  // 这里的运行时断言主要防止某一侧被整段误删，并保证两侧集合完全一致
  assert.equal(enKeys.length, zhKeys.length, `key 数量不一致：zh ${zhKeys.length} / en ${enKeys.length}`)
  assert.deepEqual(enKeys, zhKeys)
})

test('不存在定义了却没有任何组件或服务引用的文案键', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // 文案文件自身不算引用
        if (entry.name !== 'i18n') {
          walk(full)
        }
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(full)
      }
    }
  }
  walk(path.resolve('src'))
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  const unused = Object.keys(zh).filter((key) => !source.includes(key))
  assert.deepEqual(unused, [], `未使用的文案键：${unused.join(', ')}`)
})
