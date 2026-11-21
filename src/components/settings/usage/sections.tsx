import clsx from 'clsx'
import { useTranslate } from '../../../i18n/index.js'
import { setUsageDailyQuota, setUsageFreeServerTools, useSettings } from '../../../services/settings.js'
import {
  clearLedger,
  clearLedgerSession,
  clearLedgerSessions,
  hideAllRecords,
  hideRecord,
} from '../../../services/chat/usageLedger.js'
import type { DetailedUsage, ShareItem } from '../../../services/chat/detailedUsage.js'
import { EXTRA_PRICES } from '../../../services/chat/usagePricing.js'
import { downloadBlob } from '../../../utils/download.js'
import { csvCell } from '../../../utils/csv.js'
import { formatMoney, formatNumber, shortDate } from '../../../utils/usageChart.js'
import {
  DonutChart,
  DonutLegend,
  PressureMeter,
  type DonutItem,
} from '../../usage/UsageVisuals.js'
import { SettingSwitch } from '../settingsShared.js'
import { showToast } from '../../base/toastState.js'
import styles from '../UsagePanel.module.scss'

/** 输入构成四类 / 上下文分类八类的配色（与 SessionStats 共用构成色） */
export const COMPOSITION_COLORS = [
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

/** 输入构成环：四类 Token 各自带 token 与占比 */
export const CompositionSection = ({ items }: { items: readonly ShareItem[] }) => {
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
export const ContextBreakdownSection = ({ items }: { items: readonly ShareItem[] }) => {
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
export const DailyQuota = ({ data }: { data: DetailedUsage }) => {
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
export const UsageBilling = ({ data, freeServerTools }: { data: DetailedUsage; freeServerTools: boolean }) => {
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
export const UsageContextManage = ({ data, onReload }: { data: DetailedUsage; onReload: () => void }) => {
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
      [],
      ['tool', 'calls', 'errors', 'avg_ms'],
      ...data.tools.byName.map((item) => [item.name, item.calls, item.errors, item.avgMs]),
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
