import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseActiveSessionHash, readActiveSessionId } from '../src/services/chat/activeSession.js'

test('解析合法会话 hash，支持 URL 编码的 id', () => {
  assert.equal(parseActiveSessionHash('#s=sess_123'), 'sess_123')
  assert.equal(parseActiveSessionHash(`#s=${encodeURIComponent('a/b c')}`), 'a/b c')
})

test('非法 hash 一律忽略', () => {
  for (const hash of [
    '',
    '#',
    '#s=',
    '#other=x',
    '#s=%E0%A4%A',
    `#s=${'a'.repeat(129)}`,
    `#s=${encodeURIComponent('bad\nid')}`,
  ]) {
    assert.equal(parseActiveSessionHash(hash), null, hash)
  }
})

test('Node 环境没有 window 时安全返回 null', () => {
  assert.equal(readActiveSessionId(), null)
})
