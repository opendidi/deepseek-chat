import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

/** 窄于 768px 按移动端布局 */
const query = window.matchMedia('not all and (min-width: 768px)')

const subscribe = (onChange: () => void) => {
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const useIsMobile = () => useSyncExternalStore(subscribe, () => query.matches)

/** 一次触摸里是否允许原生滚动；只在 touchstart 计算，避免每帧读计算样式造成 layout thrashing */
let scrollAllowed = false
let trackingTouch = false

const onTouchStart = (event: TouchEvent) => {
  if (event.touches.length !== 1) {
    // 双指缩放交给浏览器
    scrollAllowed = true
    trackingTouch = false
    return
  }
  trackingTouch = true
  scrollAllowed = false
  // composedPath 会穿过 shadow DOM，否则表情面板这类自定义元素内部的滚动
  // 会因为事件重定向到宿主元素而被误判成整页滚动、直接 preventDefault。
  for (const entry of event.composedPath()) {
    if (!(entry instanceof Element)) {
      continue
    }
    if (entry === document.body || entry === document.documentElement) {
      break
    }
    const style = getComputedStyle(entry)
    const scrollsY = /auto|scroll/.test(style.overflowY) && entry.scrollHeight > entry.clientHeight
    const scrollsX = /auto|scroll/.test(style.overflowX) && entry.scrollWidth > entry.clientWidth
    if (scrollsY || scrollsX) {
      scrollAllowed = true
      break
    }
  }
}

const onTouchMove = (event: TouchEvent) => {
  if (event.touches.length !== 1) {
    return
  }
  if (trackingTouch && !scrollAllowed) {
    event.preventDefault()
  }
}

const endTouch = () => {
  trackingTouch = false
  scrollAllowed = false
}

/** 阻止移动端整页滚动，保留内部可滚动区域的滚动和双指缩放。 */
export const usePreventPageScroll = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', endTouch)
    document.addEventListener('touchcancel', endTouch)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', endTouch)
      document.removeEventListener('touchcancel', endTouch)
      endTouch()
    }
  }, [enabled])
}

/** 移动端页面跟随视觉视口，键盘弹出后顶栏和输入框仍留在可见区域。 */
export const useMobileViewport = (enabled: boolean) => {
  const frameRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!enabled || !frame) {
      return
    }
    const viewport = window.visualViewport
    const inputSelector = 'textarea, input:not([type="file"])'
    let animationFrame = 0
    const reset = () => {
      frame.style.removeProperty('--app-viewport-height')
      frame.style.removeProperty('--app-viewport-top')
    }
    const update = () => {
      // 双指缩放由浏览器处理，保持当前布局尺寸。
      if (viewport && viewport.scale !== 1) {
        return
      }
      // 失焦后直接恢复 CSS 的全高布局，不等 Safari 收键盘后的 resize。
      if (!document.activeElement?.matches(inputSelector)) {
        reset()
        return
      }
      frame.style.setProperty(
        '--app-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`
      )
      frame.style.setProperty('--app-viewport-top', `${viewport?.offsetTop ?? 0}px`)
    }
    const scheduleFrame = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(update)
    }
    const schedule = () => {
      // 先同步跟上键盘动画，下一帧再校准 Safari 延迟更新的视口读数。
      update()
      scheduleFrame()
    }
    const onFocusIn = () => {
      if (document.activeElement?.matches(inputSelector)) {
        schedule()
      }
    }

    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', onFocusIn)
    // 等点击和焦点切换完成，避免按钮移动、或切换输入框时短暂恢复全高。
    document.addEventListener('focusout', scheduleFrame)
    return () => {
      cancelAnimationFrame(animationFrame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', scheduleFrame)
      reset()
    }
  }, [enabled])

  return frameRef
}
