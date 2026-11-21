/** 输入栏的会话统计弹窗：打开时按需聚合，与设置 → 统计共用同一份数据 */
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { collectDetailedUsage, type DetailedUsage } from '../../services/chat/detailedUsage.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { formatNumber, shortDate } from '../../utils/usageChart.js'
import { IconButton } from '../base/IconButton.js'
import { IconChartOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { DonutChart, DonutLegend, PressureMeter, Sparkline } from '../usage/UsageVisuals.js'
import styles from './SessionStats.module.scss'

import { COMPOSITION_COLORS } from '../settings/usage/sections.js'

// 开关独立成 store：移动端从「更多」菜单打开时按钮本身不渲染，弹窗也要能弹
const useSessionStatsOpen = create(() => ({ open: false }))

/** 打开会话统计弹窗（桌面按钮与移动端「更多」菜单共用） */
export const openSessionStats = () => useSessionStatsOpen.setState({ open: true })

/** 桌面端工具行的入口按钮 */
export const SessionStatsButton = ({ disabled = false }: { disabled?: boolean }) => {
  const t = useTranslate()
  return (
    <IconButton
      icon={<IconChartOutline16 />}
      tooltip={t('sessionStatsTooltip')}
      ariaLabel={t('sessionStatsTooltip')}
      disabled={disabled}
      onClick={openSessionStats}
    />
  )
}

/** 弹窗本体：挂载在 ChatInput 内，与入口按钮解耦 */
export const SessionStatsModalHost = () => {
  const open = useSessionStatsOpen((state) => state.open)
  return open ? <SessionStatsModal onClose={() => useSessionStatsOpen.setState({ open: false })} /> : null
}

const SessionStatsModal = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const freeServerTools = useSettings((state) => state.usageFreeServerTools)
  const [data, setData] = useState<DetailedUsage | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void collectDetailedUsage('7d', freeServerTools)
      .then((result) => {
        if (!cancelled) {
          setData(result)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [freeServerTools])

  const current = data?.currentSession
  const outputs = current?.outputs ?? []
  const latest = outputs.at(-1) ?? 0
  const average = outputs.length
    ? Math.round(outputs.reduce((sum, value) => sum + value, 0) / outputs.length)
    : 0
  const longest = outputs.length ? Math.max(...outputs) : 0
  const weekMax = Math.max(1, ...(current?.last7.map((day) => day.tokens) ?? [1]))
  const composition = (current?.composition ?? []).map((item, index) => ({
    key: item.key,
    label: t(item.key),
    value: item.tokens,
    color: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length],
  }))
  const compositionTotal = composition.reduce((sum, item) => sum + item.value, 0)

  const extras = [
    { label: t('sessionStatsSearch'), value: formatNumber(current?.webSearch ?? 0) },
    { label: t('sessionStatsFetch'), value: formatNumber(current?.pageFetch ?? 0) },
    { label: t('sessionStatsParseFiles'), value: `${current?.files ?? 0} / ${current?.pageFetch ?? 0}` },
    { label: t('sessionStatsTts'), value: formatNumber(data?.totals.ttsChars ?? 0) },
    { label: t('sessionStatsAsr'), value: formatNumber(data?.totals.asrSeconds ?? 0) },
  ]

  return (
    <Modal
      title={t('sessionStatsTitle')}
      closable
      className={styles.dialog}
      mainClassName={styles.modalMain}
      onClose={onClose}
    >
      {failed ? (
        <div className={styles.empty}>{t('usageFailed')}</div>
      ) : !data ? (
        <div className={styles.empty}>{t('usageLoading')}</div>
      ) : (
        <div className={styles.body}>
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('sessionStatsOutputTrend')}</h4>
            {outputs.length === 0 ? (
              <div className={styles.empty}>{t('sessionStatsEmpty')}</div>
            ) : (
              <div className={styles.trendCard}>
                <Sparkline values={outputs} />
                <div className={styles.trendStats}>
                  <div className={styles.trendStat}>
                    <span className={styles.trendValue}>{formatNumber(latest)}</span>
                    <span className={styles.trendLabel}>{t('sessionStatsLatest')}</span>
                  </div>
                  <div className={styles.trendStat}>
                    <span className={styles.trendValue}>{formatNumber(average)}</span>
                    <span className={styles.trendLabel}>{t('sessionStatsAverage')}</span>
                  </div>
                  <div className={styles.trendStat}>
                    <span className={styles.trendValue}>{formatNumber(longest)}</span>
                    <span className={styles.trendLabel}>{t('sessionStatsLongest')}</span>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('sessionStatsLast7')}</h4>
            <div className={styles.weekCard}>
              <div className={styles.weekBars}>
                {(current?.last7 ?? []).map((day) => (
                  <div key={day.date} className={styles.weekColumn} title={`${day.date} · ${formatNumber(day.tokens)}`}>
                    <div
                      className={styles.weekBar}
                      style={{ height: `${Math.max(2, Math.round((day.tokens / weekMax) * 100))}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className={styles.weekLabels}>
                {(current?.last7 ?? []).map((day) => (
                  <span key={day.date}>{shortDate(day.date)}</span>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('sessionStatsComposition')}</h4>
            {compositionTotal === 0 ? (
              <div className={styles.empty}>{t('usageCompositionEmpty')}</div>
            ) : (
              <div className={styles.compositionBox}>
                <DonutChart
                  items={composition}
                  size={96}
                  centerValue={formatNumber(compositionTotal)}
                  centerLabel={t('usageMetricTokens')}
                />
                <DonutLegend items={composition} formatValue={formatNumber} />
              </div>
            )}
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('sessionStatsExtras')}</h4>
            <div className={styles.extras}>
              {extras.map((item) => (
                <div key={item.label} className={styles.extraItem}>
                  <span className={styles.extraValue}>{item.value}</span>
                  <span className={styles.extraLabel}>{item.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('sessionStatsPressure')}</h4>
            <div className={styles.pressureCard}>
              <PressureMeter
                value={data.context.current}
                max={data.context.window - data.context.reserve}
                compressAt={data.context.compressAt}
              />
              <div className={styles.pressureNumbers}>
                <div>
                  <span className={styles.pressureLabel}>{t('sessionStatsRemaining')}</span>
                  <strong>{formatNumber(data.context.remaining)}</strong>
                </div>
                <div>
                  <span className={styles.pressureLabel}>{t('sessionStatsCompressAt')}</span>
                  <strong>{formatNumber(data.context.compressAt)}</strong>
                </div>
              </div>
            </div>
          </section>

          <button
            type="button"
            className={styles.go}
            onClick={() => {
              onClose()
              openSettings('stats')
            }}
          >
            {t('sessionStatsGoSettings')}
          </button>
        </div>
      )}
    </Modal>
  )
}
