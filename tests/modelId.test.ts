import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSafeModelId, parseModelIds } from '../src/utils/modelId.js'

test('isSafeModelId 接受正常模型 id，拒绝超长与控制字符', () => {
  assert.equal(isSafeModelId('deepseek-flash'), true)
  assert.equal(isSafeModelId('custom/model.v1'), true)
  assert.equal(isSafeModelId(''), false)
  assert.equal(isSafeModelId('a'.repeat(129)), false)
  assert.equal(isSafeModelId('bad\nmodel'), false)
  assert.equal(isSafeModelId('bad\u0000model'), false)
  assert.equal(isSafeModelId('a'.repeat(128)), true)
})

test('parseModelIds 解析 data 数组、去重、trim 并限制条数', () => {
  assert.deepEqual(
    parseModelIds({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }),
    ['deepseek-flash', 'deepseek-v4-pro']
  )
  assert.deepEqual(
    parseModelIds({ data: [{ id: ' a ' }, { id: 'a' }, { id: 'b' }] }),
    ['a', 'b']
  )
  assert.equal(
    parseModelIds({ data: Array.from({ length: 80 }, (_, i) => ({ id: `m-${i}` })) }).length,
    50
  )
})

test('parseModelIds 拒绝脏数据与非字符串 id', () => {
  for (const payload of [
    null,
    {},
    { data: 'not-an-array' },
    { data: [null, 1, 'x', { id: 7 }, { id: '' }, { id: 'x'.repeat(129) }] },
    { data: [{ id: { nested: true } }, {}] },
  ]) {
    assert.deepEqual(parseModelIds(payload), [], JSON.stringify(payload))
  }
})
