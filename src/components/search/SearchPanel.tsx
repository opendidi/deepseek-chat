import { useEffect, useRef } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { focusFirst, trapTabKey } from '../../utils/dialogFocus.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeSearchPanel, useSearchPanel } from './searchPanelState.js'
import { SourceCard } from './SourceCard.js'
import styles from './SearchPanel.module.scss'

/** 右侧「搜索结果」面板；窄屏下全屏接管，按 dialog 处理焦点与 Esc */
export const SearchPanel = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const entry = useSearchPanel((state) => state.entry)
  const sources = useSearchPanel((state) => state.sources)
  const panelRef = useRef<HTMLElement>(null)
  const modal = isMobile && Boolean(entry)

  useEffect(() => {
    if (!modal) {
      return
    }
    const restore = document.activeElement as HTMLElement | null
    focusFirst(panelRef.current)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        closeSearchPanel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (restore && document.contains(restore)) {
        restore.focus()
      }
    }
  }, [modal])

  if (!entry) {
    return null
  }
  return (
    <aside
      ref={panelRef}
      className={styles.panel}
      role={modal ? 'dialog' : undefined}
      aria-modal={modal ? true : undefined}
      aria-label={modal ? t('searchResult') : undefined}
      tabIndex={modal ? -1 : undefined}
      onKeyDown={modal ? (event) => trapTabKey(event, panelRef.current) : undefined}
    >
      <div className={styles.header}>
        <div role="heading" className={styles.title}>
          {t('searchResult')}
        </div>
        <IconButton
          icon={<IconCloseOutline16 />}
          aria-label={t('close')}
          onClick={closeSearchPanel}
        />
      </div>
      <div className={styles.content}>
        {sources.map((source) => (
          <SourceCard key={source.url} source={source} className={styles.item} />
        ))}
      </div>
    </aside>
  )
}
