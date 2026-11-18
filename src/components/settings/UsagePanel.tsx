import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { BUILTIN_MODELS } from '../../services/models.js'
import { setUsageFreeServerTools, useSettings } from '../../services/settings.js'
import { selectSession } from '../../services/chat/store.js'
import {
  collectDetailedUsage,
  EXTRA_PRICES,
  type DetailedUsage,
} from '../../services/chat/detailedUsage.js'
import type { UsageRange } from '../../services/chat/usageRange.js'
import { clearLedger } from '../../services/chat/usageLedger.js'
import { closeSettings } from './settingsDialogState.js'
import { SettingSwitch } from './settingsShared.js'
import { showToast } from '../base/toastState.js'
import {
  axisLabel,
  chartLabelIndices,
  formatMoney,
  formatNumber,
  heatLevel,
  metricText,
  metricValue,
  padHeatDays,
  shortDate,
  weekdayLabels,
  type UsageMetric,
} from '../../utils/usageChart.js'
import styles from './UsagePanel.module.scss'

type Metric = UsageMetric

const RANGES: { value: UsageRange; label: 'usageRangeToday' | 'usageRange7d' | 'usageRange30d' }[] = [
  { value: 'today', label: 'usageRangeToday' },
  { value: '7d', label: 'usageRange7d' },
  { value: '30d', label: 'usageRange30d' },
]

const METRICS: { value: Metric; label: 'usageMetricTokens' | 'usageMetricCost' | 'usageMetricReplies' }[] = [
  { value: 'tokens', label: 'usageMetricTokens' },
  { value: 'cost', label: 'usageMetricCost' },
  { value: 'replies', label: 'usageMetricReplies' },
]

const download = (filename: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 热力图按活动强度分四级，避免连续透明度让空白格子也显得像有数据 */
const HEAT_LEVELS = [styles.level0, styles.level1, styles.level2, styles.level3]

/** 设置 → 统计：按时间范围聚合本地会话与本机账本，费用为按官方单价的估算值 */
export const UsagePanel = () => {
  const t = useTranslate()
  const freeServerTools = useSettings((state) => state.usageFreeServerTools)
  const [range, setRange] = useState<UsageRange>('7d')
  const [metric, setMetric] = useState<Metric>('tokens')
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

  const maxDaily = useMemo(
    () => Math.max(1, ...(data?.daily.map((day) => metricValue(day, metric)) ?? [1])),
    [data, metric]
  )
  const peakValue = useMemo(
    () => Math.max(0, ...(data?.daily.map((day) => metricValue(day, metric)) ?? [0])),
    [data, metric]
  )
  const peakDay = data?.daily.find((day) => metricValue(day, metric) === peakValue)
  const activeDays = useMemo(
    () => (data?.daily ?? []).filter((day) => metricValue(day, metric) > 0).length,
    [data, metric]
  )
  const labelIndices = useMemo(() => chartLabelIndices(data?.daily.length ?? 0), [data])
  const paddedDays = useMemo(() => padHeatDays(data?.daily ?? []), [data])
  const weekLabels = weekdayLabels(data?.daily[0]?.date ?? '', t('usageWeekdays').split(''))
  const totals = data?.totals
  const context = data?.context
  const windowPercent = context
    ? Math.min(100, Math.round((context.current / (context.window - context.reserve)) * 100))
    : 0

  const exportJson = () => {
    if (!data) {
      return
    }
    download(
      `usage-${data.range}-${new Date(data.generatedAt).toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
      'application/json'
    )
  }

  const exportCsv = () => {
    if (!data) {
      return
    }
    const rows = [
      ['date', 'tokens', 'cost', 'replies'].join(','),
      ...data.daily.map((day) =>
        [day.date, day.tokens, day.cost.toFixed(6), day.replies].join(',')
      ),
      '',
      ['metric', 'value'].join(','),
      ['web_search', totals?.webSearch ?? 0].join(','),
      ['pages_parsed', totals?.pageFetch ?? 0].join(','),
      ['tts_chars', totals?.ttsChars ?? 0].join(','),
      ['asr_seconds', totals?.asrSeconds ?? 0].join(','),
    ]
    download(`usage-${data.range}.csv`, `\ufeff${rows.join('\n')}`, 'text/csv;charset=utf-8')
  }

  const kpis: { label: string; value: string }[] = [
    { label: t('usageKpiCost'), value: formatMoney(totals?.cost ?? 0) },
    { label: t('usageKpiReplies'), value: formatNumber(totals?.replies ?? 0) },
    { label: t('usageKpiInput'), value: formatNumber(totals?.inputTokens ?? 0) },
    { label: t('usageKpiOutput'), value: formatNumber(totals?.outputTokens ?? 0) },
    { label: t('usageKpiCached'), value: formatNumber(totals?.cachedTokens ?? 0) },
    { label: t('usageKpiCalls'), value: formatNumber(totals?.modelCalls ?? 0) },
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

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{t('usageDailyTitle')}</h4>
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
            <div className={styles.chartCard}>
              <div className={styles.chartMeta}>
                <span className={styles.chartMetaText}>
                  {peakValue > 0 && peakDay
                    ? t('usageChartPeak', {
                        value: metricText(peakValue, metric),
                        date: shortDate(peakDay.date),
                      })
                    : t('usageChartNoData')}
                </span>
                {data.daily.length > 1 ? (
                  <span className={styles.chartMetaDate}>
                    {shortDate(data.daily[0]?.date ?? '')} –{' '}
                    {shortDate(data.daily[data.daily.length - 1]?.date ?? '')}
                  </span>
                ) : null}
              </div>

              <div className={styles.plot}>
                <div className={styles.yAxis}>
                  <span>{axisLabel(maxDaily, metric)}</span>
                  <span>{axisLabel(maxDaily / 2, metric)}</span>
                  <span>{axisLabel(0, metric)}</span>
                </div>
                <div className={styles.plotMain}>
                  <div className={styles.grid}>
                    <span className={styles.gridLine} />
                    <span className={styles.gridLine} />
                    <span className={styles.gridLine} />
                  </div>
                  <div className={clsx(styles.bars, data.daily.length > 7 && styles.barsCompact)}>
                    {data.daily.map((day) => {
                      const value = metricValue(day, metric)
                      return (
                        <div
                          key={day.date}
                          className={styles.barColumn}
                          title={`${day.date}: ${metricText(value, metric)}`}
                        >
                          <div
                            className={clsx(styles.bar, value === 0 && styles.barEmpty)}
                            style={{
                              height:
                                value === 0 ? 2 : `${Math.max(3, Math.round((value / maxDaily) * 100))}%`,
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className={styles.xAxis}>
                <span className={styles.xAxisSpacer} />
                <div className={styles.xLabels}>
                  {data.daily.map((day, index) => (
                    <span key={day.date} className={styles.xLabel}>
                      {labelIndices.has(index) ? shortDate(day.date) : ''}
                    </span>
                  ))}
                </div>
              </div>

              {data.daily.length > 7 ? (
                <>
                  <div className={styles.chartDivider} />
                  <div className={styles.heatRow}>
                    <div className={styles.heatLeft}>
                      <span className={styles.subLabel}>{t('usageHeatmapTitle')}</span>
                      <div className={styles.heatGridWrap}>
                        <div className={styles.weekLabels}>
                          {weekLabels.map((label, index) => (
                            <span key={index}>{label}</span>
                          ))}
                        </div>
                        <div className={styles.heatmap}>
                          {paddedDays.map((day, index) => {
                            if (!day) {
                              return <span key={`void-${index}`} className={styles.heatCellVoid} />
                            }
                            const value = metricValue(day, metric)
                            return (
                              <span
                                key={day.date}
                                className={clsx(
                                  styles.heatCell,
                                  HEAT_LEVELS[heatLevel(value, maxDaily)]
                                )}
                                title={`${day.date}: ${metricText(value, metric)}`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    </div>
                    <div className={styles.heatInfo}>
                      <div className={styles.heatStat}>
                        <span className={styles.heatStatValue}>{activeDays}</span>
                        <span className={styles.heatStatTotal}>/ {data.daily.length}</span>
                      </div>
                      <span className={styles.subLabel}>{t('usageActiveDaysLabel')}</span>
                      <div className={styles.legend}>
                        <span>{t('usageHeatLess')}</span>
                        {HEAT_LEVELS.map((level, index) => (
                          <span key={index} className={clsx(styles.legendCell, level)} />
                        ))}
                        <span>{t('usageHeatMore')}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('usageModelTitle')}</h4>
            {data.byModel.length === 0 ? (
              <div className={styles.emptyBox}>{t('usageEmptyHint')}</div>
            ) : (
              <div className={styles.rows}>
                {data.byModel.map((item) => (
                  <div key={item.model} className={styles.row}>
                    <span className={styles.rowName}>{item.name}</span>
                    <span className={styles.rowValue}>{formatNumber(item.tokens)} Token</span>
                    <span className={styles.rowValue}>{formatMoney(item.cost)}</span>
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
              <div className={styles.rows}>
                {data.bySession.map((item) => (
                  <div key={item.id} className={styles.row}>
                    <span className={styles.rowName} title={item.title || undefined}>
                      {item.title || t('untitledChat')}
                    </span>
                    <span className={styles.rowValue}>{formatNumber(item.tokens)} Token</span>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => {
                        selectSession(item.id)
                        closeSettings()
                      }}
                    >
                      {t('usageOpen')}
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

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('usageContextTitle')}</h4>
            <div className={styles.emptyBox}>
              <div>{t('usageContextEmpty')}</div>
              <div className={styles.hint}>{t('usageContextHint')}</div>
            </div>
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('usageBillingTitle')}</h4>
            <div className={styles.billingBox}>
              <SettingSwitch
                label={t('usageFreeServerTools')}
                description={t('usageFreeServerToolsDesc')}
                checked={freeServerTools}
                onChange={setUsageFreeServerTools}
              />
              <div className={styles.priceTable}>
                {BUILTIN_MODELS.map((model) => (
                  <div key={model.id} className={styles.priceRow}>
                    <span>{model.name}</span>
                    <span>¥{model.prices?.join(' / ¥') ?? '—'}</span>
                  </div>
                ))}
                <div className={styles.priceRow}>
                  <span>{t('usagePriceSearch')}</span>
                  <span>{freeServerTools ? t('usagePriceFree') : `¥${EXTRA_PRICES.legacySearch} / 次`}</span>
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

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('usageContextManageTitle')}</h4>
            <div className={styles.contextGrid}>
              <div className={styles.contextItem}>
                <span className={styles.kpiLabel}>{t('usageContextCurrent')}</span>
                <span className={styles.kpiValue}>
                  {formatNumber(context?.current ?? 0)} / 1.00M
                </span>
              </div>
              <div className={styles.contextItem}>
                <span className={styles.kpiLabel}>{t('usageContextWindow')}</span>
                <span className={styles.kpiValue}>{windowPercent}%</span>
              </div>
              <div className={styles.contextItem}>
                <span className={styles.kpiLabel}>{t('usageContextTracked')}</span>
                <span className={styles.kpiValue}>{formatNumber(context?.tracked ?? 0)}</span>
              </div>
              <div className={styles.contextItem}>
                <span className={styles.kpiLabel}>{t('usageContextTotal')}</span>
                <span className={styles.kpiValue}>{formatNumber(context?.total ?? 0)}</span>
              </div>
            </div>
            <div className={styles.progress}>
              <span style={{ width: `${windowPercent}%` }} />
            </div>
            <div className={styles.hint}>{t('usageContextWindowHint')}</div>
            {context?.total === 0 ? (
              <div className={styles.emptyBox}>{t('usageContextRecordsEmpty')}</div>
            ) : null}
            <div className={styles.actions}>
              <button type="button" className={styles.action} onClick={() => setReload((n) => n + 1)}>
                {t('usageRefresh')}
              </button>
              <button type="button" className={styles.action} onClick={exportJson}>
                {t('usageExportJson')}
              </button>
              <button type="button" className={styles.action} onClick={exportCsv}>
                {t('usageExportCsv')}
              </button>
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  clearLedger()
                  setReload((n) => n + 1)
                  showToast({ key: 'usageCleared' })
                }}
              >
                {t('usageClearLedger')}
              </button>
            </div>
            <div className={styles.hint}>{t('usageLedgerHint')}</div>
          </section>
        </>
      )}
    </div>
  )
}
