import { useTranslate } from '../../i18n/index.js'
import { copyText } from '../../utils/clipboard.js'
import { formatDate } from '../../utils/format.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { removeFavorite, useFavorites } from '../../services/chat/favorites.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { IconCopyOutline16, IconTrashOutline16 } from '../base/icons.js'
import styles from './FavoritesDialog.module.css'

/** 收藏夹弹窗：列出收藏的回答，可复制、跳回原对话或移除 */
export const FavoritesDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const favorites = useFavorites((state) => state.favorites)
  const sessions = useChatStore((state) => state.sessions)

  const openSource = (sessionId: string) => {
    if (sessions.some((session) => session.id === sessionId)) {
      selectSession(sessionId)
      onClose()
    } else {
      showToast({ key: 'favoriteLoadFailed', type: 'error' })
    }
  }

  const copy = (text: string) => {
    void copyText(text).then((ok) => {
      showToast(ok ? { key: 'copied' } : { key: 'copyFailed', type: 'error' })
    })
  }

  return (
    <Modal title={t('favorites')} className={styles.dialog} onClose={onClose}>
      {favorites.length === 0 ? (
        <div className={styles.empty}>{t('favoritesEmpty')}</div>
      ) : (
        <div className={styles.list}>
          {favorites.map((favorite) => (
            <div key={favorite.id} className={styles.item}>
              <div className={styles.text}>
                <div className={styles.preview}>{favorite.text}</div>
                <div className={styles.date}>{formatDate(favorite.createdAt)}</div>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => openSource(favorite.sessionId)}
                >
                  {t('favoriteOpenSource')}
                </button>
                <button
                  type="button"
                  className={styles.removeAction}
                  aria-label={t('copy')}
                  onClick={() => copy(favorite.text)}
                >
                  <IconCopyOutline16 />
                </button>
                <button
                  type="button"
                  className={styles.removeAction}
                  aria-label={t('delete')}
                  onClick={() => removeFavorite(favorite.id)}
                >
                  <IconTrashOutline16 />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
