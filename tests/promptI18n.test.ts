import { API_ORIGIN_SHIM } from './helpers/apiOrigin.js'
void API_ORIGIN_SHIM
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MessageParam } from '../src/services/api/types.js'
import { systemPromptFor } from '../src/services/chat/requestShape.js'
import { compressMessages } from '../src/services/chat/compress.js'
import { clientToolParams } from '../src/services/agent/tools.js'

test('发给模型的系统提示词随界面语言切换', () => {
  assert.match(systemPromptFor('zh-CN'), /该助手为DeepSeek/)
  assert.match(systemPromptFor('en-US'), /created by DeepSeek AI/)
  assert.equal(systemPromptFor('unknown'), systemPromptFor('zh-CN'))
})

test('工具描述与参数说明随界面语言切换', () => {
  const zh = clientToolParams(undefined, 'zh-CN')
  const en = clientToolParams(undefined, 'en-US')
  assert.equal(zh.length, en.length)
  assert.match(zh[0].description ?? '', /获取用户本机/)
  assert.match(en[0].description ?? '', /Get the user local/)

  const calc = en.find((tool) => tool.name === 'calculate')
  assert.ok(calc)
  const expression = calc.input_schema.properties.expression as { description?: string }
  assert.match(expression.description ?? '', /e\.g\./)
})

test('长会话摘要的前缀与角色标签随界面语言切换', () => {
  const messages: MessageParam[] = [
    { role: 'user', content: `旧问题${'内容'.repeat(30_000)}` },
    { role: 'assistant', content: [{ type: 'text', text: '旧回答' }] },
    { role: 'user', content: `新问题${'内容'.repeat(16_000)}` },
  ]
  const zh = compressMessages(messages, true, 'zh-CN')
  assert.match(zh.summary, /此前对话摘要/)
  assert.match(zh.summary, /用户/)

  const en = compressMessages(messages, true, 'en-US')
  assert.match(en.summary, /Earlier conversation summary/)
  assert.match(en.summary, /User/)
})
