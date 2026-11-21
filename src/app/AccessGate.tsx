import { useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { initChat } from '../services/chat/store.js'
import { initFavorites } from '../services/chat/favorites.js'
import { getAccessKey, setAccessKey, useAccessKey } from '../services/chat/accessKey.js'
import { Button } from '../components/base/Button.js'
import { Modal } from '../components/base/Modal.js'
import styles from './AccessGate.module.scss'

/** 服务端开启访问口令（ACCESS_PASSWORD）时弹出：口令验证通过后重新拉取数据 */
export const AccessGate = () => {
  const t = useTranslate()
  const unauthorized = useAccessKey((state) => state.unauthorized)
  const [value, setValue] = useState(getAccessKey())
  const [verifying, setVerifying] = useState(false)
  const [invalid, setInvalid] = useState(false)

  if (!unauthorized) {
    return null
  }

  const submit = async () => {
    const key = value.trim()
    if (!key || verifying) {
      return
    }
    setVerifying(true)
    setInvalid(false)
    try {
      const response = await fetch('/api/auth/verify', { headers: { 'x-access-key': key } })
      if (!response.ok) {
        setInvalid(true)
        return
      }
      setAccessKey(key)
      // 口令通过后重新拉取：首次加载失败与中途失效两种场景都覆盖
      void initChat()
      void initFavorites()
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Modal title={t('accessGateTitle')} className={styles.gate} onClose={() => {}}>
      <div className={styles.body}>
        <input
          type="password"
          className={styles.input}
          placeholder={t('accessGatePlaceholder')}
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setInvalid(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              void submit()
            }
          }}
        />
        {invalid ? <div className={styles.invalid}>{t('accessGateInvalid')}</div> : null}
        <Button variant="primary" disabled={verifying || !value.trim()} onClick={() => void submit()}>
          {verifying ? t('apiKeyVerifying') : t('confirm')}
        </Button>
      </div>
    </Modal>
  )
}
