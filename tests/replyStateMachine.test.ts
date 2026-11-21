import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyEvent } from '../src/services/chat/reply.js'
import type { AssistantMessage } from '../src/services/chat/types.js'

/** applyEvent 流式状态机的边界路径：thinking / citations / 用量 / 工具步骤索引复用 */

const emptyReply = (): AssistantMessage => ({
  id: 'm1',
  role: 'assistant',
  createdAt: 0,
  model: 'deepseek-flash',
  prefix: true,
  status: 'pending',
  blocks: [],
})

const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 }

const run = (events: Parameters<typeof applyEvent>[1][]) => {
  let reply = emptyReply()
  const blockIndexes = new Map<number, number>()
  for (const event of events) {
    reply = applyEvent(reply, event, 1000, blockIndexes)
  }
  return { reply, blockIndexes }
}

test('thinking 块：增量累积、签名追加、stop 记录结束时间', () => {
  const { reply } = run([
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先想想' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } },
    { type: 'content_block_stop', index: 0 },
  ])
  const block = reply.blocks[0]
  assert.equal(block?.type, 'thinking')
  if (block?.type !== 'thinking') {
    return
  }
  assert.equal(block.thinking, '先想想')
  assert.equal(block.signature, 'sig123')
  assert.equal(block.startedAt, 1000)
  assert.equal(block.endedAt, 1000)
})

test('thinking 块重复 stop 不覆盖已有的结束时间', () => {
  const { reply, blockIndexes } = run([
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_stop', index: 0 },
    // 同一索引重放 stop：索引已被删除，应无效果
    { type: 'content_block_stop', index: 0 },
  ])
  assert.equal(blockIndexes.size, 0)
  const block = reply.blocks[0]
  if (block?.type !== 'thinking') {
    return
  }
  assert.equal(block.endedAt, 1000)
})

test('citations_delta 累加到文本块', () => {
  const { reply } = run([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '结论' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://a', title: null, cited_text: '结论', encrypted_index: '' } },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://b', title: null, cited_text: '结论', encrypted_index: '' } },
    },
  ])
  const block = reply.blocks[0]
  assert.equal(block?.type, 'text')
  if (block?.type !== 'text') {
    return
  }
  assert.equal(block.text, '结论')
  assert.deepEqual(block.citations?.map((item) => item.url), ['https://a', 'https://b'])
})

test('未知块类型不留占位，增量也无害', () => {
  const { reply } = run([
    { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data: 'x' } as never },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'orphan' } },
  ])
  assert.equal(reply.blocks.length, 0)
})

test('message_start 种子用量，message_delta 覆盖为最终用量并记录 stop_reason', () => {
  const startUsage = { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }
  const { reply } = run([
    { type: 'message_start', message: { id: 'm1', model: 'deepseek-flash', usage: startUsage } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage },
  ])
  assert.equal(reply.stopReason, 'end_turn')
  assert.deepEqual(reply.usage, usage)
})

test('两个工具块各自累积入参，索引互不串扰', () => {
  const { reply } = run([
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'amap_geocode', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't2', name: 'amap_place_search', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"b":' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '1}' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '2}' } },
  ])
  const steps = reply.toolSteps ?? []
  assert.equal(steps.length, 2)
  assert.equal(steps[0].inputJson, '{"a":1}')
  assert.equal(steps[1].inputJson, '{"b":2}')
  assert.equal(steps.every((step) => step.status === 'pending'), true)
})

test('工具块的 stop 不会误设思考块结束时间；未登记索引的增量被忽略', () => {
  const { reply } = run([
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'amap_geocode', input: {} } },
    { type: 'content_block_delta', index: 7, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } },
    { type: 'content_block_stop', index: 0 },
  ])
  const steps = reply.toolSteps ?? []
  assert.equal(steps.length, 1)
  assert.equal(steps[0].inputJson, '')
})

test('工具块 stop 后同索引再来增量不影响任何步骤', () => {
  const { reply } = run([
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'amap_geocode', input: {} } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"late":1}' } },
  ])
  const steps = reply.toolSteps ?? []
  assert.equal(steps[0].inputJson, '')
})

test('收到流式事件后状态转为 streaming；正文与工具步骤可以共存', () => {
  const { reply } = run([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '先答一半' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'amap_geocode', input: {} } },
  ])
  assert.equal(reply.status, 'streaming')
  assert.equal(reply.prefix, false)
  const text = reply.blocks[0]
  assert.equal(text?.type === 'text' && text.text, '先答一半')
  assert.equal(reply.toolSteps?.length, 1)
})
