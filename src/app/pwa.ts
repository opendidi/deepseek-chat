import { create } from 'zustand'
import { showToast } from '../components/base/toastState.js'

/** 浏览器安装事件；仅在支持安装的安全上下文出现 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type PwaState = {
  /** 浏览器允许应用内安装（beforeinstallprompt 已捕获且未处理） */
  canInstall: boolean
}

export const usePwa = create<PwaState>(() => ({ canInstall: false }))

let deferredPrompt: BeforeInstallPromptEvent | null = null

/** 应用内安装入口；浏览器事件未就绪时返回 false（如 iOS Safari） */
export const installApp = async (): Promise<boolean> => {
  if (!deferredPrompt) {
    return false
  }
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  if (choice.outcome === 'accepted') {
    deferredPrompt = null
    usePwa.setState({ canInstall: false })
  }
  return true
}

/** 注册 PWA 相关事件：安装入口与「新版本已就绪」提示；SSR/测试环境不执行 */
export const bindPwa = () => {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    usePwa.setState({ canInstall: true })
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    usePwa.setState({ canInstall: false })
  })
  // 更新后的 Service Worker 接管页面时提示刷新生效；
  // 首次安装从「无控制器」变为「有控制器」，不属于更新
  if ('serviceWorker' in navigator) {
    let hadController = navigator.serviceWorker.controller !== null
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) {
        showToast({ key: 'pwaUpdated' })
      }
      hadController = true
    })
  }
}
