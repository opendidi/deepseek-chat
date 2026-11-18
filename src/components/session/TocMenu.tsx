import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconListOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './TocMenu.module.scss'

/** 滚动到指定消息：MessageList 自身的滚动状态会随 scroll 事件同步 */
const scrollToMessage = (id: string) => {
  const target = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
  target?.scrollIntoView({ block: 'start' })
}

/**
 * 对话内目录：标题栏按钮，浮层列出当前路径上的全部提问，点击滚动到对应消息。
 * 仅桌面端展示；移动端顶栏空间有限，先不放。
 */
export const TocMenu = ({ questions }: { questions: { id: string; text: string }[] }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { align: 'end', maxHeight: 320, minSpace: 120 })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false))
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.trigger}
        aria-label={t('tocLabel')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconListOutline16 />
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="menu"
            >
              {questions.map((question) => (
                <button
                  key={question.id}
                  type="button"
                  role="menuitem"
                  className={styles.option}
                  onClick={() => {
                    setOpen(false)
                    scrollToMessage(question.id)
                  }}
                >
                  {question.text}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
