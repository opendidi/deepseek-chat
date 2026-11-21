import { translate } from '../../i18n/index.js'
import type { ClientToolParam } from '../api/types.js'
import { TOOL_PROMPTS, promptLocale } from './promptI18n.js'

/**
 * 浏览器端可执行的客户端工具。请求里只声明 name / description / input_schema，
 * 模型返回 tool_use 后由 runClientTool 本地执行，结果以 tool_result 回传。
 *
 * 工具带元数据（分类、超时、结果预算、是否需要授权），聊天模式与工具开关据此过滤；
 * 不接触文件系统与进程，结果统一截断，避免把大对象塞进上下文。
 */

export type ToolCategory = 'basic' | 'browser' | 'workspace'

export type ClientTool = {
  name: string
  description: string
  input_schema: ClientToolParam['input_schema']
  category: ToolCategory
  /** 涉及页面内容等敏感信息，需要用户单独开启 */
  requiresConsent?: boolean
  /** 单次执行超时（ms） */
  timeoutMs?: number
  /** 结果长度预算 */
  maxResult?: number
  run: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<string>
}

const MAX_RESULT_LENGTH = 4000
const DEFAULT_TIMEOUT_MS = 5000
const MAX_EXPRESSION_LENGTH = 200
/** 单次求值的运算步数上限，避免超长表达式拖住主线程 */
const MAX_OPERATIONS = 512
/** 指数绝对值上限，避免 2^999999 这类巨大计算 */
const MAX_EXPONENT = 1000

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…${translate('agentToolTruncated')}` : value

/** 只支持数字、四则运算、幂与括号的递归下降求值；不使用 eval，不接受变量或函数。
 * 优先级：括号 > 幂 > 一元负号 > 乘除 > 加减，因此 -2^2 = -4 符合数学惯例。
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
  let operations = 0
  const countOp = () => {
    operations += 1
    if (operations > MAX_OPERATIONS) {
      throw new Error(translate('agentToolErrorTooComplex'))
    }
  }
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
  const parsePower = (): number => {
    const base = parseAtom()
    if (peek() !== '^') {
      return base
    }
    take()
    countOp()
    const exponent = parseUnary()
    if (Math.abs(exponent) > MAX_EXPONENT) {
      throw new Error(translate('agentToolErrorExponent'))
    }
    return base ** exponent
  }
  const parseUnary = (): number => {
    if (peek() !== '-') {
      return parsePower()
    }
    take()
    countOp()
    return -parseUnary()
  }
  const parseTerm = (): number => {
    let value = parseUnary()
    while (peek() === '*' || peek() === '/') {
      const operator = take()
      countOp()
      const right = parseUnary()
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
      countOp()
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

export const TOOL_REGISTRY: readonly ClientTool[] = [
  {
    name: 'get_current_time',
    category: 'basic',
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
    category: 'basic',
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
    category: 'browser',
    requiresConsent: true,
    description: '读取当前页面的标题、站点地址与用户选中的文字，用于解释用户正在看的内容。',
    input_schema: { type: 'object', properties: {} },
    run: async () => {
      if (typeof document === 'undefined') {
        return JSON.stringify({ title: '', origin: '', path: '', selection: '', unavailable: true })
      }
      // 只发 origin + pathname，不带 query / hash，避免把 token 或会话参数发给模型
      return JSON.stringify({
        title: document.title,
        origin: location.origin,
        path: location.pathname,
        selection: window.getSelection()?.toString().slice(0, 1000) ?? '',
        queryShared: false,
      })
    },
  },
]

/** 兼容既有调用点 */
export const CLIENT_TOOLS = TOOL_REGISTRY
export const TOOL_NAMES: readonly string[] = TOOL_REGISTRY.map((tool) => tool.name)

/** 生成请求体 tools 中的客户端工具声明（不能带 type，否则会被当成服务端工具） */
export const clientToolParams = (
  enabled?: ReadonlySet<string>,
  locale = 'zh-CN'
): ClientToolParam[] => {
  const lang = promptLocale(locale)
  return TOOL_REGISTRY.filter((tool) => !enabled || enabled.has(tool.name)).map((tool) => {
    const text = TOOL_PROMPTS[tool.name]?.[lang]
    const properties = { ...tool.input_schema.properties }
    const expression = properties.expression
    if (text?.expression && expression && typeof expression === 'object') {
      properties.expression = { ...(expression as Record<string, unknown>), description: text.expression }
    }
    return {
      name: tool.name,
      description: text?.description ?? tool.description,
      input_schema: { ...tool.input_schema, properties },
    }
  })
}

export type ClientToolResult = { content: string; isError: boolean }

/** 给单个工具加超时与取消：abort 或超时都立即返回可回传的错误结果 */
const withTimeout = <T>(task: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(translate('agentToolCancelled')))
      return
    }
    const timer = setTimeout(() => reject(new Error(translate('agentToolTimeout'))), ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error(translate('agentToolCancelled')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    task.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      }
    )
  })

/** 执行单个工具；任何异常都转成 is_error 结果回传给模型，不中断对话 */
export const runClientTool = async (
  name: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  allowedNames?: ReadonlySet<string>
): Promise<ClientToolResult> => {
  if (allowedNames && !allowedNames.has(name)) {
    return { content: translate('agentToolNotDeclared', { name }), isError: true }
  }
  const tool = TOOL_REGISTRY.find((item) => item.name === name)
  if (!tool) {
    return { content: translate('agentToolUnknown', { name }), isError: true }
  }
  try {
    const content = await withTimeout(
      Promise.resolve().then(() => tool.run(input, signal)),
      tool.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    )
    return { content: truncate(content, tool.maxResult ?? MAX_RESULT_LENGTH), isError: false }
  } catch (error) {
    return {
      content: truncate(error instanceof Error ? error.message : String(error), MAX_RESULT_LENGTH),
      isError: true,
    }
  }
}
