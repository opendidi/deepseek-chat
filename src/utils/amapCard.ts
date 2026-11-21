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

/** 把多个坐标拼成静态地图 markers 参数（同一组样式，坐标间用 ; 分隔） */
const markersParam = (locations: readonly string[]): string =>
  locations.filter(Boolean).map((location) => `mid,0xFF0000:${location}`).join('|')

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
