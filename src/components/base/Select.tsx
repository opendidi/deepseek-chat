import clsx from 'clsx'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from './icons.js'
import styles from './Select.module.scss'

export type SelectOption<T extends string> = { value: T; label: string; lang?: string }

const isMoveKey = (key: string) =>
  key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'

/**
 * 胶囊形选择器：触发器高 36px、圆角 18px、浅灰底，下拉菜单选中项右侧打勾；
 * 点外部或 Esc 关闭。value 不匹配任何选项时触发器显示 placeholder。
 * 键盘操作：触发器保持焦点，方向键在选项间移动高亮（aria-activedescendant），Enter/Space 选中。
 */
export const Select = <T extends string>({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  className,
  disabled = false,
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
}) => {
  const [open, setOpen] = useState(false)
  // 打开期间的高亮项（键盘导航目标），始终指向当前选中项初始化
  const [activeIndex, setActiveIndex] = useState(0)
  const listboxId = useId()
  const current = options.find((option) => option.value === value)
  // 菜单贴右侧展开，最多 320px 高，超出在菜单内滚动
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { align: 'end', maxHeight: 320, minSpace: 160 })
  // Esc 只关菜单，不让外层弹窗一起关闭
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  const optionId = (index: number) => `${listboxId}-${options[index]?.value}`
  const openMenu = () => {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
  }

  // 键盘高亮变化时把选项滚进可视区；纯指针操作不产生额外滚动
  useEffect(() => {
    if (open && activeIndex >= 0) {
      document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' })
    }
    // optionId 每次渲染重建但内容只随 open/activeIndex 变化，无需入依赖
    // eslint-disable-next-line react/exhaustive-deps
  }, [open, activeIndex])

  const selectIndex = (index: number) => {
    const option = options[index]
    if (option) {
      setOpen(false)
      onChange(option.value)
    }
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      // 方向键也能展开菜单；Enter/Space 走按钮原生 click
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (isMoveKey(event.key)) {
      event.preventDefault()
      setActiveIndex((index) =>
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : Math.min(
                options.length - 1,
                Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))
              )
      )
    } else if (event.key === 'Enter' || event.key === ' ') {
      // 拦截按钮原生的 click 触发，避免选中后又切换开关状态
      event.preventDefault()
      selectIndex(activeIndex)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, open && styles.open, className)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        onBlur={(event) => {
          // 焦点真的离开选择器时收起菜单（选项不是焦点元素，点选不会触发）
          if (open && !event.relatedTarget?.closest(`#${CSS.escape(listboxId)}`)) {
            setOpen(false)
          }
        }}
      >
        {current ? (
          <span lang={current.lang}>{current.label}</span>
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
        <span className={styles.arrow}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open && !disabled
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="listbox"
              id={listboxId}
              aria-label={ariaLabel}
            >
              {options.map((option, index) => (
                <div
                  key={option.value}
                  role="option"
                  id={optionId(index)}
                  lang={option.lang}
                  aria-selected={option.value === value}
                  className={clsx(
                    styles.option,
                    index === activeIndex && styles.optionFocused
                  )}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => {
                    setOpen(false)
                    onChange(option.value)
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <IconCheckOutline16 /> : null}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
