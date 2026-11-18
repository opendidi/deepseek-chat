import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatQuotedContent,
  MAX_QUOTE_LENGTH,
  MAX_QUOTE_TOTAL,
  normalizeQuoteText,
  splitQuotedContent,
} from '../src/services/chat/quotes.js'

test('没有有效引用时原样返回用户文本', () => {
  assert.equal(formatQuotedContent('你好', []), '你好')
  assert.equal(formatQuotedContent('  ', []), '  ')
  assert.equal(formatQuotedContent('你好', ['   ']), '你好')
})

test('引用逐行加 > 前缀，末尾接用户提问', () => {
  assert.equal(
    formatQuotedContent('你怎么看？', ['第一段\n第二段']),
    '> 第一段\n> 第二段\n\n你怎么看？'
  )
})

test('多条引用之间空一行；没有提问时只发引用', () => {
  assert.equal(formatQuotedContent('问题', ['甲', '乙']), '> 甲\n\n> 乙\n\n问题')
  assert.equal(formatQuotedContent('', ['甲']), '> 甲')
  assert.equal(formatQuotedContent('   ', ['甲']), '> 甲')
})

test('normalizeQuoteText 去空白并截断超长片段', () => {
  assert.equal(normalizeQuoteText('  内容  '), '内容')
  const long = normalizeQuoteText('x'.repeat(MAX_QUOTE_LENGTH + 100))
  assert.equal(long.length, MAX_QUOTE_LENGTH + 1)
  assert.ok(long.endsWith('…'))
})

test('引用总量不超过上限', () => {
  const content = formatQuotedContent('问题', ['x'.repeat(MAX_QUOTE_TOTAL + 500)])
  const quoted = content.slice(0, content.indexOf('\n\n问题'))
  assert.ok(quoted.length <= MAX_QUOTE_TOTAL + 2)
})

test('splitQuotedContent 还原引用片段与用户提问', () => {
  assert.deepEqual(splitQuotedContent('> 甲\n\n> 乙\n\n问题'), {
    quotes: ['甲', '乙'],
    text: '问题',
  })
  assert.deepEqual(splitQuotedContent('> 第一段\n> 第二段\n\n你怎么看？'), {
    quotes: ['第一段\n第二段'],
    text: '你怎么看？',
  })
  assert.deepEqual(splitQuotedContent('普通消息'), { quotes: [], text: '普通消息' })
  assert.deepEqual(splitQuotedContent('> 甲'), { quotes: ['甲'], text: '' })
})

test('拆分后再拼接可还原原文', () => {
  const original = formatQuotedContent('提问内容', ['引用甲\n第二行', '引用乙'])
  const { quotes, text } = splitQuotedContent(original)
  assert.equal(formatQuotedContent(text, quotes), original)
})
