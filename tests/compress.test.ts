import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MessageParam } from '../src/services/api/types.js'
import {
  compressMessages,
  CONTEXT_CHAR_BUDGET,
  KEEP_CHAR_BUDGET,
  SUMMARY_CHAR_LIMIT,
  messageText,
} from '../src/services/chat/compress.js'

const user = (text: string): MessageParam => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = (text: string): MessageParam => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
})

const longHistory = (): MessageParam[] => {
  const messages: MessageParam[] = []
  for (let i = 0; i < 30; i += 1) {
    messages.push(user(`问题 ${i} `.repeat(200)))
    messages.push(assistant(`回答 ${i} `.repeat(200)))
  }
  messages.push(user('本轮提问'))
  return messages
}

test('未开启或上下文未超预算时原样返回', () => {
  const messages = [user('你好'), assistant('你好呀'), user('继续')]
  const closed = compressMessages(messages, false)
  assert.equal(closed.messages, messages)
  assert.equal(closed.summary, '')
  assert.equal(compressMessages(messages, true).summary, '')
})

test('超预算时折叠早期轮次：首条是 user、末尾本轮提问保留、摘要有长度上限', () => {
  const messages = longHistory()
  const total = messages.reduce((sum, message) => sum + messageText(message).length, 0)
  assert.ok(total > CONTEXT_CHAR_BUDGET)
  const result = compressMessages(messages, true)
  assert.ok(result.messages.length < messages.length)
  assert.equal(result.messages[0].role, 'user')
  assert.equal(result.messages.at(-1)?.role, 'user')
  assert.match(result.summary, /此前对话摘要/)
  assert.ok(result.summary.length <= SUMMARY_CHAR_LIMIT + 2)
  const keptSize = result.messages.reduce((sum, message) => sum + messageText(message).length, 0)
  assert.ok(keptSize <= KEEP_CHAR_BUDGET + 2000)
})

test('附件与工具块不参与文本估算，latest_reminder 内容可进入摘要', () => {
  const reminder: MessageParam = { role: 'latest_reminder', content: '位置：中国' }
  const withFile: MessageParam = {
    role: 'user',
    content: [
      { type: 'image', source: { type: 'file', file_id: 'f1' } },
      { type: 'text', text: '看图' },
    ],
  }
  assert.equal(messageText(withFile), '看图')
  assert.equal(messageText(reminder), '位置：中国')
  assert.equal(compressMessages([reminder, withFile], true).summary, '')
})
