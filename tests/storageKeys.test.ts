import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrateStoragePrefix } from '../src/services/storageKeys.js'

const fakeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

test('旧前缀的键搬到新前缀，原键删除，其它键不动', () => {
  const storage = fakeStorage({
    'chat-demo:api-key': 'sk-123',
    'chat-demo:locale': 'zh-CN',
    'other:key': 'keep',
  })
  migrateStoragePrefix(storage, 'chat-demo:', 'deepseek-chat:')
  assert.equal(storage.getItem('deepseek-chat:api-key'), 'sk-123')
  assert.equal(storage.getItem('deepseek-chat:locale'), 'zh-CN')
  assert.equal(storage.getItem('chat-demo:api-key'), null)
  assert.equal(storage.getItem('chat-demo:locale'), null)
  assert.equal(storage.getItem('other:key'), 'keep')
})

test('新键已存在时不覆盖用户的新设置', () => {
  const storage = fakeStorage({
    'chat-demo:api-key': 'old',
    'deepseek-chat:api-key': 'new',
  })
  migrateStoragePrefix(storage, 'chat-demo:', 'deepseek-chat:')
  assert.equal(storage.getItem('deepseek-chat:api-key'), 'new')
  assert.equal(storage.getItem('chat-demo:api-key'), null)
})

test('没有旧键时保持原样', () => {
  const storage = fakeStorage({ 'deepseek-chat:font-size': 'm' })
  migrateStoragePrefix(storage, 'chat-demo:', 'deepseek-chat:')
  assert.deepEqual([...storage.data], [['deepseek-chat:font-size', 'm']])
})
