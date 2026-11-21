import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { BackupError } from '../../services/chat/backup.js'
import styles from './Settings.module.scss'

/** 设置项底部的一行状态/说明文案 */
export type Status =
  | (TranslationMessage & { error?: boolean; reason?: TranslationKey })
  | null

export const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

/** 通用设置行：左侧标题、右侧操作控件，下方整行放说明或状态 */
export const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
      </div>
      {action}
      {/* 说明/状态另起一行铺满，作为提示文字 */}
      {status || description ? (
        <div className={clsx(styles.description, status?.error && styles.error)}>
          {status
            ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
            : description}
        </div>
      ) : null}
    </div>
  )
}

/** 布尔开关设置行 */
export const SettingSwitch = ({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
}) => (
  <SettingCell
    label={label}
    description={description}
    status={null}
    action={
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={clsx(styles.switch, checked && styles.switchOn)}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.switchThumb} />
      </button>
    }
  />
)
