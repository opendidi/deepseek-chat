import clsx from 'clsx'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslate } from '../../../i18n/index.js'
import type { DetailedUsage } from '../../../services/chat/detailedUsage.js'
import {
  axisLabel,
  calendarCells,
  chartIndexAt,
  chartLabelIndices,
  dayOfMonth,
  formatMoney,
  formatNumber,
  heatLevel,
  hourLabelIndices,
  hourPeak,
  metricText,
  metricValue,
  percent,
  shortDate,
  type UsageMetric,
} from '../../../utils/usageChart.js'
import styles from '../UsagePanel.module.scss'

type Metric = UsageMetric
type ChartTip = { x: number; y: number; index: number; side: 'left' | 'right' }
type HourTip = { x: number; y: number; hour: number; side: 'left' | 'right' }

const METRICS: { value: Metric; label: 'usageTrendToken' | 'usageTrendCost' | 'usageTrendReplies' }[] = [
  { value: 'tokens', label: 'usageTrendToken' },
  { value: 'cost', label: 'usageTrendCost' },
  { value: 'replies', label: 'usageTrendReplies' },
]

/** 热力图按活动强度分四级，避免连续透明度让空白格子也显得像有数据 */
const HEAT_LEVELS = [styles.level0, styles.level1, styles.level2, styles.level3]

/** 悬浮定位的公共裁剪：跟随光标、贴近边缘时翻面 */
const tipPosition = (
  event: MouseEvent<HTMLElement>,
  card: DOMRect,
  padX: number,
  padY: number,
  flipWidth: number
): { x: number; y: number; side: 'left' | 'right' } => {
  const x = Math.max(padX, Math.min(card.width - padX, event.clientX - card.left))
  const y = Math.max(padY, Math.min(card.height - padY, event.clientY - card.top))
  return { x, y, side: x > card.width - flipWidth ? 'left' : 'right' }
}

/** 每日趋势双柱（token 模式右柱为费用）+ 固定 8 周热力图 */
export const UsageDailyChart = ({ data }: { data: DetailedUsage }) => {
  const t = useTranslate()
  const { daily, heatmap } = data
  const [metric, setMetric] = useState<Metric>('tokens')
  const [tip, setTip] = useState<ChartTip | null>(null)
  const [heatIndex, setHeatIndex] = useState<number | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const maxDaily = useMemo(
    () => Math.max(1, ...daily.map((day) => metricValue(day, metric))),
    [daily, metric]
  )
  const maxCost = useMemo(() => Math.max(1, ...daily.map((day) => day.cost)), [daily])
  const peakValue = useMemo(
    () => Math.max(0, ...daily.map((day) => metricValue(day, metric))),
    [daily, metric]
  )
  const peakDay = daily.find((day) => metricValue(day, metric) === peakValue)
  const labelIndices = useMemo(() => chartLabelIndices(daily.length), [daily.length])
  const heatMax = useMemo(
    () => Math.max(1, ...heatmap.map((day) => metricValue(day, metric))),
    [heatmap, metric]
  )
  const heatActive = heatmap.filter((day) => metricValue(day, metric) > 0).length
  const calendarDays = useMemo(
    () => calendarCells(heatmap.map((day, index) => ({ ...day, index }))),
    [heatmap]
  )
  const weekNames = t('usageWeekdays').trim().split(/\s+/)
  const tipDay = tip ? daily[tip.index] : undefined

  const showTip = (event: MouseEvent<HTMLElement>, index: number) => {
    const card = cardRef.current?.getBoundingClientRect()
    if (!card) {
      return
    }
    setTip((prev) => {
      const { x, y, side } = tipPosition(event, card, 76, 52, 170)
      return prev &&
        prev.index === index &&
        prev.side === side &&
        Math.abs(prev.x - x) < 4 &&
        Math.abs(prev.y - y) < 4
        ? prev
        : { x, y, index, side }
    })
  }

  /** 光标落在绘图区任意位置都按列换算成对应的日期，列间空隙也能显示数据 */
  const onPlotMove = (event: MouseEvent<HTMLDivElement>) => {
    if (daily.length === 0) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
    showTip(event, chartIndexAt(ratio, daily.length))
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h4 className={styles.sectionTitle}>{t('usageTrendTitle')}</h4>
        <div className={styles.segments}>
          {METRICS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={clsx(styles.segment, metric === item.value && styles.segmentActive)}
              onClick={() => setMetric(item.value)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>
      <div ref={cardRef} className={styles.chartCard}>
        <div className={styles.chartMeta}>
          <span className={styles.chartMetaText}>
            {peakValue > 0 && peakDay
              ? t('usageChartPeak', {
                  value: metricText(peakValue, metric),
                  date: shortDate(peakDay.date),
                })
              : t('usageChartNoData')}
          </span>
          {metric === 'tokens' ? (
            <span className={styles.chartMetaDate}>{t('usageTrendSecondary')}</span>
          ) : daily.length > 1 ? (
            <span className={styles.chartMetaDate}>
              {shortDate(daily[0]?.date ?? '')} – {shortDate(daily[daily.length - 1]?.date ?? '')}
            </span>
          ) : null}
        </div>

        <div className={styles.plot} onMouseLeave={() => setTip(null)}>
          <div className={styles.yAxis}>
            <span>{axisLabel(maxDaily, metric)}</span>
            <span>{axisLabel(maxDaily / 2, metric)}</span>
            <span>{axisLabel(0, metric)}</span>
          </div>
          <div className={styles.plotMain} onMouseMove={onPlotMove}>
            <div className={styles.grid}>
              <span className={styles.gridLine} />
              <span className={styles.gridLine} />
              <span className={styles.gridLine} />
            </div>
            <div className={styles.bars}>
              {daily.map((day, index) => {
                const value = metricValue(day, metric)
                const cost = day.cost
                return (
                  <div
                    key={day.date}
                    className={clsx(
                      styles.barColumn,
                      tip?.index === index && styles.barColumnActive
                    )}
                  >
                    <div className={styles.barPair}>
                      <div
                        className={clsx(styles.bar, value === 0 && styles.barEmpty)}
                        style={{
                          height:
                            value === 0
                              ? 2
                              : `${Math.max(3, Math.round((value / maxDaily) * 100))}%`,
                        }}
                      />
                      {metric === 'tokens' ? (
                        <div
                          className={clsx(styles.bar, styles.barSecondary, cost === 0 && styles.barEmpty)}
                          style={{
                            height:
                              cost === 0
                                ? 2
                                : `${Math.max(3, Math.round((cost / maxCost) * 100))}%`,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className={styles.xAxis}>
          <span className={styles.xAxisSpacer} />
          <div className={styles.xLabels}>
            {daily.map((day, index) => (
              <span key={day.date} className={styles.xLabel}>
                {labelIndices.has(index) ? shortDate(day.date) : ''}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.chartDivider} />
        <div className={styles.heatBlock}>
          <div className={styles.heatHead}>
            <span className={styles.subLabel}>
              {t('usageHeatmapTitle')} · {t('usageHeatWindow')}
            </span>
            <span className={styles.heatHeadStat}>
              {t('usageHeatActive', { count: heatActive })}
            </span>
          </div>
          <div className={styles.calendarHeader}>
            {weekNames.map((name, index) => (
              <span key={index}>{name}</span>
            ))}
          </div>
          <div className={styles.heatmap} onMouseLeave={() => setHeatIndex(null)}>
            {calendarDays.map((day, index) => {
              if (!day) {
                return <span key={`void-${index}`} className={styles.heatCellVoid} />
              }
              const value = metricValue(day, metric)
              return (
                <span
                  key={day.date}
                  className={clsx(
                    styles.heatCell,
                    HEAT_LEVELS[heatLevel(value, heatMax)],
                    heatIndex === day.index && styles.heatCellActive
                  )}
                  title={`${shortDate(day.date)} · ${metricText(value, metric)}`}
                  onMouseEnter={() => setHeatIndex(day.index)}
                >
                  <span className={styles.heatDay}>{dayOfMonth(day.date)}</span>
                </span>
              )
            })}
          </div>
          <div className={styles.heatFooter}>
            <span className={styles.subLabel}>{t('usageHeatHint')}</span>
            <div className={styles.legend}>
              <span>{t('usageHeatLess')}</span>
              {HEAT_LEVELS.map((level, index) => (
                <span key={index} className={clsx(styles.legendCell, level)} />
              ))}
              <span>{t('usageHeatMore')}</span>
            </div>
          </div>
        </div>

        {tip && tipDay ? (
          <div
            className={clsx(styles.tooltip, tip.side === 'left' && styles.tooltipLeft)}
            style={{ left: tip.x, top: tip.y }}
            role="tooltip"
          >
            <div className={styles.tooltipDate}>{shortDate(tipDay.date)}</div>
            <div className={clsx(styles.tooltipRow, metric === 'tokens' && styles.tooltipRowActive)}>
              <span>{t('usageTrendToken')}</span>
              <strong>{formatNumber(tipDay.tokens)}</strong>
            </div>
            <div className={clsx(styles.tooltipRow, metric === 'cost' && styles.tooltipRowActive)}>
              <span>{t('usageTrendCost')}</span>
              <strong>{formatMoney(tipDay.cost)}</strong>
            </div>
            <div className={clsx(styles.tooltipRow, metric === 'replies' && styles.tooltipRowActive)}>
              <span>{t('usageTrendReplies')}</span>
              <strong>{formatNumber(tipDay.replies)}</strong>
            </div>
            <div className={styles.tooltipDivider} />
            <div className={styles.tooltipRow}>
              <span>{t('usageCompositionMiss')}</span>
              <strong>{formatNumber(tipDay.input)}</strong>
            </div>
            <div className={styles.tooltipRow}>
              <span>{t('usageCompositionHit')}</span>
              <strong>{formatNumber(tipDay.cacheRead)}</strong>
            </div>
            <div className={styles.tooltipRow}>
              <span>{t('usageCompositionWrite')}</span>
              <strong>{formatNumber(tipDay.cacheWrite)}</strong>
            </div>
            <div className={styles.tooltipRow}>
              <span>{t('usageCompositionOutput')}</span>
              <strong>{formatNumber(tipDay.output)}</strong>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** 24 小时请求分布：悬浮绘图区任意位置显示该小时的请求数与占比 */
export const HourlyChart = ({ hours }: { hours: readonly number[] }) => {
  const t = useTranslate()
  const max = Math.max(1, ...hours)
  const peak = hourPeak(hours)
  const total = hours.reduce((sum, count) => sum + (count ?? 0), 0)
  const cardRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<HourTip | null>(null)
  const tipCount = tip ? (hours[tip.hour] ?? 0) : 0

  const showTip = (event: MouseEvent<HTMLElement>, hour: number) => {
    const card = cardRef.current?.getBoundingClientRect()
    if (!card) {
      return
    }
    setTip((prev) => {
      const { x, y, side } = tipPosition(event, card, 70, 44, 150)
      return prev &&
        prev.hour === hour &&
        prev.side === side &&
        Math.abs(prev.x - x) < 4 &&
        Math.abs(prev.y - y) < 4
        ? prev
        : { x, y, hour, side }
    })
  }

  /** 按横向比例换算成小时列，柱间空隙也能显示数据 */
  const onPlotMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
    showTip(event, Math.max(0, Math.min(23, Math.floor(ratio * 24))))
  }

  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{t('usageHourlyTitle')}</h4>
      <div ref={cardRef} className={styles.hourCard}>
        <div className={styles.hourMeta}>
          <span className={styles.hourMetaMax}>{t('usageHourlyMax', { count: max })}</span>
          <span className={styles.hourMetaPeak}>
            {peak
              ? t('usageHourlyPeak', {
                  hour: String(peak.hour).padStart(2, '0'),
                  next: String((peak.hour + 1) % 24).padStart(2, '0'),
                  count: peak.count,
                })
              : t('usageHourlyNoData')}
          </span>
        </div>
        <div className={styles.hourPlot} onMouseLeave={() => setTip(null)}>
          <div className={styles.hourAxis}>
            <span>{max}</span>
            <span>{Math.round(max / 2)}</span>
            <span>0</span>
          </div>
          <div className={styles.hourPlotMain} onMouseMove={onPlotMove}>
            <div className={styles.hourGrid}>
              <span className={styles.hourGridLine} />
              <span className={styles.hourGridLine} />
              <span className={styles.hourGridLine} />
            </div>
            <div className={styles.hourBars}>
              {Array.from({ length: 24 }, (_, hour) => {
                const count = hours[hour] ?? 0
                return (
                  <div
                    key={hour}
                    className={clsx(
                      styles.hourColumn,
                      tip?.hour === hour && styles.hourColumnActive
                    )}
                  >
                    <div
                      className={clsx(
                        styles.hourBar,
                        count === 0 && styles.barEmpty,
                        peak?.hour === hour && styles.hourBarPeak,
                        tip?.hour === hour && styles.hourBarActive
                      )}
                      style={{ height: `${Math.max(3, Math.round((count / max) * 100))}%` }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className={styles.hourLabelRow}>
          <span className={styles.hourAxisSpacer} />
          <div className={styles.hourLabels}>
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour}>
                {hourLabelIndices.has(hour) ? String(hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.hint}>{t('usageHourlyHint')}</div>

        {tip ? (
          <div
            className={clsx(styles.tooltip, tip.side === 'left' && styles.tooltipLeft)}
            style={{ left: tip.x, top: tip.y }}
            role="tooltip"
          >
            <div className={styles.tooltipDate}>
              {String(tip.hour).padStart(2, '0')}:00–
              {String((tip.hour + 1) % 24).padStart(2, '0')}:00
              {peak?.hour === tip.hour ? (
                <span className={styles.tooltipTag}>{t('usageHourlyPeakTag')}</span>
              ) : null}
            </div>
            <div className={styles.tooltipRow}>
              <span>{t('usageKpiRequests')}</span>
              <strong>{formatNumber(tipCount)}</strong>
            </div>
            <div className={styles.tooltipRow}>
              <span>{t('usageHourlyShare')}</span>
              <strong>{percent(tipCount, total)}%</strong>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
