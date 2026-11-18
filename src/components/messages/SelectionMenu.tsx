import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { addDraftQuote } from '../../services/chat/drafts.js'
import { useChatStore } from '../../services/chat/store.js'
import { copyText } from '../../utils/clipboard.js'
import { clampMenuPosition } from '../../utils/selectionMenu.js'
import { IconCopyOutline16, IconQuoteOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './SelectionMenu.module.scss'

type MenuState = { x: number; y: number; text: string }

/** 选中聊天消息里的文字后右键，弹出「引用 / 复制」浮层 */
export const SelectionMenu = () => {
  const t = useTranslate()
  const activeId = useChatStore((state) => state.activeId)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      // 输入框、可编辑区域保留浏览器原生右键菜单
      if (target?.closest('input, textarea, [contenteditable="true"]')) {
        return
      }
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (!text || selection?.isCollapsed) {
        return
      }
      const node = selection?.anchorNode
      const element = node instanceof Element ? node : node?.parentElement
      // 只在聊天消息区域内选中文字时弹出，侧边栏等位置不拦截
      if (!element?.closest('[data-message-id]')) {
        return
      }
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, text })
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])

  useEffect(() => {
    if (!menu) {
      return
    }
    const close = () => setMenu(null)
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        close()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', close, { capture: true, passive: true })
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  if (!menu) {
    return null
  }
  const { left, top } = clampMenuPosition(
    menu.x,
    menu.y,
    window.innerWidth,
    window.innerHeight
  )
  return createPortal(
    <div ref={menuRef} className={styles.menu} style={{ left, top }} role="menu">
      <button
        type="button"
        className={styles.option}
        role="menuitem"
        onClick={() => {
          if (!addDraftQuote(activeId, menu.text)) {
            showToast({ key: 'quoteFailed' })
          }
          setMenu(null)
        }}
      >
        <IconQuoteOutline16 />
        {t('quote')}
      </button>
      <span className={styles.divider} />
      <button
        type="button"
        className={styles.option}
        role="menuitem"
        onClick={() => {
          void copyText(menu.text).then((ok) => {
            if (!ok) {
              showToast({ key: 'copyFailed' })
            }
          })
          setMenu(null)
        }}
      >
        <IconCopyOutline16 />
        {t('copy')}
      </button>
    </div>,
    document.body
  )
}
