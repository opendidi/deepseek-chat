import { ApiError, request } from './api/client.js'

/** 服务端 MCP 路由前缀（与 server/routers/mcp.py 一致） */
const MCP_API = '/api/mcp'

export type McpToolParam = {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export type McpStatus = {
  configured: boolean
  servers: string[]
}

let cachedTools: McpToolParam[] | null = null
let cachedError: string | null = null
let cacheTime = 0
const CACHE_TTL = 30_000

export type McpToolsResult = { tools: McpToolParam[]; error: string | null }

/** 拉工具列表；失败时返回空数组 + 错误文案，让设置页能显示真实原因 */
export const fetchMcpTools = async (signal?: AbortSignal): Promise<McpToolsResult> => {
  const now = Date.now()
  if (cachedTools && now - cacheTime < CACHE_TTL) {
    return { tools: cachedTools, error: cachedError }
  }
  try {
    const response = await request(`${MCP_API}/tools`, { method: 'GET', signal })
    const tools = (await response.json()) as McpToolParam[]
    if (!Array.isArray(tools)) {
      throw new Error('工具列表格式无效')
    }
    cachedTools = tools
    cachedError = null
  } catch (error) {
    cachedTools = []
    cachedError = error instanceof ApiError ? error.message : String(error)
  }
  cacheTime = Date.now()
  return { tools: cachedTools, error: cachedError }
}

/** 清缓存：设置页切换 MCP 开关后调用 */
export const invalidateMcpTools = () => {
  cachedTools = null
  cachedError = null
  cacheTime = 0
}

/** 手动重载服务端 MCP 配置 */
export const reloadMcpConfig = async (): Promise<McpStatus> => {
  const response = await request(`${MCP_API}/reload`, { method: 'POST' })
  invalidateMcpTools()
  return (await response.json()) as McpStatus
}

/** 调用 MCP 工具，返回纯文本结果；错误转成可直接展示的 ApiError */
export const callMcpTool = async (
  name: string,
  arguments_: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ content: string; isError: boolean }> => {
  try {
    const response = await request(`${MCP_API}/call`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: arguments_ }),
    })
    const data = (await response.json()) as { content?: string; isError?: boolean }
    return { content: String(data.content ?? ''), isError: data.isError === true }
  } catch (error) {
    const message = error instanceof ApiError ? error.message : String(error)
    return { content: `[MCP 调用失败] ${message}`, isError: true }
  }
}

/** 供设置页显示状态；失败时当作未配置 */
export const fetchMcpStatus = async (): Promise<McpStatus> => {
  try {
    const response = await request(`${MCP_API}/status`, { method: 'GET' })
    return (await response.json()) as McpStatus
  } catch {
    return { configured: false, servers: [] }
  }
}

export type McpServerConfig = {
  enabled: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  timeout?: number
}

export type McpConfig = {
  servers: Record<string, McpServerConfig>
  canWrite?: boolean
  reason?: string | null
}

/** 读取完整配置（含未启用的服务器）；canWrite 表示当前是否允许保存 */
export const fetchMcpConfig = async (): Promise<McpConfig> => {
  const response = await request(`${MCP_API}/config`, { method: 'GET' })
  return (await response.json()) as McpConfig
}

/** 保存配置；失败时抛出带服务端文案的错误 */
export const saveMcpConfig = async (config: McpConfig): Promise<McpConfig> => {
  const response = await request(`${MCP_API}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ servers: config.servers }),
  })
  const data = (await response.json()) as { config?: McpConfig }
  invalidateMcpTools()
  return data.config ?? { servers: config.servers }
}

export type McpServerDraft = {
  key: string
  name: string
  config: McpServerConfig
  argsText: string
  envText: string
  headersText: string
}

export const toServerDraft = (name: string, config: McpServerConfig): McpServerDraft => ({
  key: `${name}-${Math.random().toString(36).slice(2)}`,
  name,
  config,
  argsText: (config.args ?? []).join('\n'),
  envText: Object.keys(config.env ?? {}).length ? JSON.stringify(config.env, null, 2) : '',
  headersText: Object.keys(config.headers ?? {}).length ? JSON.stringify(config.headers, null, 2) : '',
})

const parseJsonMap = (text: string, field: string): Record<string, string> => {
  if (!text.trim()) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${field} 不是合法 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${field} 应为 JSON 对象`)
  }
  for (const value of Object.values(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`${field} 的值必须是字符串`)
    }
  }
  return parsed as Record<string, string>
}

/** 把表单草稿转成可提交配置，字段名与服务端配置一致；非法输入抛错 */
export const buildMcpConfig = (drafts: McpServerDraft[]): McpConfig => {
  const servers: Record<string, McpServerConfig> = {}
  for (const draft of drafts) {
    const name = draft.name.trim()
    if (!name) {
      throw new Error('服务器名称不能为空')
    }
    if (name.includes('__')) {
      throw new Error(`服务器名 ${name} 不能包含双下划线`)
    }
    const isHttp = Boolean(draft.config.url?.trim())
    const config: McpServerConfig = {
      enabled: draft.config.enabled,
      timeout: draft.config.timeout,
    }
    if (isHttp) {
      config.url = draft.config.url?.trim()
      const headers = parseJsonMap(draft.headersText, 'Headers')
      if (Object.keys(headers).length) {
        config.headers = headers
      }
    } else {
      config.command = (draft.config.command ?? '').trim()
      const args = draft.argsText.split('\n').map((line) => line.trim()).filter(Boolean)
      if (args.length) {
        config.args = args
      }
      const env = parseJsonMap(draft.envText, 'Env')
      if (Object.keys(env).length) {
        config.env = env
      }
    }
    servers[name] = config
  }
  return { servers }
}

/** 是否是 MCP 工具（工具名带 mcp__ 前缀） */
export const isMcpTool = (name: string): boolean => name.startsWith('mcp__')
