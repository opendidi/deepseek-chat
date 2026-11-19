import { useSyncExternalStore } from 'react'

/** 网络连接状态订阅；断网时界面给出提示 */
export const useOnline = (): boolean =>
  useSyncExternalStore(
    (onChange) => {
      window.addEventListener('online', onChange)
      window.addEventListener('offline', onChange)
      return () => {
        window.removeEventListener('online', onChange)
        window.removeEventListener('offline', onChange)
      }
    },
    () => navigator.onLine,
    () => true
  )
