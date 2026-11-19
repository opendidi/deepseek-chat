import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconPanelLeftOutline16,
  IconSettingsOutline16,
  IconStarOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { useAlive } from '../../utils/useAlive.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { FavoritesDialog } from './FavoritesDialog.js'
import { useSessionSearch } from './useSessionSearch.js'
import { useSiderSearchFocus } from './siderSearchState.js'
import styles from './Sider.module.scss'

/** 展开的侧边栏：名称与收起按钮、开启新对话、会话搜索与按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const alive = useAlive()
  const [query, setQuery] = useState('')
  const search = useSessionSearch(query)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searching = query.trim() !== ''
  const [favoritesOpen, setFavoritesOpen] = useState(false)

  // Ctrl+K 的聚焦请求：挂载时若请求刚发生（先展开侧边栏的场景）立即聚焦，之后随新请求聚焦
  useEffect(() => {
    const focusIfRequested = () => {
      const { at } = useSiderSearchFocus.getState()
      if (at && Date.now() - at < 1000) {
        searchInputRef.current?.focus()
      }
    }
    focusIfRequested()
    return useSiderSearchFocus.subscribe(focusIfRequested)
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <div className={styles.searchWrap}>
        <input
          ref={searchInputRef}
          className={styles.searchInput}
          type="text"
          aria-label={t('searchSessions')}
          placeholder={t('searchSessionsPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.stopPropagation()
              setQuery('')
            }
          }}
        />
      </div>
      {searching ? (
        <div className={styles.listWrap}>
          <div className={styles.list}>
            {search.results && search.results.length > 0 ? (
              <>
                <div className={styles.searchEmpty}>
                  {t('searchSessionsCount', { count: search.results.length })}
                </div>
                {search.results.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    onDelete={() => setDeleting(session)}
                  />
                ))}
              </>
            ) : search.scanning ? null : (
              <div className={styles.searchEmpty}>{t('searchSessionsNoResult')}</div>
            )}
            {search.scanning ? (
              <div className={styles.searchEmpty}>{t('searchSessionsScanning')}</div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={styles.listWrap}>
          <div className={styles.list}>
            {groups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={session.id === activeId}
                    onDelete={() => setDeleting(session)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => setFavoritesOpen(true)}>
          <span className={styles.settingsIcon}>
            <IconStarOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('favorites')}</span>
        </button>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {favoritesOpen ? <FavoritesDialog onClose={() => setFavoritesOpen(false)} /> : null}
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      if (alive.current) {
                        setDeleting(null)
                      }
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    if (alive.current) {
                      setDeletePending(false)
                    }
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域或 Esc 关闭。 */
export const MobileSider = () => {
  const t = useTranslate()
  const open = useMobileSider((state) => state.open)
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        closeMobileSider()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label={t('appName')}>
        <Sider mobile />
      </div>
    </>
  )
}
