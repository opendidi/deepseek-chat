import { lazy, Suspense, useEffect } from 'react'
import { useTranslate } from '../i18n/index.js'
import { syncAmapToolAvailability, setSiderCollapsed, useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  bindHashSync,
  initChat,
  newChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { initFavorites } from '../services/chat/favorites.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { PromptLibrary } from '../components/chatInput/PromptLibrary.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { openSettings } from '../components/settings/settingsDialogState.js'

// 设置弹窗整块懒加载：主包只保留打开状态（settingsDialogState），首次打开设置时才拉取代码
const SettingsDialog = lazy(() =>
  import('../components/settings/SettingsDialog.js').then((module) => ({
    default: module.SettingsDialog,
  }))
)
import { Lightbox } from '../components/base/Lightbox.js'
import { Toast } from '../components/base/Toast.js'
import { SelectionMenu } from '../components/messages/SelectionMenu.js'
import { ErrorBoundary } from '../components/base/ErrorBoundary.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider, openMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { requestSiderSearchFocus } from '../components/sider/siderSearchState.js'
import { bindPwa } from './pwa.js'
import { InstallPrompt } from './InstallPrompt.js'
import { AccessGate } from './AccessGate.js'
import { useOnline } from './useOnline.js'
import styles from './App.module.scss'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const online = useOnline()
  const locale = useSettings((state) => state.locale)
  const fontSize = useSettings((state) => state.fontSize)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 界面字号档位写进 body 属性，由 theme.scss 的变量覆盖基准字号
  useEffect(() => {
    const body = document.body
    if (fontSize === 'm') {
      delete body.dataset.dsFontSize
    } else {
      body.dataset.dsFontSize = fontSize
    }
  }, [fontSize])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])
  // 地址栏 hash 与 activeId 双向同步（从 sessionLifecycle 的模块级副作用显式化）
  useEffect(bindHashSync, [])
  // 服务器配置了高德 Key 时自动启用地图工具（按启动时健康检查同步一次）
  useEffect(() => {
    void fetch('/api/health')
      .then((response) => response.json() as Promise<{ amap?: boolean }>)
      .then((data) => {
        syncAmapToolAvailability(data.amap === true)
      })
      .catch(() => {})
  }, [])

  // 全局快捷键：Ctrl/Cmd+K 搜索会话、Ctrl/Cmd+Shift+O 新建对话、Ctrl/Cmd+, 打开设置
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod || event.altKey) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'k' && !event.shiftKey) {
        event.preventDefault()
        // 先展开侧边栏 / 打开移动端抽屉，Sider 挂载后按时间戳自动聚焦搜索框
        requestSiderSearchFocus()
        if (isMobile) {
          openMobileSider()
        } else {
          setSiderCollapsed(false)
        }
      } else if (key === 'o' && event.shiftKey) {
        event.preventDefault()
        newChat()
        closeMobileSider()
      } else if (event.key === ',') {
        event.preventDefault()
        openSettings('general')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
    void initFavorites()
    // 安装入口与新版本提示（仅生产构建注册 SW 的环境有意义）
    bindPwa()
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {!online ? (
            <div className={styles.saveError} role="status">
              <span>{t('offlineNotice')}</span>
            </div>
          ) : null}
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <ErrorBoundary>
                <SessionView
                  session={session}
                  streaming={streaming}
                  siderCollapsed={siderCollapsed}
                />
              </ErrorBoundary>
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <Suspense fallback={null}>
        <SettingsDialog />
      </Suspense>
      <Lightbox />
      <PromptLibrary />
      <SelectionMenu />
      <InstallPrompt />
      <AccessGate />
      <Toast />
    </>
  )
}
