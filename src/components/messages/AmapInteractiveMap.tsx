import { useEffect, useMemo, useRef, useState } from 'react'
import { getAccessKey } from '../../services/chat/accessKey.js'
import { loadAmapSdk, type AMapInstance } from '../../services/agent/amapSdk.js'
import { buildStaticMapUrl, parseLocation } from '../../utils/amapCard.js'
import styles from './ToolSteps.module.scss'

/**
 * 交互式高德地图卡片：SDK 就绪后在容器内创建可拖拽缩放的真实地图（标记 + 路线折线），
 * 静态图片作为加载态垫底并在就绪后移除；未配置 JS API Key（jsconfig 404）、SDK 加载
 * 失败或与 Key 不匹配时保留静态图片兜底。全站共享一次 SDK 加载（见 amapSdk.ts）。
 */

type Point = [number, number]

export type AmapRouteQuery = {
  origin: string
  destination: string
  mode: 'driving' | 'walking'
}

type AmapInteractiveMapProps = {
  /** 原始「lng,lat」串：既用于静态回退图 URL，也解析成交互地图标记 */
  locations: readonly string[]
  /** 与 locations 对齐的标记名（POI 名 / 起点、终点） */
  labels?: readonly (string | undefined)[]
  zoom?: number
  /** 路线查询参数：给出时 SDK 就绪后按需拉取折线绘制路线 */
  route?: AmapRouteQuery | null
  /** 静态图与加载态的跳转链接（高德 URI API） */
  link: string
  linkTitle: string
}

type MapStatus = 'loading' | 'ready' | 'unavailable'

const ROUTE_LINE_COLOR = '#1677ff'

export const AmapInteractiveMap = ({
  locations,
  labels,
  zoom = 13,
  route,
  link,
  linkTitle,
}: AmapInteractiveMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<MapStatus>('loading')
  const markers = useMemo(
    () =>
      locations.flatMap((location, index) => {
        const position = parseLocation(location)
        return position ? [{ position, label: labels?.[index] ?? '' }] : []
      }),
    [locations, labels]
  )
  const staticUrl = useMemo(() => buildStaticMapUrl(locations, zoom), [locations, zoom])

  useEffect(() => {
    let cancelled = false
    let map: AMapInstance | null = null
    void loadAmapSdk().then((AMap) => {
      if (cancelled) {
        return
      }
      if (!AMap || markers.length === 0 || !containerRef.current) {
        setStatus('unavailable')
        return
      }
      try {
        map = new AMap.Map(containerRef.current, {
          zoom,
          center: markers[0].position,
          viewMode: '2D',
        })
        map.add(
          markers.map(({ position, label }) =>
            new AMap.Marker({
              position,
              title: label,
              label: label ? { content: label, direction: 'top' } : undefined,
            })
          )
        )
        map.setFitView()
        setStatus('ready')
        if (route) {
          void fetchRouteLine(route).then((points) => {
            if (!cancelled && map && points.length > 1) {
              map.add(
                new AMap.Polyline({
                  path: points,
                  strokeColor: ROUTE_LINE_COLOR,
                  strokeWeight: 5,
                  showDir: true,
                })
              )
            }
          })
        }
      } catch {
        // SDK 与 Key 类型不匹配（如误用 Web 服务 Key）等情况：销毁半成品，回退静态图
        map?.destroy()
        map = null
        setStatus('unavailable')
      }
    })
    return () => {
      cancelled = true
      map?.destroy()
      map = null
    }
  }, [markers, route, zoom])

  return (
    <div className={styles.amapMapWrap}>
      {status !== 'unavailable' ? (
        <div ref={containerRef} className={styles.amapInteractive} aria-hidden={status !== 'ready'} />
      ) : null}
      {status !== 'ready' ? (
        <a className={styles.amapMapOverlay} href={link} target="_blank" rel="noreferrer" title={linkTitle}>
          <img className={styles.amapMapCover} src={staticUrl} alt={linkTitle} loading="lazy" />
        </a>
      ) : null}
    </div>
  )
}

/** 拉取路线折线（服务端重新规划并返回坐标串）；失败返回空数组，地图只剩标记 */
const fetchRouteLine = async (route: AmapRouteQuery): Promise<Point[]> => {
  const headers = new Headers()
  const accessKey = getAccessKey()
  if (accessKey) {
    headers.set('x-access-key', accessKey)
  }
  const params = new URLSearchParams({ origin: route.origin, destination: route.destination, mode: route.mode })
  const response = await fetch(`/api/amap/routeline?${params.toString()}`, { headers })
  if (!response.ok) {
    return []
  }
  const data = (await response.json()) as { points?: unknown }
  if (!Array.isArray(data.points)) {
    return []
  }
  const points: Point[] = []
  for (const point of data.points) {
    if (Array.isArray(point) && point.length === 2) {
      const lng = Number(point[0])
      const lat = Number(point[1])
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        points.push([lng, lat])
      }
    }
  }
  return points
}
