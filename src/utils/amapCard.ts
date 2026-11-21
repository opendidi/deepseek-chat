/**
 * 高德地图卡片的纯计算：高德跳转链接、距离耗时格式化、工具结果视图模型。
 * 不依赖 DOM 与网络，便于单测；卡片不嵌图，只展示可在高德地图打开的链接。
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

/** 交互地图卡片视图模型：从工具结果 JSON 提取渲染所需的全部字段（纯函数，便于单测） */
export type AmapCardView = {
  pois: AmapCardPoi[]
  /** 高德跳转链接：POI 取首个地点；路线为起终点导航链接 */
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
  const mapLink =
    isRoute && routeData?.origin_point && routeData?.destination_point
      ? buildRouteLink(
          routeData.origin_point,
          routeData.destination_point,
          routeData.mode === 'walking' ? 'walking' : 'driving'
        )
      : pois.length > 0
        ? buildMarkerLink(pois[0].location, pois[0].name)
        : null
  return {
    pois,
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
