import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../../app/viewport.js'
import { useAnchoredPosition, useDelayedOpen } from './anchored.js'
import styles from './Tooltip.module.scss'

export type TooltipPlacement = 'top' | 'bottom'

const ENTER_DELAY = 100

/**
 * 悬停 100ms 后出现，离开立即消失，移动端不显示。
 * 触发元素外包一层 display: contents，不影响布局。
 */
export const Tooltip = ({
  content,
  placement = 'top',
  children,
}: {
  content: ReactNode
  placement?: TooltipPlacement
  children: ReactNode
}) => {
  const isMobile = useIsMobile()
  const { open, setOpen, schedule, cancel } = useDelayedOpen()
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { side: placement, align: 'center', measureFirstChild: true, measureKey: content }
  )

  useEffect(() => () => cancel(), [cancel])

  // 滚动时收起提示。
  useEffect(() => {
    if (!open) {
      return
    }
    const onScroll = () => setOpen(false)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open, setOpen])

  const visible = open && !isMobile && Boolean(content)
  const tooltipId = useId()

  return (
    <>
      <span
        ref={anchorRef}
        className={styles.trigger}
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={() => schedule(true, ENTER_DELAY)}
        onMouseLeave={() => schedule(false, 0)}
        onFocus={() => schedule(true, ENTER_DELAY)}
        onBlur={() => schedule(false, 0)}
      >
        {children}
      </span>
      {visible
        ? createPortal(
            <div
              ref={floatingRef}
              id={tooltipId}
              role="tooltip"
              className={styles.tooltip}
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
            >
              {content}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
