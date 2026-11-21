import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCloseOutline16,
  IconListOutline16,
  IconPanelLeftOutline16,
  IconPinFill16,
  IconSettingsOutline16,
  IconStarOutline16,
  IconTrashOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import {
  newChat,
  removeSession,
  setSessionPinned,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { Tooltip } from '../base/Tooltip.js'
import { useAlive } from '../../utils/useAlive.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { focusFirst, trapTabKey } from '../../utils/dialogFocus.js'
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
  /** 待删除的会话：单删放一个，多选批量放多个 */
  const [deleting, setDeleting] = useState<SessionSummary[]>([])
  const [deletePending, setDeletePending] = useState(false)
  /** 多选模式与勾选集合；退出时一并清空 */
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
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

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  /** 选中的会话全部已置顶时改为取消置顶，否则统一置顶 */
  const pinSelected = () => {
    const targets = sessions.filter((session) => selected.has(session.id))
    if (targets.length === 0) {
      return
    }
    const allPinned = targets.every((session) => session.pinned)
    for (const session of targets) {
      setSessionPinned(session.id, !allPinned)
    }
    showToast({
      key: allPinned ? 'sessionsUnpinned' : 'sessionsPinned',
      params: { count: targets.length },
    })
    exitSelectMode()
  }

  const renderItem = (session: SessionSummary) => (
    <SessionItem
      key={session.id}
      session={session}
      active={session.id === activeId}
      onDelete={() => setDeleting([session])}
      selectMode={selectMode}
      selected={selected.has(session.id)}
      onToggleSelect={() => toggleSelected(session.id)}
      jumpTo={searching ? search.matchBySession.get(session.id) : undefined}
    />
  )

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
          exitSelectMode()
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
      <div className={styles.listWrap}>
        {selectMode ? (
          <div className={styles.selectionHeader}>
            <span>{t('selectSessions')}</span>
            <IconButton
              icon={<IconCloseOutline16 />}
              tooltip={t('close')}
              ariaLabel={t('close')}
              onClick={exitSelectMode}
            />
          </div>
        ) : sessions.length > 0 ? (
          <Tooltip content={t('multiSelect')} placement="bottom">
            <button
              type="button"
              className={styles.selectToggle}
              aria-label={t('multiSelect')}
              onClick={() => setSelectMode(true)}
            >
              <IconListOutline16 />
            </button>
          </Tooltip>
        ) : null}
        <div className={clsx(styles.list, selectMode && styles.listWithHeader)}>
          {searching ? (
            <>
              {search.results && search.results.length > 0 ? (
                <>
                  <div className={styles.searchEmpty}>
                    {t('searchSessionsCount', { count: search.results.length })}
                  </div>
                  {search.results.map(renderItem)}
                </>
              ) : search.scanning ? null : (
                <div className={styles.searchEmpty}>{t('searchSessionsNoResult')}</div>
              )}
              {search.scanning ? (
                <div className={styles.searchEmpty}>{t('searchSessionsScanning')}</div>
              ) : null}
            </>
          ) : (
            groups.map((group) => (
              <div key={group.key} className={styles.section}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.sessions.map(renderItem)}
              </div>
            ))
          )}
        </div>
      </div>
      {selectMode ? (
        <div className={styles.selectionActions}>
          <button
            type="button"
            className={styles.selectionAction}
            disabled={selected.size === 0}
            onClick={pinSelected}
          >
            <IconPinFill16 />
            <span>{t('pinSession')}</span>
          </button>
          <span className={styles.selectionDivider} />
          <button
            type="button"
            className={clsx(styles.selectionAction, styles.selectionDanger)}
            disabled={selected.size === 0}
            onClick={() => setDeleting(sessions.filter((session) => selected.has(session.id)))}
          >
            <IconTrashOutline16 />
            <span>{t('delete')}</span>
          </button>
        </div>
      ) : (
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
      )}
      {favoritesOpen ? <FavoritesDialog onClose={() => setFavoritesOpen(false)} /> : null}
      {deleting.length > 0 ? (
        <Modal
          title={t(
            deleting.length > 1 ? 'deleteSessionsModalTitle' : 'deleteSessionModalContentTitle'
          )}
          onClose={() => {
            if (!deletePending) {
              setDeleting([])
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting([])}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    let deleted = 0
                    for (const session of deleting) {
                      if (await removeSession(session.id)) {
                        deleted += 1
                      }
                    }
                    if (alive.current) {
                      setDeleting([])
                      if (selectMode) {
                        exitSelectMode()
                      }
                    }
                    if (deleted < deleting.length) {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    } else if (deleting.length > 1) {
                      showToast({ key: 'sessionsDeleted', params: { count: deleted } })
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
          {deleting.length > 1
            ? t('deleteSessionsDescription', { count: deleting.length })
            : t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域或 Esc 关闭。 */
export const MobileSider = () => {
  const t = useTranslate()
  const open = useMobileSider((state) => state.open)
  const drawerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) {
      return
    }
    // 抽屉以 dialog 呈现，焦点必须留在抽屉内；关闭后归还给触发元素
    const restore = document.activeElement as HTMLElement | null
    focusFirst(drawerRef.current)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        closeMobileSider()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (restore && document.contains(restore)) {
        restore.focus()
      }
    }
  }, [open])
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={t('appName')}
        tabIndex={-1}
        onKeyDown={(event) => trapTabKey(event, drawerRef.current)}
      >
        <Sider mobile />
      </div>
    </>
  )
}
