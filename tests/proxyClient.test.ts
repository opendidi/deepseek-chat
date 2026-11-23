import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installMemoryStorage } from './helpers/localStorage.js'

installMemoryStorage()
const { ApiError, DEEPSEEK_PROXY, request } = await import('../src/services/api/client.js')
const { getAccessKey, setAccessKey, useAccessKey } = await import(
  '../src/services/chat/accessKey.js'
)

type StubOptions = {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

/** 替换全局 fetch，记录请求头并返回可控响应；每个用例结束后恢复 */
const stubFetch = (options: StubOptions = {}) => {
  const original = globalThis.fetch
  let sentHeaders: Headers | undefined
  let sentUrl = ''
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    sentUrl = typeof input === 'string' ? input : String(input)
    sentHeaders = new Headers(init?.headers)
    return new Response(JSON.stringify(options.body ?? {}), {
      status: options.status ?? 200,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    })
  }) as typeof fetch
  return {
    restore: () => {
      globalThis.fetch = original
    },
    get headers() {
      return sentHeaders
    },
    get url() {
      return sentUrl
    },
  }
}

test('request 自动携带访问口令，走同源代理路径', async () => {
  setAccessKey('my-access-key')
  const stub = stubFetch({ body: { data: [] } })
  try {
    await request(`${DEEPSEEK_PROXY}/models`, { method: 'GET' })
    assert.equal(stub.headers?.get('x-access-key'), 'my-access-key')
    assert.equal(stub.url, '/api/deepseek/models')
  } finally {
    stub.restore()
  }
  assert.equal(getAccessKey(), 'my-access-key')
})

test('本机口令 401：无 x-proxy-error 头时弹输入门', async () => {
  useAccessKey.setState({ unauthorized: false })
  const stub = stubFetch({ status: 401, body: { detail: 'unauthorized' } })
  try {
    await assert.rejects(
      () => request(`${DEEPSEEK_PROXY}/models`, { method: 'GET' }),
      (error: unknown) => error instanceof ApiError && error.status === 401
    )
    assert.equal(useAccessKey.getState().unauthorized, true)
  } finally {
    stub.restore()
  }
})

test('上游模型 Key 失效 401：带 x-proxy-error 头，不弹口令门', async () => {
  useAccessKey.setState({ unauthorized: false })
  const stub = stubFetch({
    status: 401,
    body: { detail: 'invalid api key', code: 'UPSTREAM_ERROR' },
    headers: { 'x-proxy-error': 'upstream' },
  })
  try {
    await assert.rejects(
      () => request(`${DEEPSEEK_PROXY}/models`, { method: 'GET' }),
      (error: unknown) => error instanceof ApiError && error.code === 'UPSTREAM_ERROR'
    )
    assert.equal(useAccessKey.getState().unauthorized, false)
  } finally {
    stub.restore()
  }
})

test('DEEPSEEK_KEY_MISSING 转成 keyMissing，供各处统一提示', async () => {
  const stub = stubFetch({
    status: 400,
    body: { detail: '服务器未配置', code: 'DEEPSEEK_KEY_MISSING' },
  })
  try {
    await assert.rejects(
      () => request(`${DEEPSEEK_PROXY}/models`, { method: 'GET' }),
      (error: unknown) => error instanceof ApiError && error.kind === 'keyMissing'
    )
  } finally {
    stub.restore()
  }
})

test('上游 402/429 的 code 与 status 被保留，错误分类不丢失', async () => {
  for (const status of [402, 429]) {
    const stub = stubFetch({
      status,
      body: { detail: 'busy', code: 'UPSTREAM_ERROR' },
      headers: { 'x-proxy-error': 'upstream' },
    })
    try {
      await assert.rejects(
        () => request(`${DEEPSEEK_PROXY}/models`, { method: 'GET' }),
        (error: unknown) => error instanceof ApiError && error.status === status
      )
    } finally {
      stub.restore()
    }
  }
})
