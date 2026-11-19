import { useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { Button } from '../components/base/Button.js'
import { IconCloseOutline16, IconDownloadOutline16 } from '../components/base/icons.js'
import { installApp, usePwa } from './pwa.js'
import styles from './InstallPrompt.module.scss'

/** 桌面安装提示：浏览器允许应用内安装时出现，关闭后本次会话不再打扰 */
export const InstallPrompt = () => {
  const t = useTranslate()
  const canInstall = usePwa((state) => state.canInstall)
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('dsw-install-dismissed') === '1'
  )
  if (!canInstall || dismissed) {
    return null
  }
  return (
    <div className={styles.card} role="status">
      <span className={styles.icon}>
        <IconDownloadOutline16 />
      </span>
      <div className={styles.text}>
        <div className={styles.title}>{t('pwaInstallTitle')}</div>
        <div className={styles.desc}>{t('pwaInstallDesc')}</div>
      </div>
      <Button
        variant="primary"
        size="s"
        className={styles.confirm}
        onClick={() => void installApp()}
      >
        {t('pwaInstallConfirm')}
      </Button>
      <button
        type="button"
        className={styles.close}
        aria-label={t('close')}
        onClick={() => {
          sessionStorage.setItem('dsw-install-dismissed', '1')
          setDismissed(true)
        }}
      >
        <IconCloseOutline16 />
      </button>
    </div>
  )
}
