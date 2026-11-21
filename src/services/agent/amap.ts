import { translate } from '../../i18n/index.js'
import type { ClientTool } from './tools.js'

/**
 * 高德地图工具集：经服务端代理（/api/amap/*）调用高德 Web 服务 API。
 * Key 保存在服务器环境（AMAP_KEY，可由根目录 .env 提供），浏览器不接触；
 * 服务器未配置时返回 400 + AMAP_KEY_MISSING，工具抛出部署引导错误。
 *
 * 网络请求直接透传外层的 abort 信号；超时由注册表的 timeoutMs + withTimeout 统一兜底，
 * 结果精简由服务端完成，客户端只做参数透传。
 */

const AMAP_PROXY_BASE = '/api/amap/'

const requireString = (input: Record<string, unknown>, name: string): string => {
  const value = input[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(translate('agentToolErrorMissingParam', { name }))
  }
  return value.trim()
}

/** 调用服务端高德代理：非 2xx 时把 detail 转成可回传错误（缺失 Key 有专门的部署引导文案） */
const amapProxy = async (
  path: string,
  params: Record<string, string | undefined>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> => {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(name, value)
    }
  }
  const response = await fetch(`${AMAP_PROXY_BASE}${path}?${search.toString()}`, { signal })
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const detail = String(data.detail ?? `HTTP ${response.status}`)
    throw new Error(detail === 'AMAP_KEY_MISSING' ? translate('agentToolAmapNoKey') : detail)
  }
  return data
}

const optional = (input: Record<string, unknown>, name: string): string | undefined =>
  typeof input[name] === 'string' && input[name] ? (input[name] as string) : undefined

const createAmapTools = (): ClientTool[] => [
  {
    name: 'amap_place_search',
    category: 'map',
    description: '高德地图 POI 搜索：按关键词查找地点（餐饮、加油站、景点等），返回名称、地址与坐标。回答「某地在哪」「找附近的 X」等位置类问题时应优先调用本工具；查询结果会自动以静态地图卡片展示给用户，无需描述如何查看地图。',
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'string', description: '搜索关键词，例如「海底捞」「故宫」' },
        city: { type: 'string', description: '可选。城市名或城市区划代码，如「杭州」' },
      },
      required: ['keywords'],
    },
    timeoutMs: 10_000,
    maxResult: 2400,
    run: async (input, signal) => {
      const keywords = requireString(input, 'keywords')
      const data = await amapProxy('place', { keywords, city: optional(input, 'city') }, signal)
      return JSON.stringify(data)
    },
  },
  {
    name: 'amap_geocode',
    category: 'map',
    description: '高德地理编码：把结构化地址转换为经纬度坐标与区划代码。用户询问某地的准确坐标，或需要坐标做后续查询时使用；结果会自动以地图卡片展示。',
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: '结构化地址，例如「杭州市西湖区文一西路 969 号」' },
        city: { type: 'string', description: '可选。限定查询城市' },
      },
      required: ['address'],
    },
    timeoutMs: 10_000,
    maxResult: 1200,
    run: async (input, signal) => {
      const address = requireString(input, 'address')
      const data = await amapProxy('geocode', { address, city: optional(input, 'city') }, signal)
      return JSON.stringify(data)
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
    timeoutMs: 10_000,
    maxResult: 1200,
    run: async (input, signal) => {
      const city = requireString(input, 'city')
      const data = await amapProxy('weather', { city }, signal)
      return JSON.stringify(data)
    },
  },
  {
    name: 'amap_route_planning',
    category: 'map',
    description: '高德路线规划：查询两地之间的驾车或步行路线，返回距离与耗时摘要。地址用中文名；路线与起终点会自动以地图卡片展示。',
    input_schema: {
      type: 'object',
      properties: {
        origin_address: { type: 'string', description: '出发地地址，例如「北京西站」' },
        destination_address: { type: 'string', description: '目的地地址，例如「首都机场 T3」' },
        mode: { type: 'string', description: '可选。driving（驾车，默认）或 walking（步行）' },
      },
      required: ['origin_address', 'destination_address'],
    },
    timeoutMs: 10_000,
    maxResult: 2000,
    run: async (input, signal) => {
      const data = await amapProxy(
        'route',
        {
          origin: requireString(input, 'origin_address'),
          destination: requireString(input, 'destination_address'),
          mode: input.mode === 'walking' ? 'walking' : 'driving',
        },
        signal
      )
      return JSON.stringify(data)
    },
  },
]

export { createAmapTools }
