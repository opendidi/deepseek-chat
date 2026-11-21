import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ToolStep } from '../../services/chat/types.js'
import { buildAmapCardView, buildMarkerLink, formatDistance, formatDuration } from '../../utils/amapCard.js'
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

/** amap 工具结果的解析视图：地址跳转链接 + 路线摘要 / 天气；解析失败时整体隐藏 */
const AmapResultCard = ({ name, result }: { name: string; result: string }) => {
  const t = useTranslate()
  const view = useMemo(() => {
    let data: Record<string, unknown> | null = null
    try {
      data = JSON.parse(result) as Record<string, unknown>
    } catch {
      return null
    }
    return data && typeof data === 'object' ? buildAmapCardView(name, data) : null
  }, [name, result])
  if (!view) {
    return null
  }
  return (
    <div className={styles.amapCard}>
      {view.pois.length > 0 ? (
        <ul className={styles.amapPoiList}>
          {view.pois.map((poi) => (
            <li key={`${poi.name}-${poi.location}`}>
              <a href={buildMarkerLink(poi.location, poi.name)} target="_blank" rel="noreferrer">
                {poi.name}
              </a>
              <span className={styles.amapPoiAddress}>{poi.address || poi.district}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {view.routeMeta ? (
        <div className={styles.amapRouteMeta}>
          <span>
            {t('amapCardDistance')}：{formatDistance(view.routeMeta.distanceMeters)}
          </span>
          <span>
            {t('amapCardDuration')}：{formatDuration(view.routeMeta.durationSeconds)}
          </span>
        </div>
      ) : null}
      {view.mapLink && view.pois.length === 0 ? (
        <div className={styles.amapRouteLink}>
          <a href={view.mapLink} target="_blank" rel="noreferrer">
            {t('amapCardOpenInAmap')}
          </a>
        </div>
      ) : null}
      {view.weatherText ? <div className={styles.amapWeather}>{view.weatherText}</div> : null}
    </div>
  )
}
