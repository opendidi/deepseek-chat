import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ToolStep } from '../../services/chat/types.js'
import {
  buildMarkerLink,
  buildRouteLink,
  buildStaticMapUrl,
  formatDistance,
  formatDuration,
  type AmapCardPoi,
  type AmapRouteData,
} from '../../utils/amapCard.js'
import styles from './ToolSteps.module.scss'

/** 客户端工具调用步骤：默认给出状态、耗时与结果摘要，展开后显示完整入参与结果 */
export const ToolSteps = ({ steps }: { steps?: ToolStep[] }) => {  const t = useTranslate()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  if (!steps?.length) {
    return null
  }
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>{t('agentToolSteps')}</div>
      {steps.map((step) => {
        const open = expanded.has(step.id)
        const duration =
          step.startedAt !== undefined && step.endedAt !== undefined
            ? Math.max(0, step.endedAt - step.startedAt)
            : null
        const hasDetail = Boolean(step.inputJson || step.result)
        const isAmap = step.name.startsWith('amap_')
        return (
          <div key={step.id} className={styles.step}>
            <span className={styles.name}>{step.name}</span>
            <span className={clsx(styles.state, step.status === 'error' && styles.failed)}>
              {t(
                step.status === 'done'
                  ? 'agentToolDone'
                  : step.status === 'error'
                    ? 'agentToolFailed'
                    : 'agentToolRunning'
              )}
            </span>
            {duration !== null ? (
              <span className={styles.duration}>{t('agentToolDuration', { ms: duration })}</span>
            ) : null}
            {hasDetail ? (
              <button type="button" className={styles.detailToggle} onClick={() => toggle(step.id)}>
                {t(open ? 'agentToolHideDetail' : 'agentToolShowDetail')}
              </button>
            ) : null}
            {open ? (
              <div className={styles.detail}>
                <div className={styles.detailLine}>
                  <span className={styles.detailLabel}>{t('agentToolInput')}</span>
                  <code className={styles.code}>{step.inputJson || '{}'}</code>
                </div>
                {step.result ? <pre className={styles.resultFull}>{step.result}</pre> : null}
              </div>
            ) : step.result && !isAmap ? (
              <span className={styles.result} title={step.result}>
                {step.result.slice(0, 160)}
              </span>
            ) : null}
            {isAmap && step.status === 'done' && step.result ? (
              <AmapResultCard name={step.name} result={step.result} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** amap 工具结果的解析视图：静态地图卡片 + POI 列表 / 路线摘要 / 天气；解析失败时整体隐藏 */
const AmapResultCard = ({ name, result }: { name: string; result: string }) => {
  const t = useTranslate()
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(result) as Record<string, unknown>
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') {
    return null
  }

  const isRoute = name === 'amap_route_planning'
  const route = isRoute ? (data as unknown as AmapRouteData) : null
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
    ? [route?.origin_point, route?.destination_point].filter((point): point is string => Boolean(point))
    : pois.map((poi) => poi.location)
  const mapLink =
    isRoute && route?.origin_point && route?.destination_point
      ? buildRouteLink(
          route.origin_point,
          route.destination_point,
          route.mode === 'walking' ? 'walking' : 'driving'
        )
      : pois.length > 0
        ? buildMarkerLink(pois[0].location, pois[0].name)
        : null

  return (
    <div className={styles.amapCard}>
      {locations.length > 0 ? (
        <a
          className={styles.amapMapLink}
          href={mapLink ?? '#'}
          target="_blank"
          rel="noreferrer"
          title={t('amapCardOpenInAmap')}
        >
          <img
            className={styles.amapMapImage}
            src={buildStaticMapUrl(locations, isRoute ? 11 : 13)}
            alt={t('amapCardOpenInAmap')}
            loading="lazy"
          />
        </a>
      ) : null}
      {pois.length > 0 ? (
        <ul className={styles.amapPoiList}>
          {pois.map((poi) => (
            <li key={`${poi.name}-${poi.location}`}>
              <a href={buildMarkerLink(poi.location, poi.name)} target="_blank" rel="noreferrer">
                {poi.name}
              </a>
              <span className={styles.amapPoiAddress}>{poi.address || poi.district}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {isRoute && route ? (
        <div className={styles.amapRouteMeta}>
          <span>
            {t('amapCardDistance')}：{formatDistance(route.distance_meters ?? 0)}
          </span>
          <span>
            {t('amapCardDuration')}：{formatDuration(route.duration_seconds ?? 0)}
          </span>
        </div>
      ) : null}
      {name === 'amap_weather' && typeof data.weather === 'string' ? (
        <div className={styles.amapWeather}>
          {data.weather} {String(data.temperature ?? '')}°C · {String(data.winddirection ?? '')}
        </div>
      ) : null}
    </div>
  )
}
