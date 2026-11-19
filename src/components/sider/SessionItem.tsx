import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconPinFill16,
  IconTrashOutline16,
} from '../base/icons.js'
import { renameSession, selectSession, setSessionPinned } from '../../services/chat/store.js'
import { exportSessionMarkdown } from '../../services/chat/exportMarkdown.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { showToast } from '../base/toastState.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.scss'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      role="button"
      tabIndex={0}
      aria-label={displayTitle}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
      onKeyDown={(event) => {
        // Enter/Space 打开会话；菜单触发器在子层有自己的按钮，这里只负责主区域
        if (event.key === 'Enter' || (event.key === ' ' && !event.nativeEvent.isComposing)) {
          event.preventDefault()
          selectSession(session.id)
          closeMobileSider()
        }
      }}
    >
      <div className={styles.title}>{displayTitle}</div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu
          options={[
            {
              key: 'pin',
              label: t(session.pinned ? 'unpinSession' : 'pinSession'),
              icon: <IconPinFill16 />,
              onSelect: () => setSessionPinned(session.id, !session.pinned),
            },
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            {
              key: 'export',
              label: t('exportMarkdown'),
              icon: <IconDownloadOutline16 />,
              onSelect: () => {
                void exportSessionMarkdown(session.id).then((ok) => {
                  if (!ok) {
                    showToast({ key: 'exportMarkdownFailed', type: 'error' })
                  }
                })
              },
            },
            {
              key: 'delete',
              label: t('delete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        >
          {({ toggle, ...triggerProps }) => (
            <IconButton
              icon={<IconEllipsisOutline16 />}
              aria-label={t('more')}
              onClick={toggle}
              {...triggerProps}
            />
          )}
        </Menu>
      </div>
    </div>
  )
})
