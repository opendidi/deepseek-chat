import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isWebUrl, safeWebUrl } from '../src/utils/url.js'

test('isWebUrl 只接受绝对 HTTP(S) 地址', () => {
  for (const value of [
    'https://example.com/a?b=1',
    'http://localhost:8080/x',
    'HTTPS://EXAMPLE.COM',
    'https://例子.测试/路径',
  ]) {
    assert.equal(isWebUrl(value), true, value)
  }
  for (const value of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/id',
    '//example.com/path',
    '/relative',
    '',
    'not a url',
    'https://',
  ]) {
    assert.equal(isWebUrl(value), false, value)
  }
})

test('safeWebUrl 对不可信输入返回 undefined', () => {
  assert.equal(safeWebUrl('https://example.com'), 'https://example.com')
  assert.equal(safeWebUrl('javascript:alert(1)'), undefined)
  assert.equal(safeWebUrl(null), undefined)
  assert.equal(safeWebUrl(undefined), undefined)
  assert.equal(safeWebUrl(42), undefined)
  assert.equal(safeWebUrl({}), undefined)
})
