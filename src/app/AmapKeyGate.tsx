import { useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { setAmapKey } from '../services/settings.js'
import { cancelAmapKey, resolveAmapKeyGate, useAmapKeyGate } from '../services/agent/amapKeyGate.js'
import { Button } from '../components/base/Button.js'
import { Modal } from '../components/base/Modal.js'
import styles from './AccessGate.module.scss'

/**
 * Agent 地图工具的按需输入门：模型调用高德工具且未配置 Key 时弹出，
 * 保存后本轮工具自动继续执行；取消则该轮地图步骤以引导错误结束。
 */
export const AmapKeyGate = () => {
  const t = useTranslate()
  const open = useAmapKeyGate((state) => state.open)
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)

  if (!open) {
    return null
  }

  const submit = () => {
    const key = value.trim()
    if (!key || verifying) {
      return
    }
    setVerifying(true)
    try {
      setAmapKey(key)
      resolveAmapKeyGate(key)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Modal title={t('amapGateTitle')} className={styles.gate} onClose={() => cancelAmapKey()}>
      <div className={styles.body}>
        <div className={styles.gateHint}>{t('settingsAmapKeyDesc')}</div>
        <input
          type="text"
          className={styles.input}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('settingsAmapKey')}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              submit()
            }
          }}
        />
        <div className={styles.gateActions}>
          <Button variant="outlined" onClick={() => cancelAmapKey()}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={verifying || !value.trim()} onClick={() => submit()}>
            {t('amapGateSubmit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
