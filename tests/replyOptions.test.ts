import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canContinueReply, settleReply } from '../src/services/chat/reply.js'
import type { AssistantMessage } from '../src/services/chat/types.js'

const reply = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: 'a1',
  role: 'assistant',
  createdAt: 0,
  model: null,
  prefix: false,
  status: 'done',
  blocks: [],
  ...overrides,
})

test('防撤回：默认丢弃 refusal 已下发正文，开启后保留', () => {
  const refused = reply({
    stopReason: 'refusal',
    blocks: [{ type: 'text', text: '已下发正文' }],
  })
  assert.equal(settleReply(refused, 'done', 0).blocks.length, 0)
  const kept = settleReply(refused, 'done', 0, { keepRefusedContent: true })
  assert.equal(kept.blocks.length, 1)
  assert.equal(kept.blocks[0].type, 'text')
})

test('防撤回不影响正常回复，错误对象仍透传', () => {
  const normal = reply({ blocks: [{ type: 'text', text: '正常' }] })
  const settled = settleReply(normal, 'error', 0, {
    error: { kind: 'network', message: 'offline' },
    keepRefusedContent: true,
  })
  assert.equal(settled.blocks.length, 1)
  assert.equal(settled.error?.message, 'offline')
})

test('拒绝后继续生成：默认隐藏，开启且状态可续写时放行', () => {
  const refused = reply({ prefix: true, status: 'stopped', stopReason: 'refusal' })
  assert.equal(canContinueReply(refused), false)
  assert.equal(canContinueReply(refused, true), true)
  // 无续写前缀时仍不允许，开关只放开 refusal 这一个限制
  assert.equal(canContinueReply(reply({ status: 'stopped', stopReason: 'refusal' }), true), false)
})
