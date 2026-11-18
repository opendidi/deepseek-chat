import { useEffect, useRef, useState } from 'react'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { setApiKey } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { useAlive } from '../../utils/useAlive.js'

/** 输入 API Key 后先用 GET /models 校验，通过才保存 */
export const useApiKeyForm = (onSaved?: () => void) => {
  const t = useTranslate()
  const alive = useAlive()
  const controllerRef = useRef<AbortController | null>(null)
  // 弹窗关闭时中止仍在进行的校验，避免请求悬挂与卸载后 setState
  useEffect(() => () => controllerRef.current?.abort(), [])
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || verifying) {
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setVerifying(true)
    setFailure(null)
    try {
      await verifyApiKey(apiKey, controller.signal)
      // 全局设置始终写入；本地表单状态只在组件仍挂载时更新
      setApiKey(apiKey)
      if (alive.current) {
        setValue('')
        onSaved?.()
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted) {
        setFailure({ cause: e })
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
      if (alive.current) {
        setVerifying(false)
      }
    }
  }

  return { value, setValue, verifying, error, submit }
}
