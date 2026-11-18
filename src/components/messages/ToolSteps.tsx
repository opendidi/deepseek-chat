import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import type { ToolStep } from '../../services/chat/types.js'
import styles from './ToolSteps.module.scss'

/** 客户端工具调用步骤：流式期间显示执行中，完成后给出结果摘要 */
export const ToolSteps = ({ steps }: { steps?: ToolStep[] }) => {
  const t = useTranslate()
  if (!steps?.length) {
    return null
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>{t('agentToolSteps')}</div>
      {steps.map((step) => (
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
          {step.result ? (
            <span className={styles.result} title={step.result}>
              {step.result.slice(0, 160)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}
