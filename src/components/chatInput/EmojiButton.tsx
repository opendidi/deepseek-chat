import clsx from 'clsx'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconButton } from '../base/IconButton.js'
import { IconSmileOutline16 } from '../base/icons.js'
import styles from './EmojiButton.module.css'

/**
 * 表情数据 + Picker 约 550K（其中 emoji 数据 424K），首次点击现场下载在慢网下要等近 3 秒。
 * 这里让预取与 React.lazy 共用同一个 Promise：空闲或悬停时提前加载，点击时若已就绪就零等待；
 * 加载失败清掉缓存，下次点击还能重试。
 */
const loadPickerModule = () =>
  import('./EmojiPickerPanel.js').then((module) => ({ default: module.EmojiPickerPanel }))

let pickerPromise: ReturnType<typeof loadPickerModule> | undefined

const loadPicker = () => {
  if (!pickerPromise) {
    pickerPromise = loadPickerModule().catch((error: unknown) => {
      pickerPromise = undefined
      throw error
    })
  }
  return pickerPromise
}

const preloadPicker = () => {
  void loadPicker()
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

const EmojiPickerPanel = lazy(loadPicker)

/**
 * emoji-mart 把过渡时长写在 shadow DOM 内的 #root 上（--duration: 225ms 等），
 * 外部 CSS 覆盖不到；打开时把这段样式注入 shadowRoot，去掉导航条滑动、搜索框和按钮的淡入。
 */
const NO_MOTION_CSS = `
  #root {
    --duration: 0ms;
    --duration-fast: 0ms;
    --duration-instant: 0ms;
  }
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
`

/** 移动端面板取视觉视口的一小半，接近系统键盘高度，避免盖住大半屏消息 */
const getSheetHeight = () => {
  const visible = window.visualViewport?.height ?? window.innerHeight
  // 横屏时高度很小，必须给页面留出放输入框与底部提示的空间（约 170px）
  const room = Math.max(160, visible - 170)
  return Math.min(360, room, Math.max(180, Math.round(visible * 0.46)))
}

/**
 * 输入框工具栏里的表情入口。
 * 桌面端在按钮上方开锚定浮层；移动端改为底部面板，并把页面框架一起顶高，
 * 让它占据键盘的位置而不遮住输入框。点外部、点输入框或按 Esc 关闭。
 */
export const EmojiButton = ({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean
  onSelect: (emoji: string) => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  // 首屏空闲时把表情 chunk 拉下来，悬停/键盘聚焦再兜一次（幂等，不会重复下载）
  useEffect(() => {
    const idleWindow = window as IdleWindow
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(preloadPicker, { timeout: 2000 })
      return () => {
        idleWindow.cancelIdleCallback?.(id)
      }
    }
    const id = window.setTimeout(preloadPicker, 1500)
    return () => {
      window.clearTimeout(id)
    }
  }, [])

  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    // 移动端由 CSS 固定到底部，不需要按锚点测量
    open && !isMobile,
    // Picker 默认 435px 高，两侧空间都不足时按可用高度收缩，避免顶部被视口裁掉。
    // contentHeight 固定内容期望高度，避免 scrollHeight 跟随 inline 高度造成逐帧「展开」。
    { side: 'top', align: 'end', offset: 8, maxHeight: 435, contentHeight: 435, minSpace: 200 }
  )
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false))

  /**
   * 移动端面板和键盘互斥：打开时收起软键盘，并把面板高度同步给页面框架
   * （App.module.css 的 .frame 用它缩短自身，输入框随之抬到面板上方）。
   */
  useLayoutEffect(() => {
    if (!open || !isMobile) {
      return
    }
    const apply = () => {
      document.documentElement.style.setProperty('--emoji-panel-height', `${getSheetHeight()}px`)
    }
    apply()
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', apply)
    window.addEventListener('resize', apply)
    return () => {
      viewport?.removeEventListener('resize', apply)
      window.removeEventListener('resize', apply)
      document.documentElement.style.removeProperty('--emoji-panel-height')
    }
  }, [open, isMobile])

  useEffect(() => {
    if (!open || !isMobile) {
      return
    }
    const active = document.activeElement
    if (active instanceof HTMLElement && active.matches('textarea, input:not([type="file"])')) {
      active.blur()
    }
  }, [open, isMobile])

  // 面板一出现就关掉 emoji-mart 自带的过渡，不等动画跑完
  useEffect(() => {
    if (!open) {
      return
    }
    let frame = 0
    let attempts = 0
    const disableMotion = () => {
      const root = floatingRef.current?.querySelector('em-emoji-picker')?.shadowRoot
      if (root) {
        if (!root.querySelector('style[data-no-motion]')) {
          const style = document.createElement('style')
          style.setAttribute('data-no-motion', '')
          style.textContent = NO_MOTION_CSS
          root.appendChild(style)
        }
        return
      }
      // Picker 是懒加载的自定义元素，shadowRoot 可能晚几帧才挂上
      if (attempts < 30) {
        attempts += 1
        frame = requestAnimationFrame(disableMotion)
      }
    }
    disableMotion()
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [floatingRef, open])

  // 稳定的回调避免输入框文字变化时让 Picker 重新初始化、丢掉搜索词。
  // 移动端面板占据键盘位置、不遮挡输入框，选完保持打开以便连续挑选。
  const handleSelect = useCallback((emoji: string) => onSelect(emoji), [onSelect])

  return (
    <>
      <span
        ref={anchorRef}
        className={styles.anchor}
        onPointerEnter={preloadPicker}
        onFocus={preloadPicker}
      >
        <IconButton
          size="m"
          tone="primary"
          icon={<IconSmileOutline16 />}
          tooltip={t('emoji')}
          aria-pressed={open}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
        />
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={clsx(styles.panel, isMobile && styles.mobilePanel)}
              role="dialog"
              aria-label={t('emoji')}
              style={
                !isMobile && position
                  ? { top: position.top, right: position.right, height: position.maxHeight }
                  : undefined
              }
            >
              <Suspense fallback={<div className={styles.loading}>{t('emojiLoading')}</div>}>
                <EmojiPickerPanel onSelect={handleSelect} />
              </Suspense>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
