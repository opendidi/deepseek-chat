import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { setUsageDailyQuota, setUsageFreeServerTools, useSettings } from '../../services/settings.js'
import { selectSession } from '../../services/chat/store.js'
import {
  collectDetailedUsage,
  type DetailedUsage,
  type ShareItem,
} from '../../services/chat/detailedUsage.js'
import { EXTRA_PRICES } from '../../services/chat/usagePricing.js'
import type { UsageRange } from '../../services/chat/usageRange.js'
import {
  clearLedger,
  clearLedgerSession,
  clearLedgerSessions,
  hideAllRecords,
  hideRecord,
} from '../../services/chat/usageLedger.js'
import { closeSettings } from './settingsDialogState.js'
import { SettingSwitch } from './settingsShared.js'
import { showToast } from '../base/toastState.js'
import { downloadBlob } from '../../utils/download.js'
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
} from '../../utils/usageChart.js'
import {
  DonutChart,
  DonutLegend,
  PressureMeter,
  type DonutItem,
} from '../usage/UsageVisuals.js'
import styles from './UsagePanel.module.scss'

type Metric = UsageMetric
type ChartTip = { x: number; y: number; index: number; side: 'left' | 'right' }
type HourTip = { x: number; y: number; hour: number; side: 'left' | 'right' }

const RANGES: { value: UsageRange; label: 'usageRangeToday' | 'usageRange7d' | 'usageRange30d' }[] = [
  { value: 'today', label: 'usageRangeToday' },
  { value: '7d', label: 'usageRange7d' },
  { value: '30d', label: 'usageRange30d' },
]

const METRICS: { value: Metric; label: 'usageTrendToken' | 'usageTrendCost' | 'usageTrendReplies' }[] = [
  { value: 'tokens', label: 'usageTrendToken' },
  { value: 'cost', label: 'usageTrendCost' },
  { value: 'replies', label: 'usageTrendReplies' },
]

/** 热力图按活动强度分四级，避免连续透明度让空白格子也显得像有数据 */
const HEAT_LEVELS = [styles.level0, styles.level1, styles.level2, styles.level3]

const COMPOSITION_COLORS = [
  'var(--dsw-alias-brand-primary)',
  'var(--dsw-static-blue-300)',
  'var(--dsw-static-amber-400)',
  'var(--dsw-static-green-400)',
]

const CATEGORY_COLORS = [
  'var(--dsw-alias-brand-primary)',
  'var(--dsw-static-blue-300)',
  'var(--dsw-static-amber-400)',
  'var(--dsw-static-green-400)',
  'var(--dsw-static-blue-600)',
  'var(--dsw-static-amber-600)',
  'var(--dsw-static-green-500)',
  'var(--dsw-static-blue-800)',
]

const csvCell = (value: string | number): string => {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 每日趋势双柱（token 模式右柱为费用）+ 固定 8 周热力图 */
const UsageDailyChart = ({ data }: { data: DetailedUsage }) => {
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
    const x = Math.max(76, Math.min(card.width - 76, event.clientX - card.left))
    const y = Math.max(52, Math.min(card.height - 52, event.clientY - card.top))
    const side: ChartTip['side'] = x > card.width - 170 ? 'left' : 'right'
    setTip((prev) =>
      prev &&
      prev.index === index &&
      prev.side === side &&
      Math.abs(prev.x - x) < 4 &&
      Math.abs(prev.y - y) < 4
        ? prev
        : { x, y, index, side }
    )
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
const HourlyChart = ({ hours }: { hours: readonly number[] }) => {
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
    const x = Math.max(70, Math.min(card.width - 70, event.clientX - card.left))
    const y = Math.max(44, Math.min(card.height - 44, event.clientY - card.top))
    const side: HourTip['side'] = x > card.width - 150 ? 'left' : 'right'
    setTip((prev) =>
      prev &&
      prev.hour === hour &&
      prev.side === side &&
      Math.abs(prev.x - x) < 4 &&
      Math.abs(prev.y - y) < 4
        ? prev
        : { x, y, hour, side }
    )
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

/** 输入构成环：四类 Token 各自带 token 与占比 */
const CompositionSection = ({ items }: { items: readonly ShareItem[] }) => {
  const t = useTranslate()
  const total = items.reduce((sum, item) => sum + item.tokens, 0)
  const donutItems: DonutItem[] = items.map((item, index) => ({
    key: item.key,
    label: t(item.key),
    value: item.tokens,
    color: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length],
  }))
  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{t('usageCompositionTitle')}</h4>
      {total === 0 ? (
        <div className={styles.emptyBox}>{t('usageCompositionEmpty')}</div>
      ) : (
        <div className={styles.compositionBox}>
          <DonutChart
            items={donutItems}
            centerValue={formatNumber(total)}
            centerLabel={t('usageMetricTokens')}
          />
          <DonutLegend items={donutItems} formatValue={formatNumber} />
        </div>
      )}
      <div className={styles.hint}>{t('usageCompositionHint')}</div>
    </section>
  )
}

/** 上下文分类：当前会话最近一轮请求按八类估算 token 与占比 */
const ContextBreakdownSection = ({ items }: { items: readonly ShareItem[] }) => {
  const t = useTranslate()
  const total = items.reduce((sum, item) => sum + item.tokens, 0)
  const max = Math.max(1, ...items.map((item) => item.tokens))
  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{t('usageContextTitle')}</h4>
      {total === 0 ? (
        <div className={styles.emptyBox}>{t('usageContextBreakdownEmpty')}</div>
      ) : (
        <div className={styles.categoryList}>
          {items.map((item, index) => (
            <div
              key={item.key}
              className={clsx(styles.categoryRow, item.tokens === 0 && styles.categoryMuted)}
            >
              <span className={styles.categoryDot} style={{ backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
              <span className={styles.categoryLabel}>{t(item.key)}</span>
              <span className={styles.categoryBar}>
                <span
                  style={{
                    width: `${(item.tokens / max) * 100}%`,
                    backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
                  }}
                />
              </span>
              <span className={styles.categoryValue}>{formatNumber(item.tokens)}</span>
              <span className={styles.categoryShare}>{item.share}%</span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.hint}>{t('usageContextBreakdownHint')}</div>
    </section>
  )
}

/** 今日用量：与 400 天账本分开存储，跨天自动归零，同时配置每日额度提醒 */
const DailyQuota = ({ data }: { data: DetailedUsage }) => {
  const t = useTranslate()
  const quota = useSettings((state) => state.usageDailyQuota)
  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{t('usageTodayTitle')}</h4>
      <div className={styles.extraGrid}>
        <div className={styles.extra}>
          <span className={styles.kpiLabel}>{t('usageTodayRequests')}</span>
          <span className={styles.kpiValue}>{formatNumber(data.today.requests)}</span>
        </div>
        <div className={styles.extra}>
          <span className={styles.kpiLabel}>{t('usageTodayTokens')}</span>
          <span className={styles.kpiValue}>{formatNumber(data.today.tokens)}</span>
        </div>
        <div className={styles.extra}>
          <span className={styles.kpiLabel}>{t('usageTodayCost')}</span>
          <span className={styles.kpiValue}>{formatMoney(data.today.cost)}</span>
        </div>
        <div className={styles.extra}>
          <span className={styles.kpiLabel}>{t('usageKpiWebSearch')}</span>
          <span className={styles.kpiValue}>{formatNumber(data.today.webSearch)}</span>
        </div>
      </div>
      <label className={styles.quotaRow}>
        <span>{t('usageDailyQuota')}</span>
        <input
          type="number"
          min="0"
          step="0.5"
          value={quota}
          className={styles.quotaInput}
          onChange={(event) => setUsageDailyQuota(Number(event.target.value))}
        />
        <span>¥</span>
      </label>
      <div className={styles.hint}>{t('usageDailyQuotaDesc')}</div>
    </section>
  )
}

/** 计费口径：按模型列出未命中 / 命中 / 输出单价，并摊开附加项与高峰规则 */
const UsageBilling = ({ data, freeServerTools }: { data: DetailedUsage; freeServerTools: boolean }) => {
  const t = useTranslate()
  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{t('usageBillingTitle')}</h4>
      <div className={styles.billingBox}>
        <SettingSwitch
          label={t('usageFreeServerTools')}
          description={t('usageFreeServerToolsDesc')}
          checked={freeServerTools}
          onChange={setUsageFreeServerTools}
        />
        <div className={styles.priceUnit}>{t('usageBillingUnit')}</div>
        <div className={styles.priceTable4}>
          <div className={styles.priceHead}>
            <span>{t('usageBillingModel')}</span>
            <span>{t('usageBillingMiss')}</span>
            <span>{t('usageBillingHit')}</span>
            <span>{t('usageBillingOutput')}</span>
          </div>
          {data.billing.map((item) => (
            <div key={item.model} className={styles.priceRow4}>
              <span>{item.name}</span>
              <span>¥{item.prices[1].toFixed(2)}</span>
              <span>¥{item.prices[0].toFixed(2)}</span>
              <span>¥{item.prices[2].toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className={styles.priceTable}>
          <div className={styles.priceRow}>
            <span>{t('usagePriceSearch')}</span>
            <span>
              {freeServerTools
                ? t('usagePriceFree')
                : t('usagePriceSearchValue', { price: EXTRA_PRICES.legacySearch })}
            </span>
          </div>
          <div className={styles.priceRow}>
            <span>{t('usagePricePage')}</span>
            <span>{freeServerTools ? t('usagePriceFree') : t('usagePricePageValue')}</span>
          </div>
          <div className={styles.priceRow}>
            <span>{t('usagePriceTts')}</span>
            <span>{t('usagePriceTtsValue')}</span>
          </div>
          <div className={styles.priceRow}>
            <span>{t('usagePriceAsr')}</span>
            <span>{t('usagePriceAsrValue')}</span>
          </div>
        </div>
        <div className={styles.hint}>{t('usagePeakHint')}</div>
      </div>
    </section>
  )
}

/** 上下文统计管理：窗口与压缩阈值、会话记录表格、清除与导出 */
const UsageContextManage = ({ data, onReload }: { data: DetailedUsage; onReload: () => void }) => {
  const t = useTranslate()
  const { context } = data
  const windowPercent = Math.min(100, Math.round((context.current / (context.window - context.reserve)) * 100))

  const exportJson = () => {
    downloadBlob(
      `usage-${data.range}-${new Date(data.generatedAt).toISOString().slice(0, 10)}.json`,
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    )
  }

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ['date', 'tokens', 'cost', 'replies', 'miss_input', 'cache_write', 'cache_hit', 'output'],
      ...data.daily.map((day) => [
        day.date, day.tokens, day.cost.toFixed(6), day.replies,
        day.input, day.cacheWrite, day.cacheRead, day.output,
      ]),
      [],
      ['hour', 'requests'],
      ...data.hourly.map((count, hour) => [hour, count]),
      [],
      ['model', 'requests', 'tokens', 'cost'],
      ...data.byModel.map((item) => [item.name, item.replies, item.tokens, item.cost.toFixed(6)]),
      [],
      ['session', 'tokens', 'cost', 'replies'],
      ...data.bySession.map((item) => [item.title, item.tokens, item.cost.toFixed(6), item.replies]),
      [],
      ['context_record', 'tokens', 'window_percent', 'last_request'],
      ...data.contextRecords.map((item) => [
        item.title, item.tokens, item.percent, new Date(item.lastAt).toISOString(),
      ]),
      [],
      ['metric', 'value'],
      ['web_search', data.totals.webSearch],
      ['pages_parsed', data.totals.pageFetch],
      ['tts_chars', data.totals.ttsChars],
      ['asr_seconds', data.totals.asrSeconds],
    ]
    downloadBlob(
      `usage-${data.range}.csv`,
      new Blob([`\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`], {
        type: 'text/csv;charset=utf-8',
      })
    )
  }

  const removeRecord = (id: string) => {
    hideRecord(id)
    clearLedgerSession(id)
    onReload()
    showToast({ key: 'usageRecordRemoved' })
  }

  const clearRecords = () => {
    hideAllRecords(data.contextRecords.map((item) => item.id))
    clearLedgerSessions()
    onReload()
    showToast({ key: 'usageRecordsCleared' })
  }

  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{t('usageContextManageTitle')}</h4>
      <div className={styles.contextGrid}>
        <div className={styles.contextItem}>
          <span className={styles.kpiLabel}>{t('usageContextCurrent')}</span>
          <span className={styles.kpiValue}>{formatNumber(context.current)}</span>
        </div>
        <div className={styles.contextItem}>
          <span className={styles.kpiLabel}>{t('usageContextWindow')}</span>
          <span className={styles.kpiValue}>{windowPercent}%</span>
        </div>
        <div className={styles.contextItem}>
          <span className={styles.kpiLabel}>{t('usageContextRemaining')}</span>
          <span className={styles.kpiValue}>{formatNumber(context.remaining)}</span>
        </div>
        <div className={styles.contextItem}>
          <span className={styles.kpiLabel}>{t('usageContextCompressAt')}</span>
          <span className={styles.kpiValue}>{formatNumber(context.compressAt)}</span>
        </div>
      </div>
      <PressureMeter value={context.current} max={context.window - context.reserve} compressAt={context.compressAt} />
      <div className={styles.hint}>{t('usageContextWindowHint')}</div>

      <div className={styles.subLabel}>{t('usageRecordsTitle')}</div>
      {data.contextRecords.length === 0 ? (
        <div className={styles.emptyBox}>{t('usageContextRecordsEmpty')}</div>
      ) : (
        <div className={styles.recordTable}>
          <div className={styles.recordHead}>
            <span>{t('usageRecordsSession')}</span>
            <span>{t('usageRecordsTokens')}</span>
            <span>{t('usageRecordsShare')}</span>
            <span>{t('usageRecordsLast')}</span>
            <span />
          </div>
          {data.contextRecords.slice(0, 20).map((item) => (
            <div key={item.id} className={styles.recordRow}>
              <span className={styles.recordName} title={item.title || undefined}>
                {item.title || t('untitledChat')}
              </span>
              <span>{formatNumber(item.tokens)}</span>
              <span>{item.percent}%</span>
              <span>{item.lastAt ? shortDate(new Date(item.lastAt).toISOString().slice(0, 10)) : '—'}</span>
              <button type="button" className={styles.linkButton} onClick={() => removeRecord(item.id)}>
                {t('usageRecordsRemove')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={onReload}>
          {t('usageRefresh')}
        </button>
        <button type="button" className={styles.action} onClick={exportJson}>
          {t('usageExportJson')}
        </button>
        <button type="button" className={styles.action} onClick={exportCsv}>
          {t('usageExportCsv')}
        </button>
        <button type="button" className={styles.action} onClick={clearRecords}>
          {t('usageRecordsClearAll')}
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            clearLedger()
            onReload()
            showToast({ key: 'usageCleared' })
          }}
        >
          {t('usageClearLedger')}
        </button>
      </div>
      <div className={styles.hint}>{t('usageLedgerHint')}</div>
    </section>
  )
}

/** 设置 → 统计：按时间范围聚合本地会话与本机账本，费用为按官方单价的估算值 */
export const UsagePanel = () => {
  const t = useTranslate()
  const freeServerTools = useSettings((state) => state.usageFreeServerTools)
  const [range, setRange] = useState<UsageRange>('7d')
  const [data, setData] = useState<DetailedUsage | null>(null)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    setRefreshing(true)
    // 切换范围时保留上一份数据，避免整页闪回加载态
    void collectDetailedUsage(range, freeServerTools)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setRefreshing(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
          setRefreshing(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [range, freeServerTools, reload])

  const totals = data?.totals
  const kpis: { label: string; value: string }[] = [
    { label: t('usageKpiTotalTokens'), value: formatNumber(totals?.tokens ?? 0) },
    { label: t('usageKpiCost'), value: formatMoney(totals?.cost ?? 0) },
    { label: t('usageKpiCacheHitRate'), value: `${totals?.cacheHitRate ?? 0}%` },
    { label: t('usageKpiRequests'), value: formatNumber(totals?.modelCalls ?? 0) },
    { label: t('usageKpiActiveDays'), value: formatNumber(totals?.activeDays ?? 0) },
    { label: t('usageKpiWebSearch'), value: formatNumber(totals?.webSearch ?? 0) },
  ]

  const extras = [
    { label: t('usageWebSearch'), value: formatNumber(totals?.webSearch ?? 0) },
    { label: t('usagePageFetch'), value: formatNumber(totals?.pageFetch ?? 0) },
    { label: t('usageTtsChars'), value: formatNumber(totals?.ttsChars ?? 0) },
    { label: t('usageAsrSeconds'), value: formatNumber(totals?.asrSeconds ?? 0) },
  ]

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>{t('usagePanelTitle')}</h3>
        <span className={styles.estimated}>
          {refreshing ? t('usageRefreshing') : t('usageEstimated')}
        </span>
        <div className={styles.segments}>
          {RANGES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={clsx(styles.segment, range === item.value && styles.segmentActive)}
              onClick={() => setRange(item.value)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>

      {failed && !data ? (
        <div className={styles.empty}>
          {t('usageFailed')}
          <button type="button" className={styles.linkButton} onClick={() => setReload((n) => n + 1)}>
            {t('usageRetry')}
          </button>
        </div>
      ) : !data ? (
        <div className={styles.empty}>{t('usageLoading')}</div>
      ) : (
        <>
          {failed ? <div className={styles.inlineError}>{t('usageFailed')}</div> : null}
          <div className={styles.kpiGrid}>
            {kpis.map((item, index) => (
              <div key={item.label} className={clsx(styles.kpi, index === 0 && styles.kpiPrimary)}>
                <span className={styles.kpiLabel}>{item.label}</span>
                <span className={styles.kpiValue}>{item.value}</span>
              </div>
            ))}
          </div>

          <UsageDailyChart data={data} />
          <HourlyChart hours={data.hourly} />
          <CompositionSection items={data.composition} />

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('usageModelTitle')}</h4>
            {data.byModel.length === 0 ? (
              <div className={styles.emptyBox}>{t('usageEmptyHint')}</div>
            ) : (
              <div className={styles.dataTable}>
                <div className={styles.dataHead}>
                  <span>{t('usageBillingModel')}</span>
                  <span>{t('usageModelRequests')}</span>
                  <span>{t('usageModelTokens')}</span>
                  <span>{t('usageModelCost')}</span>
                </div>
                {data.byModel.map((item) => (
                  <div key={item.model} className={styles.dataRow}>
                    <span className={styles.rowName}>{item.name}</span>
                    <span>{formatNumber(item.replies)}</span>
                    <span>{formatNumber(item.tokens)}</span>
                    <span>{formatMoney(item.cost)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.hint}>{t('usageUnknownModelHint')}</div>
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('usageSessionTitle')}</h4>
            {data.bySession.length === 0 ? (
              <div className={styles.emptyBox}>
                <div>{t('usageSessionEmpty')}</div>
                <div className={styles.hint}>{t('usageSessionHint')}</div>
              </div>
            ) : (
              <div className={styles.sessionTable}>
                <div className={styles.sessionHead}>
                  <span>{t('usageRecordsSession')}</span>
                  <span>{t('usageModelTokens')}</span>
                  <span>{t('usageModelCost')}</span>
                  <span>{t('usageModelRequests')}</span>
                  <span />
                </div>
                {data.bySession.map((item) => (
                  <div key={item.id} className={styles.sessionRow}>
                    <span className={styles.rowName} title={item.title || undefined}>
                      {item.title || t('untitledChat')}
                    </span>
                    <span>{formatNumber(item.tokens)}</span>
                    <span>{formatMoney(item.cost)}</span>
                    <span>{formatNumber(item.replies)}</span>
                    <button
                      type="button"
                      className={styles.linkButton}
                      disabled={item.deleted}
                      title={item.deleted ? t('usageSessionDeleted') : undefined}
                      onClick={() => {
                        selectSession(item.id)
                        closeSettings()
                      }}
                    >
                      {item.deleted ? t('usageSessionDeleted') : t('usageOpen')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('usageExtrasTitle')}</h4>
            <div className={styles.extraGrid}>
              {extras.map((item) => (
                <div key={item.label} className={styles.extra}>
                  <span className={styles.kpiLabel}>{item.label}</span>
                  <span className={styles.kpiValue}>{item.value}</span>
                </div>
              ))}
            </div>
            <div className={styles.hint}>{t('usageExtrasHint')}</div>
          </section>

          <ContextBreakdownSection items={data.contextBreakdown} />
          <DailyQuota data={data} />
          <UsageBilling data={data} freeServerTools={freeServerTools} />
          <UsageContextManage data={data} onReload={() => setReload((n) => n + 1)} />
        </>
      )}
    </div>
  )
}
