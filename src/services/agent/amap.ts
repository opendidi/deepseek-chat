import { translate } from '../../i18n/index.js'
import { useSettings } from '../settings.js'
import { requestAmapKey, useAmapKeyGate } from './amapKeyGate.js'
import type { ClientTool } from './tools.js'

/**
 * 高德地图（Web 服务 API）工具集：POI 搜索、地址转坐标、实时天气、路线规划。
 * 需要用户在高德开放平台申请「Web 服务」类型 Key 并填入设置；未配置时工具返回
 * 可回传的引导错误，模型会把提示转达给用户。
 *
 * 网络请求直接透传外层的 abort 信号；超时由注册表的 timeoutMs + withTimeout 统一兜底，
 * 结果精简为模型友好的紧凑 JSON，由注册表的 maxResult 统一截断。
 */

const AMAP_BASE = 'https://restapi.amap.com'
const AMAP_TIMEOUT_MS = 10_000

type AmapParams = Record<string, string | number | undefined>

const requireKey = async (signal?: AbortSignal): Promise<string> => {
  const existing = useSettings.getState().amapKey?.trim()
  if (existing) {
    return existing
  }
  // 用户刚取消过输入门：本轮直接回引导错误，不重复弹门
  if (useAmapKeyGate.getState().cancelled) {
    throw new Error(translate('agentToolAmapNoKey'))
  }
  // 未配置：弹出输入门等用户填写；取消时回传引导错误，不悬挂回合
  const key = await requestAmapKey(signal)
  if (!key) {
    throw new Error(translate('agentToolAmapNoKey'))
  }
  return key
}

/** 单次高德 REST 调用：拼参、校验 status，失败时抛出带 infocode 提示的可读错误 */
const amapGet = async (
  path: string,
  params: AmapParams,
  signal?: AbortSignal
): Promise<Record<string, unknown>> => {
  const key = await requireKey(signal)
  const search = new URLSearchParams()
  search.set('key', key)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(name, String(value))
    }
  }
  const response = await fetch(`${AMAP_BASE}${path}?${search.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(translate('agentToolAmapHttpError', { status: String(response.status) }))
  }
  const data = (await response.json()) as Record<string, unknown>
  if (data.status !== '1') {
    const info = String(data.info ?? 'unknown')
    // 10001/10003 等：Key 无效或配额问题，提示用户检查 Key
    const hint = String(data.infocode ?? '').startsWith('100')
      ? '（请检查设置中的高德 Key 是否为「Web 服务」类型且有效）'
      : ''
    throw new Error(`高德接口错误：${info}${hint}`)
  }
  return data
}

const compactPoi = (poi: Record<string, unknown>) => ({
  name: poi.name,
  address: typeof poi.address === 'string' ? poi.address : '',
  location: poi.location,
  district: [poi.pname, poi.cityname, poi.adname].filter(Boolean).join(''),
})

const compactGeocode = (geo: Record<string, unknown>) => ({
  formatted_address: geo.formatted_address,
  location: geo.location,
  adcode: geo.adcode,
  level: geo.level,
})

/** 地址/城市名转 adcode（天气等接口需要），失败抛可读错误 */
const adcodeOf = async (city: string, signal?: AbortSignal): Promise<string> => {
  const data = await amapGet('/v3/geocode/geo', { address: city, city }, signal)
  const geocodes = data.geocodes as Record<string, unknown>[] | undefined
  const adcode = geocodes?.[0]?.adcode
  if (!adcode) {
    throw new Error(`找不到城市：${city}`)
  }
  return String(adcode)
}

const requireString = (input: Record<string, unknown>, name: string): string => {
  const value = input[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(translate('agentToolErrorMissingParam', { name }))
  }
  return value.trim()
}

const createAmapTools = (): ClientTool[] => [
  {
    name: 'amap_place_search',
    category: 'map',
    description: '高德地图 POI 搜索：按关键词查找地点（餐饮、加油站、景点等），返回名称、地址与坐标。',
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'string', description: '搜索关键词，例如「海底捞」「故宫」' },
        city: { type: 'string', description: '可选。城市名或城市区划代码，如「杭州」' },
      },
      required: ['keywords'],
    },
    timeoutMs: AMAP_TIMEOUT_MS,
    maxResult: 2400,
    run: async (input, signal) => {
      const keywords = requireString(input, 'keywords')
      const data = await amapGet(
        '/v3/place/text',
        {
          keywords,
          city: typeof input.city === 'string' ? input.city : undefined,
          offset: 5,
          page: 1,
        },
        signal
      )
      const pois = (data.pois as Record<string, unknown>[] | undefined) ?? []
      return JSON.stringify({ count: pois.length, pois: pois.map(compactPoi) })
    },
  },
  {
    name: 'amap_geocode',
    category: 'map',
    description: '高德地理编码：把结构化地址转换为经纬度坐标与区划代码。',
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: '结构化地址，例如「杭州市西湖区文一西路 969 号」' },
        city: { type: 'string', description: '可选。限定查询城市' },
      },
      required: ['address'],
    },
    timeoutMs: AMAP_TIMEOUT_MS,
    maxResult: 1200,
    run: async (input, signal) => {
      const address = requireString(input, 'address')
      const data = await amapGet(
        '/v3/geocode/geo',
        { address, city: typeof input.city === 'string' ? input.city : undefined },
        signal
      )
      const geocodes = (data.geocodes as Record<string, unknown>[] | undefined) ?? []
      if (geocodes.length === 0) {
        return JSON.stringify({ found: false })
      }
      return JSON.stringify({
        count: geocodes.length,
        geocodes: geocodes.slice(0, 3).map(compactGeocode),
      })
    },
  },
  {
    name: 'amap_weather',
    category: 'map',
    description: '高德实时天气：查询指定城市的当前天气（温度、风向、风力）。城市用中文名。',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市中文名，例如「杭州」' },
      },
      required: ['city'],
    },
    timeoutMs: 15_000,
    maxResult: 1200,
    run: async (input, signal) => {
      const city = requireString(input, 'city')
      // 天气接口需要 adcode：先地理编码拿到，再查实况
      const adcode = await adcodeOf(city, signal)
      const data = await amapGet('/v3/weather/weatherInfo', { city: adcode, extensions: 'base' }, signal)
      const lives = (data.lives as Record<string, unknown>[] | undefined) ?? []
      if (lives.length === 0) {
        return JSON.stringify({ found: false })
      }
      return JSON.stringify({ city, ...lives[0] })
    },
  },
  {
    name: 'amap_route_planning',
    category: 'map',
    description: '高德路线规划：查询两地之间的驾车或步行路线，返回距离与耗时摘要。地址用中文名。',
    input_schema: {
      type: 'object',
      properties: {
        origin_address: { type: 'string', description: '出发地地址，例如「北京西站」' },
        destination_address: { type: 'string', description: '目的地地址，例如「首都机场 T3」' },
        mode: { type: 'string', description: '可选。driving（驾车，默认）或 walking（步行）' },
      },
      required: ['origin_address', 'destination_address'],
    },
    timeoutMs: 20_000,
    maxResult: 2000,
    run: async (input, signal) => {
      const originAddress = requireString(input, 'origin_address')
      const destinationAddress = requireString(input, 'destination_address')
      const mode = input.mode === 'walking' ? 'walking' : 'driving'
      // 起终点地址先转坐标，再规划路线
      const origin = await amapGet('/v3/geocode/geo', { address: originAddress }, signal)
      const destination = await amapGet('/v3/geocode/geo', { address: destinationAddress }, signal)
      const originPoint = (origin.geocodes as Record<string, unknown>[] | undefined)?.[0]?.location as string | undefined
      const destinationPoint = (destination.geocodes as Record<string, unknown>[] | undefined)?.[0]?.location as string | undefined
      if (!originPoint || !destinationPoint) {
        return JSON.stringify({ found: false, reason: '起点或目的地无法解析为坐标' })
      }
      const path = mode === 'walking' ? '/v3/direction/walking' : '/v3/direction/driving'
      const data = await amapGet(path, { origin: originPoint, destination: destinationPoint }, signal)
      const route = data.route as { paths?: Record<string, unknown>[] } | undefined
      const paths = route?.paths ?? []
      if (paths.length === 0) {
        return JSON.stringify({ found: false, reason: '未找到可行路线' })
      }
      const best = paths[0]
      const steps = (best.steps as { instruction?: string }[] | undefined) ?? []
      return JSON.stringify({
        mode,
        origin: originAddress,
        destination: destinationAddress,
        distance_meters: Number(best.distance ?? 0),
        duration_seconds: Number(best.duration ?? 0),
        steps: steps.slice(0, 6).map((step) => step.instruction ?? ''),
      })
    },
  },
]

export { createAmapTools, requireKey as requireAmapKey }
