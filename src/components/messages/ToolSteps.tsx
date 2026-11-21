import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { ToolStep } from '../../services/chat/types.js'
import styles from './ToolSteps.module.scss'

/** 客户端工具调用步骤：默认给出状态、耗时与结果摘要，展开后显示完整入参与结果 */
export const ToolSteps = ({ steps }: { steps?: ToolStep[] }) => {
  const t = useTranslate()
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
            ) : step.result ? (
              <span className={styles.result} title={step.result}>
                {step.result.slice(0, 160)}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
