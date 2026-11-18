import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMessageEvent } from '../src/services/api/parseEvent.js'
import { applyEvent, parseToolInput, toToolTurnMessages } from '../src/services/chat/reply.js'
import type { AssistantMessage } from '../src/services/chat/types.js'

const emptyReply = (): AssistantMessage => ({
  id: 'a1',
  role: 'assistant',
  createdAt: 0,
  model: null,
  prefix: false,
  status: 'pending',
  blocks: [],
})

test('tool_use 与 input_json_delta 不再被丢弃', () => {
  const start = readMessageEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'toolu_1', name: 'calculate', input: {} },
  })
  assert.equal(start?.type, 'content_block_start')
  const delta = readMessageEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"expression":' },
  })
  assert.equal(delta?.type, 'content_block_delta')
  assert.equal(
    readMessageEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 7, name: 'calculate', input: {} },
    }),
    null
  )
})

test('applyEvent 流式累积工具入参并记录步骤', () => {
  const indexes = new Map<number, number>()
  let state = emptyReply()
  state = applyEvent(
    state,
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'calculate', input: {} },
    },
    0,
    indexes
  )
  state = applyEvent(
    state,
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"expression":"1' },
    },
    0,
    indexes
  )
  state = applyEvent(
    state,
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '+2"}' },
    },
    0,
    indexes
  )
  state = applyEvent(state, { type: 'content_block_stop', index: 0 }, 0, indexes)
  assert.equal(state.toolSteps?.length, 1)
  assert.equal(state.toolSteps?.[0].inputJson, '{"expression":"1+2"}')
  assert.equal(state.toolSteps?.[0].status, 'pending')
  assert.equal(state.prefix, false)
})

test('parseToolInput 容错', () => {
  assert.deepEqual(parseToolInput('{"a":1}'), { a: 1 })
  assert.deepEqual(parseToolInput(''), {})
  assert.deepEqual(parseToolInput('{oops'), {})
  assert.deepEqual(parseToolInput('[1,2]'), {})
})

test('toToolTurnMessages 回传 assistant(tool_use) + user(tool_result)', () => {
  const state: AssistantMessage = {
    ...emptyReply(),
    blocks: [{ type: 'text', text: '我来算一下' }],
    toolSteps: [
      {
        id: 'toolu_1',
        name: 'calculate',
        inputJson: '{"expression":"6*7"}',
        status: 'done',
        result: '42',
      },
    ],
  }
  const messages = toToolTurnMessages(state, 0, 0)
  assert.equal(messages?.length, 2)
  const assistant = messages?.[0]
  assert.equal(assistant?.role, 'assistant')
  const toolUse =
    assistant?.role === 'assistant'
      ? assistant.content.find((block) => block.type === 'tool_use')
      : undefined
  assert.deepEqual(toolUse, {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'calculate',
    input: { expression: '6*7' },
  })
  const user = messages?.[1]
  assert.equal(user?.role, 'user')
  assert.deepEqual(user?.content, [
    { type: 'tool_result', tool_use_id: 'toolu_1', content: '42' },
  ])
  assert.equal(toToolTurnMessages(state, 0, 1), null)
})
