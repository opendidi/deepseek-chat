import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { collectUsageStats, type UsageStats } from '../../services/chat/usageStats.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './Settings.module.scss'

/** 数据管理里的用量统计入口与面板：打开时扫描本地会话汇总 */
export const UsageStatsCell = () => {
  const t = useTranslate()
  const [opened, setOpened] = useState(false)
  return (
    <div className={styles.cell}>
      <div className={styles.row}>
        <div className={styles.text}>
          <div className={styles.label}>{t('usageStats')}</div>
        </div>
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => setOpened(true)}
        >
          {t('view')}
        </Button>
      </div>
      {opened ? <UsageStatsModal onClose={() => setOpened(false)} /> : null}
    </div>
  )
}

const formatNumber = (value: number) => value.toLocaleString()

const UsageStatsModal = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [failed, setFailed] = useState(false)
  // 打开即扫描；不缓存，每次打开都取最新
  useEffect(() => {
    let cancelled = false
    void collectUsageStats()
      .then((result) => {
        if (!cancelled) {
          setStats(result)
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
  }, [])
  const maxDaily = Math.max(1, ...(stats?.daily.map((item) => item.count) ?? [1]))
  return (
    <Modal title={t('usageStats')} className={styles.usageDialog} onClose={onClose}>
      {failed ? (
        <div className={styles.usageEmpty}>{t('usageStatsFailed')}</div>
      ) : stats ? (
        <div className={styles.usageContent}>
          <div className={styles.usageGrid}>
            <div className={styles.usageItem}>
              <div className={styles.usageValue}>{formatNumber(stats.sessions)}</div>
              <div className={styles.usageLabel}>{t('usageStatsSessions')}</div>
            </div>
            <div className={styles.usageItem}>
              <div className={styles.usageValue}>{formatNumber(stats.userMessages)}</div>
              <div className={styles.usageLabel}>{t('usageStatsMessages')}</div>
            </div>
            <div className={styles.usageItem}>
              <div className={styles.usageValue}>{formatNumber(stats.replies)}</div>
              <div className={styles.usageLabel}>{t('usageStatsReplies')}</div>
            </div>
            <div className={styles.usageItem}>
              <div className={styles.usageValue}>{formatNumber(stats.inputTokens)}</div>
              <div className={styles.usageLabel}>{t('usageStatsInputTokens')}</div>
            </div>
            <div className={styles.usageItem}>
              <div className={styles.usageValue}>{formatNumber(stats.outputTokens)}</div>
              <div className={styles.usageLabel}>{t('usageStatsOutputTokens')}</div>
            </div>
          </div>
          <div className={styles.usageDays}>
            <div className={styles.usageLabel}>{t('usageStatsDays')}</div>
            <div className={styles.usageBars}>
              {stats.daily.map((item) => (
                <div key={item.date} className={styles.usageBarColumn}>
                  <div
                    className={styles.usageBar}
                    style={{ height: `${Math.round((item.count / maxDaily) * 100)}%` }}
                    title={t('usageStatsDayTooltip', { date: item.date, count: item.count })}
                  />
                  <div className={styles.usageBarLabel}>{item.date.slice(5)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.usageEmpty}>{t('sessionLoading')}</div>
      )}
    </Modal>
  )
}
