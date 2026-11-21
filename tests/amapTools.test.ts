import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installMemoryStorage } from './helpers/localStorage.js'

// settings 模块初始化时读写 localStorage，先装内存实现再动态导入
installMemoryStorage()
const { setAmapKey } = await import('../src/services/settings.js')
const { TOOL_REGISTRY, runClientTool } = await import('../src/services/agent/tools.js')
const { runToolSteps } = await import('../src/services/chat/agentLoop.js')
const { cancelAmapKey, resolveAmapKeyGate, useAmapKeyGate } = await import('../src/services/agent/amapKeyGate.js')
import type { ToolStep } from '../src/services/chat/types.js'

const amapTools = TOOL_REGISTRY.filter((tool) => tool.name.startsWith('amap_'))

/** 替换全局 fetch：按断言返回固定响应，并记录请求 URL 供校验 */
const stubFetch = (handler: (url: URL) => { status?: number; body: unknown }) => {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input))
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

const amapStep = (name: string, inputJson: string): ToolStep => ({
  id: `${name}-1`,
  name,
  inputJson,
  status: 'pending',
})

const waitGateOpen = async () => {
  for (let i = 0; i < 40; i += 1) {
    if (useAmapKeyGate.getState().open) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}

test('未配置 Key：回合前置弹出输入门，填写后本轮工具继续执行', async () => {
  setAmapKey('')
  const controller = new AbortController()
  const pending = runToolSteps([amapStep('amap_place_search', JSON.stringify({ keywords: '故宫' }))], controller.signal)
  assert.equal(await waitGateOpen(), true, '输入门应弹出')

  stubFetchAndResolve()
  const steps = await pending
  assert.equal(steps[0].status, 'done')
  assert.match(steps[0].result ?? '', /故宫博物院/)
  assert.equal(useAmapKeyGate.getState().open, false)
})

test('用户取消输入门：地图步骤以引导错误结束，不悬挂回合', async () => {
  setAmapKey('')
  const controller = new AbortController()
  const pending = runToolSteps([amapStep('amap_place_search', JSON.stringify({ keywords: '故宫' }))], controller.signal)
  assert.equal(await waitGateOpen(), true)
  cancelAmapKey()
  const steps = await pending
  assert.equal(steps[0].status, 'error')
  assert.match(steps[0].result ?? '', /高德 Key/)
})

/** 输入门等待期间的 fetch 桩：提交口令后调用并返回 POI 数据 */
function stubFetchAndResolve() {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname === '/v3/place/text') {
      return new Response(
        JSON.stringify({
          status: '1',
          pois: [
            { name: '故宫博物院', address: '景山前街4号', location: '116.397,39.918', pname: '北京市', cityname: '北京市', adname: '东城区' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  setAmapKey('test-key')
  resolveAmapKeyGate('test-key')
  void original
}

test('POI 搜索：参数拼接与结果精简', async () => {
  setAmapKey('test-key')
  const stub = stubFetch(() => ({
    body: {
      status: '1',
      pois: [
        { name: '故宫博物院', address: '景山前街4号', location: '116.397,39.918', pname: '北京市', cityname: '北京市', adname: '东城区' },
        { name: '无关项', address: '', location: '0,0' },
      ],
    },
  }))
  try {
    const result = await runClientTool('amap_place_search', { keywords: '故宫', city: '北京' })
    assert.equal(result.isError, false)
    const data = JSON.parse(result.content)
    assert.equal(data.count, 2)
    assert.equal(data.pois[0].name, '故宫博物院')
    assert.equal(data.pois[0].district, '北京市北京市东城区')
    const url = new URL(stub.calls[0])
    assert.equal(url.pathname, '/v3/place/text')
    assert.equal(url.searchParams.get('key'), 'test-key')
    assert.equal(url.searchParams.get('keywords'), '故宫')
    assert.equal(url.searchParams.get('city'), '北京')
    assert.equal(url.searchParams.get('offset'), '5')
  } finally {
    stub.restore()
  }
})

test('高德业务错误（status=0）转成可读错误并提示检查 Key', async () => {
  setAmapKey('bad-key')
  const stub = stubFetch(() => ({ body: { status: '0', info: 'INVALID_USER_KEY', infocode: '10001' } }))
  try {
    const result = await runClientTool('amap_geocode', { address: '北京市' })
    assert.equal(result.isError, true)
    assert.match(result.content, /INVALID_USER_KEY/)
    assert.match(result.content, /Web 服务/)
  } finally {
    stub.restore()
  }
})

test('天气工具两步走：先地理编码拿 adcode 再查实况', async () => {
  setAmapKey('test-key')
  const stub = stubFetch((url) => {
    if (url.pathname === '/v3/geocode/geo') {
      return { body: { status: '1', geocodes: [{ formatted_address: '浙江省杭州市', location: '120,30', adcode: '330100' }] } }
    }
    return { body: { status: '1', lives: [{ weather: '晴', temperature: '28', winddirection: '东南', windpower: '≤3' }] } }
  })
  try {
    const result = await runClientTool('amap_weather', { city: '杭州' })
    assert.equal(result.isError, false)
    const data = JSON.parse(result.content)
    assert.equal(data.weather, '晴')
    assert.equal(data.temperature, '28')
    assert.equal(stub.calls.filter((url) => url.includes('/v3/geocode/geo')).length, 1)
    assert.equal(stub.calls.filter((url) => url.includes('/v3/weather/weatherInfo')).length, 1)
    const weatherCall = stub.calls.find((url) => url.includes('/v3/weather/weatherInfo'))
    assert.ok(weatherCall)
    assert.equal(new URL(weatherCall).searchParams.get('city'), '330100')
  } finally {
    stub.restore()
  }
})

test('路线规划：地址先转坐标，再返回距离耗时摘要', async () => {
  setAmapKey('test-key')
  const stub = stubFetch((url) => {
    if (url.pathname === '/v3/geocode/geo') {
      return { body: { status: '1', geocodes: [{ formatted_address: '起点', location: '116.1,39.9', adcode: '110000' }] } }
    }
    return {
      body: {
        status: '1',
        route: { paths: [{ distance: '35200', duration: '2700', steps: [{ instruction: '沿高速行驶 30 公里' }] }] },
      },
    }
  })
  try {
    const result = await runClientTool('amap_route_planning', {
      origin_address: '北京西站',
      destination_address: '首都机场 T3',
    })
    assert.equal(result.isError, false)
    const data = JSON.parse(result.content)
    assert.equal(data.distance_meters, 35200)
    assert.equal(data.duration_seconds, 2700)
    assert.deepEqual(data.steps, ['沿高速行驶 30 公里'])
    // 三次请求：两次地理编码 + 一次路线
    assert.equal(stub.calls.filter((url) => url.includes('/v3/geocode/geo')).length, 2)
    assert.equal(stub.calls.filter((url) => url.includes('/v3/direction/driving')).length, 1)
  } finally {
    stub.restore()
  }
})
