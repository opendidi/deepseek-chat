import { API_ORIGIN_SHIM } from './helpers/apiOrigin.js'
// 工具策略与协议层可能间接引用 api/client.js，先注入构建期常量
void API_ORIGIN_SHIM
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MessageParam, MessageUsage } from '../src/services/api/types.js'
import type { ToolStep } from '../src/services/chat/types.js'
import {
  evaluateExpression,
  runClientTool,
} from '../src/services/agent/tools.js'
import { ALL_TOOL_NAMES, DEFAULT_TOOL_NAMES } from '../src/services/agent/toolConstants.js'
import {
  findRepeatedSteps,
  isTurnLimitReached,
  resolveChatTools,
  stepSignature,
  summarizeToolSteps,
  toolDefinitionText,
} from '../src/services/agent/toolPolicy.js'
import {
  readToolInput,
  sumUsage,
  trimToolResults,
} from '../src/services/chat/reply.js'
import { runToolSteps } from '../src/services/chat/agentLoop.js'

const usage = (
  input: number,
  output: number,
  searches = 0
): MessageUsage => ({
  input_tokens: input,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: output,
  server_tool_use: { web_search_requests: searches, tool_search: 0 },
})

const step = (
  id: string,
  name: string,
  inputJson: string,
  extra: Partial<ToolStep> = {}
): ToolStep => ({ id, name, inputJson, status: 'pending', ...extra })

const toolMessage = (content: string): MessageParam => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 'x', content }],
})

test('聊天模式决定实际下发的工具集', () => {
  const all = new Set(ALL_TOOL_NAMES)
  const base = { search: true, agentTools: true, enabledTools: all }
  const chat = resolveChatTools({ ...base, mode: 'chat' })
  assert.deepEqual(chat.tools, [])
  assert.equal(chat.clientNames.size, 0)

  const standard = resolveChatTools({ ...base, mode: 'standard' })
  assert.equal(standard.tools.length, 5)
  assert.equal(standard.clientNames.size, 3)
  assert.equal(standard.tools[0].name, 'deepseek_read_url')

  const noClient = resolveChatTools({ ...base, mode: 'standard', agentTools: false })
  assert.equal(noClient.tools.length, 2)
  assert.equal(noClient.clientNames.size, 0)

  const full = resolveChatTools({ ...base, mode: 'full', agentTools: false, search: false })
  assert.equal(full.tools.length, 5)
  assert.equal(full.clientNames.size, 3)
  assert.ok(full.tools.some((tool) => tool.name === 'deepseek_web_search'))
})

test('工具往返轮次上限判定', () => {
  assert.equal(isTurnLimitReached(0), false)
  assert.equal(isTurnLimitReached(4), false)
  assert.equal(isTurnLimitReached(5), true)
  assert.equal(isTurnLimitReached(2, 3), true)
})

test('工具粒度开关与默认关闭的页面内容工具', () => {
  const defaults = new Set(DEFAULT_TOOL_NAMES)
  const resolved = resolveChatTools({
    mode: 'standard',
    search: false,
    agentTools: true,
    enabledTools: defaults,
  })
  assert.equal(resolved.clientNames.has('get_page_context'), false)
  assert.equal(resolved.clientNames.has('calculate'), true)
  assert.equal(resolved.tools.length, 3)
  assert.match(toolDefinitionText(resolved.tools), /calculate/)
})

test('重复调用检测与工具步骤聚合', () => {
  const first = step('a', 'calculate', '{"expression":"1+1"}')
  assert.deepEqual(findRepeatedSteps([first], new Set([stepSignature(first)])), ['a'])
  assert.deepEqual(findRepeatedSteps([first], new Set()), [])

  const stats = summarizeToolSteps([
    step('1', 'calculate', '{}', { status: 'done', startedAt: 0, endedAt: 10 }),
    step('2', 'calculate', '{}', { status: 'error', startedAt: 0, endedAt: 30 }),
    step('3', 'get_current_time', '{}', { status: 'done', startedAt: 0, endedAt: 20 }),
  ])
  assert.equal(stats.calls, 3)
  assert.equal(stats.errors, 1)
  assert.equal(stats.totalMs, 60)
  assert.equal(stats.avgMs, 20)
  assert.equal(stats.byName[0].name, 'calculate')
  assert.equal(stats.byName[0].calls, 2)
  assert.equal(stats.byName[0].errors, 1)
  assert.equal(stats.byName[0].avgMs, 20)
})

test('多轮工具往返的用量累加', () => {
  assert.equal(sumUsage([]), undefined)
  const total = sumUsage([usage(10, 5, 1), usage(20, 7, 2)])
  assert.equal(total?.input_tokens, 30)
  assert.equal(total?.output_tokens, 12)
  assert.equal(total?.server_tool_use?.web_search_requests, 3)
})

test('入参解析失败带上可纠正信息', () => {
  assert.deepEqual(readToolInput('{"expression":"1+1"}'), {
    input: { expression: '1+1' },
  })
  assert.equal(readToolInput('{"a":1}').error, undefined)
  const broken = readToolInput('{not json')
  assert.ok(broken.error)
  assert.match(broken.error, /not json/)
  assert.ok(readToolInput('[1,2]').error)
})

test('较早的工具结果超出预算时被摘要替换', () => {
  const messages: MessageParam[] = [
    toolMessage('a'.repeat(6000)),
    toolMessage('b'.repeat(6000)),
    toolMessage('c'.repeat(6000)),
  ]
  const trimmed = trimToolResults(messages, 10_000)
  assert.equal(trimmed.length, 3)
  const contents = trimmed.map((message) =>
    message.role === 'user' && Array.isArray(message.content) && message.content[0].type === 'tool_result'
      ? message.content[0].content
      : ''
  )
  assert.ok(contents[0].length < 100)
  assert.ok(contents[1].length < 100)
  assert.equal(contents[2].length, 6000)
  assert.equal(messages[0].role, 'user')
  assert.deepEqual(trimToolResults([toolMessage('short')], 10_000)[0], toolMessage('short'))
})

test('求值器优先级、右结合与指数上限', () => {
  assert.equal(evaluateExpression('-2^2'), -4)
  assert.equal(evaluateExpression('2^-2'), 0.25)
  assert.equal(evaluateExpression('2^3^2'), 512)
  assert.equal(evaluateExpression('-3 + 5'), 2)
  assert.throws(() => evaluateExpression('2^1001'), Error)
  assert.throws(() => evaluateExpression('1/0'), Error)
})

test('工具执行：未声明工具、取消与结果脱敏', async () => {
  const denied = await runClientTool('calculate', { expression: '1+1' }, undefined, new Set())
  assert.equal(denied.isError, true)

  const controller = new AbortController()
  controller.abort()
  const cancelled = await runClientTool('get_current_time', {}, controller.signal)
  assert.equal(cancelled.isError, true)

  const page = await runClientTool('get_page_context', {}, undefined, new Set(['get_page_context']))
  assert.equal(page.isError, false)
  // Node 环境没有 document，返回的是不可用标记，不应包含完整 URL
  assert.doesNotMatch(page.content, /https?:\/\//)
})

test('runToolSteps 传入允许名单并记录耗时', async () => {
  const steps = [step('a', 'calculate', '{"expression":"6*7"}')]
  const ok = await runToolSteps(steps, new AbortController().signal, new Set(['calculate']))
  assert.equal(ok[0].status, 'done')
  assert.equal(ok[0].result, '42')
  assert.ok(ok[0].startedAt !== undefined && ok[0].endedAt !== undefined)

  const rejected = await runToolSteps(steps, new AbortController().signal, new Set())
  assert.equal(rejected[0].status, 'error')
  assert.equal(steps[0].status, 'pending')
})
