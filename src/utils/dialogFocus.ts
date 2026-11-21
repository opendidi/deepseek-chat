/** 全屏弹层与抽屉的焦点管理：初始聚焦 + Tab 循环，避免焦点穿透到被遮挡的背景 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export const focusableElements = (container: HTMLElement | null): HTMLElement[] => {
  if (!container) {
    return []
  }
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0
  )
}

/** 打开弹层时把焦点移入首个可聚焦元素；容器需带 tabIndex={-1} 兜底 */
export const focusFirst = (container: HTMLElement | null) => {
  const target = focusableElements(container)[0] ?? container
  target?.focus()
}

type TabEvent = { key: string; shiftKey: boolean; preventDefault: () => void }

/** 在容器的 onKeyDown 中调用：只在 Tab 抵达首尾或焦点跑到外部时循环 */
export const trapTabKey = (event: TabEvent, container: HTMLElement | null) => {
  if (event.key !== 'Tab' || !container) {
    return
  }
  const items = focusableElements(container)
  if (items.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}
