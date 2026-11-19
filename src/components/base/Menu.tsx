import clsx from 'clsx'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import styles from './Menu.module.scss'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

/** 触发元素应展开的属性：向辅助技术声明菜单归属与展开状态 */
export type MenuTriggerProps = {
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
}

const isMenuNavKey = (key: string) =>
  key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'

/** 点击触发，向下展开；方向键在菜单项间移动，点外部或 Esc 关闭并把焦点还给触发元素 */
export const Menu = ({
  options,
  children,
}: {
  options: MenuOption[]
  children: (
    props: { open: boolean; toggle: () => void } & MenuTriggerProps
  ) => ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  // 左侧对齐并再左移 5px，让菜单文字与触发元素图标对齐
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: 'start', alignOffset: -5, offset: 4 }
  )
  useDismiss(open, [anchorRef, floatingRef], close)

  // 打开时聚焦第一个菜单项
  useLayoutEffect(() => {
    if (open) {
      floatingRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }
  }, [open, floatingRef])

  // 关闭时把焦点还给触发元素：随菜单卸载丢失的焦点（Esc / 选中菜单项）回到原处；
  // 焦点已被别处接走（如重命名输入框的 autoFocus）时不打扰
  useEffect(() => {
    if (!open) {
      return
    }
    const anchor = anchorRef.current
    return () => {
      if (document.activeElement === document.body && anchor) {
        const trigger = anchor.querySelector<HTMLElement>('button, [href], input, [tabindex]')
        trigger?.focus()
      }
    }
  }, [open, anchorRef])

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      // Tab 离开菜单：按常规焦点顺序走，菜单关闭
      setOpen(false)
      return
    }
    if (!isMenuNavKey(event.key)) {
      return
    }
    event.preventDefault()
    const items = Array.from(
      floatingRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []
    )
    if (items.length === 0) {
      return
    }
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : Math.min(items.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))
    items[next]?.focus()
  }

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {children({ open, toggle: () => setOpen((value) => !value), 'aria-haspopup': 'menu', 'aria-expanded': open })}
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="menu"
              onKeyDown={onMenuKeyDown}
            >
              {options.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="menuitem"
                  className={clsx(styles.option, option.danger && styles.danger)}
                  onClick={() => {
                    setOpen(false)
                    option.onSelect()
                  }}
                >
                  <span className={styles.icon}>{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
