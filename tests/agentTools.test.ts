import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CLIENT_TOOLS,
  clientToolParams,
  evaluateExpression,
  runClientTool,
} from '../src/services/agent/tools.js'

test('表达式求值支持四则运算、括号、幂与一元负号', () => {
  assert.equal(evaluateExpression('1 + 2 * 3'), 7)
  assert.equal(evaluateExpression('(1 + 2) * 3'), 9)
  assert.equal(evaluateExpression('10 / 4'), 2.5)
  assert.equal(evaluateExpression('-3 + 5'), 2)
  assert.equal(evaluateExpression('2 ^ 3 ^ 2'), 512)
  assert.equal(evaluateExpression('2 * (3 + 4) / 7'), 2)
})

test('表达式求值拒绝非法输入，不使用 eval', () => {
  for (const expression of [
    '1 / 0',
    '2 +',
    '1 2',
    'alert(1)',
    'Math.random()',
    '',
    '   ',
    '1;2',
    '1e3',
    'a'.repeat(201),
  ]) {
    assert.throws(() => evaluateExpression(expression), Error, expression)
  }
})

test('工具执行：正常结果、未知工具与异常都返回可回传的结果', async () => {
  assert.deepEqual(await runClientTool('calculate', { expression: '6*7' }), {
    content: '42',
    isError: false,
  })
  const unknown = await runClientTool('not_a_tool', {})
  assert.equal(unknown.isError, true)
  assert.match(unknown.content, /未知工具/)
  const failed = await runClientTool('calculate', { expression: '1/0' })
  assert.equal(failed.isError, true)
  const missing = await runClientTool('calculate', {})
  assert.equal(missing.isError, true)
})

test('clientToolParams 不带 type 且声明合法', () => {
  const params = clientToolParams()
  assert.equal(params.length, CLIENT_TOOLS.length)
  for (const param of params) {
    assert.equal('type' in param, false)
    assert.equal(param.input_schema.type, 'object')
    assert.match(param.name, /^[a-zA-Z0-9_-]+$/)
  }
})
