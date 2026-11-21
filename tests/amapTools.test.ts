import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TOOL_REGISTRY, runClientTool } from '../src/services/agent/tools.js'

const amapTools = TOOL_REGISTRY.filter((tool) => tool.name.startsWith('amap_'))

/** 替换全局 fetch：记录请求并按路径返回服务端代理形态的响应 */
const stubProxy = (handler: (url: URL) => { status?: number; body: unknown }) => {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input), 'http://testserver/')
    calls.push(url.toString())
    const outcome = handler(url)
    return new Response(JSON.stringify(outcome.body ?? {}), {
      status: outcome.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

test('高德工具已注册且默认不启用名单不含它们', () => {
  assert.equal(amapTools.length, 4)
  for (const tool of amapTools) {
    assert.equal(tool.category, 'map')
    assert.ok(tool.timeoutMs, '网络工具应有超时')
    assert.ok(tool.maxResult, '结果应有长度预算')
  }
})

test('工具经服务端代理调用：参数透传、结果透传', async () => {
  const stub = stubProxy(() => ({
    body: {
      count: 1,
      pois: [{ name: '故宫博物院', address: '景山前街4号', location: '116.397,39.918', district: '北京市东城区' }],
    },
  }))
  try {
    const result = await runClientTool('amap_place_search', { keywords: '故宫', city: '北京' })
    assert.equal(result.isError, false)
    const data = JSON.parse(result.content)
    assert.equal(data.pois[0].name, '故宫博物院')
    // 只打同源代理端点，不直连高德
    assert.ok(stub.calls.every((url) => url.includes('/api/amap/')))
    const url = new URL(stub.calls[0])
    assert.equal(url.pathname, '/api/amap/place')
    assert.equal(url.searchParams.get('keywords'), '故宫')
    assert.equal(url.searchParams.get('city'), '北京')
  } finally {
    stub.restore()
  }
})

test('服务器未配置 AMAP_KEY 时返回部署引导错误', async () => {
  const stub = stubProxy(() => ({ status: 400, body: { detail: 'AMAP_KEY_MISSING' } }))
  try {
    const result = await runClientTool('amap_weather', { city: '杭州' })
    assert.equal(result.isError, true)
    assert.match(result.content, /AMAP_KEY/)
    assert.match(result.content, /\.env/)
  } finally {
    stub.restore()
  }
})

test('服务器业务错误原样透传（如坐标解析失败）', async () => {
  const stub = stubProxy(() => ({
    status: 400,
    body: { detail: '起点或目的地无法解析为坐标' },
  }))
  try {
    const result = await runClientTool('amap_route_planning', {
      origin_address: '不存在的地方A',
      destination_address: '不存在的地方B',
    })
    assert.equal(result.isError, true)
    assert.match(result.content, /无法解析为坐标/)
  } finally {
    stub.restore()
  }
})

test('缺参数在客户端即拦截（不发起网络请求）', async () => {
  const stub = stubProxy(() => ({ body: {} }))
  try {
    const result = await runClientTool('amap_place_search', {})
    assert.equal(result.isError, true)
    assert.equal(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})
