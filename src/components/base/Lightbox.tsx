import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16, IconDownloadOutline16 } from './icons.js'
import { closeLightbox, useLightbox } from './lightboxState.js'
import styles from './Lightbox.module.scss'

/** 下载当前图片：blob: 地址只用于下载，不用于顶层导航 */
const download = (src: string, name: string) => {
  const anchor = document.createElement('a')
  anchor.href = src
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * 全屏图片灯箱：点蒙层或 Esc 关闭，工具栏提供下载。
 * 图片地址由调用方管理（blob: 地址的释放属于消息附件自身的生命周期），灯箱只展示。
 */
export const Lightbox = () => {
  const t = useTranslate()
  const image = useLightbox((state) => state.image)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!image) {
      return
    }
    // 打开时移入焦点，关闭时归还；先于其他 effect 记录来源焦点
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    document.querySelector<HTMLElement>('.lightbox-close')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        closeLightbox()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (document.activeElement === document.body) {
        const restore = restoreFocusRef.current
        if (restore && document.contains(restore)) {
          restore.focus()
        }
      }
    }
  }, [image])

  if (!image) {
    return null
  }
  return createPortal(
    <div className={styles.mask} onClick={closeLightbox}>
      <figure
        className={styles.figure}
        role="dialog"
        aria-modal="true"
        aria-label={image.name}
        onClick={(event) => event.stopPropagation()}
      >
        <img className={styles.image} src={image.src} alt={image.name} />
        <figcaption className={styles.caption}>
          <span className={styles.name}>{image.name}</span>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              aria-label={t('lightboxDownload')}
              onClick={() => download(image.src, image.name)}
            >
              <IconDownloadOutline16 />
            </button>
            <button
              type="button"
              className={`${styles.action} lightbox-close`}
              aria-label={t('close')}
              onClick={closeLightbox}
            >
              <IconCloseOutline16 />
            </button>
          </div>
        </figcaption>
      </figure>
    </div>,
    document.body
  )
}
