import { translate } from '../../i18n/index.js'
import type { ClientToolParam } from '../api/types.js'

/**
 * 浏览器端可执行的客户端工具。请求里只声明 name / description / input_schema，
 * 模型返回 tool_use 后由 runClientTool 本地执行，结果以 tool_result 回传。
 * 工具不接触文件系统与进程，结果统一截断，避免把大对象塞进上下文。
 */

export type ClientTool = {
  name: string
  description: string
  input_schema: ClientToolParam['input_schema']
  run: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<string>
}

const MAX_RESULT_LENGTH = 4000
const MAX_EXPRESSION_LENGTH = 200

const truncate = (value: string): string =>
  value.length > MAX_RESULT_LENGTH ? `${value.slice(0, MAX_RESULT_LENGTH)}…` : value

/** 只支持数字、四则运算、幂与括号的递归下降求值；不使用 eval，不接受变量或函数。
 * 错误文案走 i18n：消息会显示在 ToolSteps 并回传给模型，语言随当前界面 */
export const evaluateExpression = (expression: string): number => {
  if (!expression.trim() || expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(translate('agentToolErrorEmpty'))
  }
  const tokens: string[] = []
  for (let i = 0; i < expression.length; ) {
    const char = expression[i]
    if (/\s/.test(char)) {
      i += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      let end = i
      while (end < expression.length && /[0-9.]/.test(expression[end])) {
        end += 1
      }
      const number = expression.slice(i, end)
      if (!/^\d+(\.\d+)?$/.test(number)) {
        throw new Error(translate('agentToolErrorBadNumber', { value: number }))
      }
      tokens.push(number)
      i = end
      continue
    }
    if ('+-*/^()'.includes(char)) {
      tokens.push(char)
      i += 1
      continue
    }
    throw new Error(translate('agentToolErrorBadChar', { value: char }))
  }

  let position = 0
  const peek = () => tokens[position]
  const take = () => tokens[position++]
  const parseAtom = (): number => {
    const token = take()
    if (token === '(') {
      const value = parseExpr()
      if (take() !== ')') {
        throw new Error(translate('agentToolErrorMissingParen'))
      }
      return value
    }
    if (token === undefined || !/^\d/.test(token)) {
      throw new Error(translate('agentToolErrorMissingOperand'))
    }
    return Number(token)
  }
  const parseUnary = (): number => (peek() === '-' ? (take(), -parseUnary()) : parseAtom())
  const parsePower = (): number => {
    const base = parseUnary()
    return peek() === '^' ? (take(), base ** parsePower()) : base
  }
  const parseTerm = (): number => {
    let value = parsePower()
    while (peek() === '*' || peek() === '/') {
      const operator = take()
      const right = parsePower()
      if (operator === '/' && right === 0) {
        throw new Error(translate('agentToolErrorDivideByZero'))
      }
      value = operator === '*' ? value * right : value / right
    }
    return value
  }
  const parseExpr = (): number => {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const operator = take()
      const right = parseTerm()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  const result = parseExpr()
  if (position !== tokens.length) {
    throw new Error(translate('agentToolErrorTrailing'))
  }
  if (!Number.isFinite(result)) {
    throw new Error(translate('agentToolErrorNotFinite'))
  }
  return result
}

export const CLIENT_TOOLS: readonly ClientTool[] = [
  {
    name: 'get_current_time',
    description: '获取用户本机的当前日期、时间与时区。回答涉及「今天」「现在」等问题时使用。',
    input_schema: { type: 'object', properties: {} },
    run: async () => {
      const now = new Date()
      return JSON.stringify({
        iso: now.toISOString(),
        local: now.toLocaleString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    },
  },
  {
    name: 'calculate',
    description: '计算一个数学表达式，支持 + - * / ^ 与括号。用于需要精确数值的运算。',
    input_schema: {
      type: 'object',
      properties: { expression: { type: 'string', description: '例如 (12 + 8) * 3 / 4' } },
      required: ['expression'],
    },
    run: async (input) => {
      if (typeof input.expression !== 'string') {
        throw new Error(translate('agentToolErrorMissingParam', { name: 'expression' }))
      }
      return String(evaluateExpression(input.expression))
    },
  },
  {
    name: 'get_page_context',
    description: '读取当前页面的标题、地址与用户选中的文字，用于解释用户正在看的内容。',
    input_schema: { type: 'object', properties: {} },
    run: async () => {
      if (typeof document === 'undefined') {
        return JSON.stringify({ title: '', url: '', selection: '', unavailable: true })
      }
      return JSON.stringify({
        title: document.title,
        url: location.href,
        selection: window.getSelection()?.toString().slice(0, 1000) ?? '',
      })
    },
  },
]

/** 生成请求体 tools 中的客户端工具声明（不能带 type，否则会被当成服务端工具） */
export const clientToolParams = (): ClientToolParam[] =>
  CLIENT_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }))

export type ClientToolResult = { content: string; isError: boolean }

/** 执行单个工具；任何异常都转成 is_error 结果回传给模型，不中断对话 */
export const runClientTool = async (
  name: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ClientToolResult> => {
  const tool = CLIENT_TOOLS.find((item) => item.name === name)
  if (!tool) {
    return { content: translate('agentToolUnknown', { name }), isError: true }
  }
  try {
    if (signal?.aborted) {
      throw new Error(translate('agentToolCancelled'))
    }
    return { content: truncate(await tool.run(input, signal)), isError: false }
  } catch (error) {
    return {
      content: truncate(error instanceof Error ? error.message : String(error)),
      isError: true,
    }
  }
}
