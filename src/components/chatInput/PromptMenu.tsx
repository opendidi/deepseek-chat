import clsx from 'clsx'
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconNotebookOutline16 } from '../base/icons.js'
import type { PromptTemplate } from '../../services/prompts.js'
import styles from './PromptMenu.module.scss'

type Position = {
  left: number
  width: number
  /** 以视口底部坐标锚定，菜单向上生长 */
  bottom: number
  maxHeight: number
}

/**
 * 输入框斜杠菜单：草稿以 / 开头时浮出，选择提示词整段填入输入框。
 * 输入卡片是圆角 + overflow hidden 的容器，内部绝对定位会被裁剪，
 * 因此挂在 body 上，用输入框包裹元素的位置做固定定位。
 */
export const PromptMenu = ({
  anchor,
  matches,
  activeIndex,
  onSelect,
  onManage,
}: {
  /** 输入框包裹元素（textareaWrapper），菜单贴其上沿展开 */
  anchor: HTMLElement | null
  matches: PromptTemplate[]
  activeIndex: number
  onSelect: (prompt: PromptTemplate) => void
  onManage: () => void
}) => {
  const t = useTranslate()
  const [position, setPosition] = useState<Position | null>(null)

  // 打开期间跟随输入框位置（窗口缩放与滚动）；输入框出现键盘等布局变化时由重渲染带来新的 rect
  useLayoutEffect(() => {
    if (!anchor) {
      return
    }
    const update = () => {
      const rect = anchor.getBoundingClientRect()
      const spaceAbove = Math.max(0, rect.top - 12)
      setPosition({
        left: rect.left + 10,
        width: rect.width - 20,
        bottom: window.innerHeight - rect.top + 8,
        maxHeight: Math.min(320, Math.max(120, spaceAbove)),
      })
    }
    update()
    window.addEventListener('resize', update, { passive: true })
    window.addEventListener('scroll', update, { capture: true, passive: true })
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, { capture: true })
    }
  }, [anchor])

  if (!position) {
    return null
  }
  return createPortal(
    <div
      className={styles.menu}
      style={{
        left: position.left,
        width: position.width,
        bottom: position.bottom,
        maxHeight: position.maxHeight,
      }}
      role="listbox"
      aria-label={t('promptLibrary')}
    >
      <div className={styles.hint}>{t('promptSlashHint')}</div>
      <div className={styles.items}>
        {matches.length === 0 ? (
          <div className={styles.empty}>{t('promptEmpty')}</div>
        ) : (
          matches.map((prompt, index) => (
            <button
              key={prompt.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={clsx(styles.item, index === activeIndex && styles.active)}
              onMouseDown={(event) => {
                // mousedown 选择，避免 textarea 失焦导致菜单先收起
                event.preventDefault()
                onSelect(prompt)
              }}
            >
              <span className={styles.title}>{prompt.title}</span>
              <span className={styles.preview}>{prompt.content}</span>
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        className={styles.manage}
        onMouseDown={(event) => {
          event.preventDefault()
          onManage()
        }}
      >
        <IconNotebookOutline16 />
        {t('promptLibrary')}
      </button>
    </div>,
    document.body
  )
}
