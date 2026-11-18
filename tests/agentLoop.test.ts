import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runToolSteps } from '../src/services/chat/agentLoop.js'
import type { ToolStep } from '../src/services/chat/types.js'

const step = (id: string, name: string, inputJson: string): ToolStep => ({
  id,
  name,
  inputJson,
  status: 'pending',
})

test('并行执行工具并把结果回填到对应步骤', async () => {
  const steps = [
    step('a', 'calculate', '{"expression":"6*7"}'),
    step('b', 'unknown_tool', '{}'),
    step('c', 'calculate', '{"expression":"1/0"}'),
  ]
  const result = await runToolSteps(steps, new AbortController().signal)
  assert.equal(result[0].status, 'done')
  assert.equal(result[0].result, '42')
  assert.equal(result[1].status, 'error')
  assert.equal(result[2].status, 'error')
  assert.equal(steps[0].status, 'pending')
})

test('没有步骤时返回空数组', async () => {
  assert.deepEqual(await runToolSteps([], new AbortController().signal), [])
})
