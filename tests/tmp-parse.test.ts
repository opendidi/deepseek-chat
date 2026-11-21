import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMessageEvent } from '../src/services/api/parseEvent.js'
import { applyEvent } from '../src/services/chat/reply.js'
import type { AssistantMessage } from '../src/services/chat/types.js'

const usage = { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 }
const events = [
  { type: 'message_start', message: { id: 'm1', model: 'deepseek-flash', usage } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'amap_geocode' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"address":"佛山市顺德顺峰山公园"}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage },
  { type: 'message_stop' },
]

test('mock 的 tool_use 事件能被解析链路创建 toolSteps', () => {
  let reply: AssistantMessage | null = null
  const blockIndexes = new Map<number, number>()
  for (const event of events) {
    const parsed = readMessageEvent(event)
    if (!parsed) {
      continue
    }
    const current: AssistantMessage = reply ?? {
      id: 'm1',
      role: 'assistant',
      createdAt: 0,
      model: 'deepseek-flash',
      prefix: true,
      status: 'pending',
      blocks: [],
    }
    reply = applyEvent(current, parsed, Date.now(), blockIndexes)
  }
  assert.ok(reply)
  const steps = reply.toolSteps ?? []
  assert.equal(steps.length, 1, `toolSteps 应有 1 条，实际 ${JSON.stringify(steps)}`)
  assert.equal(steps[0].name, 'amap_geocode')
  assert.match(steps[0].inputJson, /顺德顺峰山公园/)
})
