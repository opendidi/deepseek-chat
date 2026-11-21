/**
 * 高德地图卡片的纯计算：静态地图 URL、高德跳转链接、距离耗时格式化。
 * 不依赖 DOM 与网络，便于单测；URL 走服务端代理端点，Key 不出现在前端。
 */

export type AmapCardPoi = {
  name?: string
  address?: string
  location: string
  district?: string
}

export type AmapRouteData = {
  mode?: string
  origin?: string
  destination?: string
  origin_point?: string
  destination_point?: string
  distance_meters?: number
  duration_seconds?: number
  steps?: string[]
}

/** 把多个坐标拼成静态地图 markers 参数（高德格式：尺寸,颜色,标签:坐标1;坐标2） */
const markersParam = (locations: readonly string[]): string =>
  locations.filter(Boolean).map((location, index) => `mid,0xFF0000,${String.fromCharCode(65 + (index % 26))}:${location}`).join('|')

/** 静态地图代理 URL：<img> 直接显示，坐标取自工具返回的 JSON */
export const buildStaticMapUrl = (locations: readonly string[], zoom = 13, size = '540*320'): string => {
  const markers = markersParam(locations)
  const params = new URLSearchParams({ markers, zoom: String(zoom), size })
  return `/api/amap/staticmap?${params.toString()}`
}

/** 地点跳转链接：高德 URI API，免 Key，打开高德网页地图并标记位置 */
export const buildMarkerLink = (location: string, name?: string): string => {
  const params = new URLSearchParams({ position: location })
  if (name) {
    params.set('name', name)
  }
  params.set('src', 'deepseek-chat')
  return `https://uri.amap.com/marker?${params.toString()}`
}

/** 路线跳转链接：打开高德网页地图并规划路线 */
export const buildRouteLink = (
  origin: string,
  destination: string,
  mode: 'driving' | 'walking'
): string => {
  const params = new URLSearchParams({
    from: origin,
    to: destination,
    mode: mode === 'walking' ? 'walk' : 'car',
    src: 'deepseek-chat',
  })
  return `https://uri.amap.com/navigation?${params.toString()}`
}

export const formatDistance = (meters: number): string =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} 米`

export const formatDuration = (seconds: number): string => {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) {
    return `${minutes} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分钟`
}

/** 高德坐标串「lng,lat」解析为 SDK 坐标数组；格式不合法返回 null（交由调用方跳过该点） */
export const parseLocation = (location: string): [number, number] | null => {
  const comma = location.indexOf(',')
  if (comma <= 0) {
    return null
  }
  const lngText = location.slice(0, comma)
  const latText = location.slice(comma + 1)
  // Number('') 与 Number(' ') 都是 0，会把残缺坐标解析到赤道上，先排除
  if (!lngText.trim() || !latText.trim()) {
    return null
  }
  const lng = Number(lngText)
  const lat = Number(latText)
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
}

/** 交互地图卡片视图模型：从工具结果 JSON 提取渲染所需的全部字段（纯函数，便于单测） */
export type AmapCardView = {
  pois: AmapCardPoi[]
  /** 静态回退图与交互地图共用的坐标串（路线时为起点、终点两个） */
  locations: string[]
  /** 与 locations 对齐的标记名 */
  labels: (string | undefined)[]
  /** 路线工具且起终点齐备时的折线查询参数（交互地图按需拉取） */
  route: { origin: string; destination: string; mode: 'driving' | 'walking' } | null
  mapLink: string | null
  routeMeta: { distanceMeters: number; durationSeconds: number } | null
  weatherText: string | null
}

export const buildAmapCardView = (
  toolName: string,
  data: Record<string, unknown> | null
): AmapCardView | null => {
  if (!data) {
    return null
  }
  const isRoute = toolName === 'amap_route_planning'
  const routeData = isRoute ? (data as unknown as AmapRouteData) : null
  const pois = (
    Array.isArray(data.pois)
      ? (data.pois as AmapCardPoi[])
      : Array.isArray(data.geocodes)
        ? (data.geocodes as Record<string, unknown>[]).map((geo) => ({
            name: String(geo.formatted_address ?? ''),
            address: '',
            location: String(geo.location ?? ''),
            district: '',
          }))
        : []
  ).filter((poi) => poi.location)
  const locations = isRoute
    ? [routeData?.origin_point, routeData?.destination_point].filter((point): point is string => Boolean(point))
    : pois.map((poi) => poi.location)
  const labels = isRoute
    ? [routeData?.origin, routeData?.destination]
    : pois.map((poi) => poi.name)
  const route =
    isRoute && routeData?.origin_point && routeData?.destination_point && routeData?.origin && routeData?.destination
      ? {
          origin: routeData.origin,
          destination: routeData.destination,
          mode: routeData.mode === 'walking' ? ('walking' as const) : ('driving' as const),
        }
      : null
  const mapLink =
    route && routeData?.origin_point && routeData?.destination_point
      ? buildRouteLink(routeData.origin_point, routeData.destination_point, route.mode)
      : pois.length > 0
        ? buildMarkerLink(pois[0].location, pois[0].name)
        : null
  return {
    pois,
    locations,
    labels,
    route,
    mapLink,
    routeMeta: isRoute
      ? { distanceMeters: routeData?.distance_meters ?? 0, durationSeconds: routeData?.duration_seconds ?? 0 }
      : null,
    weatherText:
      toolName === 'amap_weather' && typeof data.weather === 'string'
        ? `${data.weather} ${String(data.temperature ?? '')}°C · ${String(data.winddirection ?? '')}`
        : null,
  }
}
