import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { selectSession } from '../../services/chat/store.js'
import { collectDetailedUsage, type DetailedUsage } from '../../services/chat/detailedUsage.js'
import type { UsageRange } from '../../services/chat/usageRange.js'
import { closeSettings } from './settingsDialogState.js'
import { formatMoney, formatNumber, percent } from '../../utils/usageChart.js'
import { HourlyChart, UsageDailyChart } from './usage/charts.js'
import {
  CompositionSection,
  ContextBreakdownSection,
  DailyQuota,
  UsageBilling,
  UsageContextManage,
} from './usage/sections.js'
import styles from './UsagePanel.module.scss'

const RANGES: { value: UsageRange; label: 'usageRangeToday' | 'usageRange7d' | 'usageRange30d' }[] = [
  { value: 'today', label: 'usageRangeToday' },
  { value: '7d', label: 'usageRange7d' },
  { value: '30d', label: 'usageRange30d' },
]

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

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('usageToolsTitle')}</h4>
            {data.tools.calls === 0 ? (
              <div className={styles.emptyBox}>{t('usageToolsEmpty')}</div>
            ) : (
              <>
                <div className={styles.extraGrid}>
                  <div className={styles.extra}>
                    <span className={styles.kpiLabel}>{t('usageToolsCalls')}</span>
                    <span className={styles.kpiValue}>{formatNumber(data.tools.calls)}</span>
                  </div>
                  <div className={styles.extra}>
                    <span className={styles.kpiLabel}>{t('usageToolsErrors')}</span>
                    <span className={styles.kpiValue}>{formatNumber(data.tools.errors)}</span>
                  </div>
                  <div className={styles.extra}>
                    <span className={styles.kpiLabel}>{t('usageToolsSuccessRate')}</span>
                    <span className={styles.kpiValue}>
                      {percent(data.tools.calls - data.tools.errors, data.tools.calls)}%
                    </span>
                  </div>
                  <div className={styles.extra}>
                    <span className={styles.kpiLabel}>{t('usageToolsAvgMs')}</span>
                    <span className={styles.kpiValue}>
                      {formatNumber(data.tools.avgMs)} ms
                    </span>
                  </div>
                </div>
                <div className={styles.subLabel}>{t('usageToolsByName')}</div>
                <div className={styles.dataTable}>
                  <div className={styles.dataHead}>
                    <span>{t('usageToolsName')}</span>
                    <span>{t('usageToolsCalls')}</span>
                    <span>{t('usageToolsErrors')}</span>
                    <span>{t('usageToolsMs')}</span>
                  </div>
                  {data.tools.byName.map((item) => (
                    <div key={item.name} className={styles.dataRow}>
                      <span className={styles.rowName}>{item.name}</span>
                      <span>{formatNumber(item.calls)}</span>
                      <span>{formatNumber(item.errors)}</span>
                      <span>{formatNumber(item.avgMs)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className={styles.hint}>{t('usageToolsHint')}</div>
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
