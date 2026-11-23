import { translate, type TranslationMessage } from '../../i18n/index.js'
import { getAccessKey, notifyUnauthorized } from '../chat/accessKey.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/**
 * 模型 API 地址：一律走本机 FastAPI 的 /api/deepseek 代理，Key 只存在于服务端 .env。
 * 开发模式由 devServer 代理 /api 到 127.0.0.1:8000，生产模式与后端同源。
 */
export const DEEPSEEK_PROXY = '/api/deepseek'
export const DEEPSEEK_TOOLS_PROXY = `${DEEPSEEK_PROXY}/tools`
export const DEEPSEEK_MODELS_URL = `${DEEPSEEK_PROXY}/models`

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'
  /** 服务端未配置 DEEPSEEK_API_KEY */
  | 'keyMissing'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage
  /** 服务端错误码：DEEPSEEK_KEY_MISSING / UPSTREAM_ERROR 等 */
  readonly code?: string

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number,
    code?: string
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
    this.code = code
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody & { code?: string } =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

/** 代理的 SSE error 帧形如 {"error":{"message":"…"},"status":402,"code":"UPSTREAM_ERROR"} */
const sseErrorToApiError = (payload: unknown, raw: string): ApiError => {
  if (!isErrorBody(payload)) {
    return new ApiError('stream', raw)
  }
  const frame = payload as ApiErrorBody & { status?: unknown; code?: unknown }
  const code = typeof frame.code === 'string' ? frame.code : undefined
  const status = typeof frame.status === 'number' ? frame.status : undefined
  const kind = code === 'DEEPSEEK_KEY_MISSING' ? 'keyMissing' : 'stream'
  return new ApiError(kind, frame.error.message, status, code)
}

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  let code: string | undefined
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
      code = body.code
    } else if (typeof body === 'object' && body !== null) {
      // 代理层错误形如 {"detail":"...","code":"..."}
      const detail = (body as { detail?: unknown }).detail
      code = (body as { code?: unknown }).code as string | undefined
      if (typeof detail === 'string') {
        message = detail
      }
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  const kindOverride = code === 'DEEPSEEK_KEY_MISSING' ? 'keyMissing' : kind
  return new ApiError(kindOverride, message, response.status, code)
}

/** 同源 /api 请求：自动带访问口令，401 时弹输入门 */
export const request = async (url: string, init: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers)
  const accessKey = getAccessKey()
  if (accessKey) {
    headers.set('x-access-key', accessKey)
  }
  let response: Response
  try {
    response = await fetch(url, { ...init, headers })
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (response.status === 401 && !response.headers.has('x-proxy-error')) {
    // 只有本机访问口令失效才弹输入门；上游模型 Key 失效由代理透传，
    // 带 x-proxy-error 头，应由错误文案提示部署方更新 Key，而不是让用户输口令。
    notifyUnauthorized()
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

/**
 * POST /api/deepseek/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${DEEPSEEK_PROXY}/files`, {
    method: 'POST',
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /api/deepseek/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * 代理层逐块透传 SSE；ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${DEEPSEEK_PROXY}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(hasFile(body) ? { 'anthropic-beta': 'files-api-2025-04-14' } : {}),
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    // 代理把上游 4xx/5xx 与网络异常编码成带 status/code 的 error 帧，
    // 必须还原状态码，否则余额不足/限流会被 describeReply 当成通用错误。
    if (isErrorBody(payload)) {
      throw sseErrorToApiError(payload, data)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
