import assert from 'node:assert/strict'
import { test } from 'node:test'
import { en } from '../src/i18n/en.js'
import { zh } from '../src/i18n/zh.js'

test('中英文案 key 双向对齐：多一侧或少一侧都是文案缺失', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  // zh 用 as const 推导 key 类型、en 用 satisfies 约束，但 satisfies 不拦「en 多出的 key」，
  // 这里数量与集合双重断言，保证两侧完全一致
  assert.equal(enKeys.length, zhKeys.length, `key 数量不一致：zh ${zhKeys.length} / en ${enKeys.length}`)
  assert.deepEqual(enKeys, zhKeys)
})
