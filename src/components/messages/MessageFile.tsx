import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useUploads } from '../../services/attachments.js'
import { loadFile } from '../../services/chat/db.js'
import type { FileAttachment } from '../../services/chat/types.js'
import { IconPhotoErrorFill20, IconRefreshOutline16 } from '../base/icons.js'
import { openLightbox } from '../base/lightboxState.js'
import { Tooltip } from '../base/Tooltip.js'
import { FileCard } from '../files/FileCard.js'
import styles from './MessageFile.module.scss'

/** 原件一律以「下载」交付，绝不把 blob: 地址用于顶层导航（html/svg 会在同源执行脚本）。 */
const downloadBlob = (url: string, name: string) => {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** 原件从 IndexedDB 读出并生成本地地址；url=undefined 加载中，null 表示原件缺失或读取失败。 */
const useFileUrl = (id: string): { url: string | null | undefined; error: boolean } => {
  const [state, setState] = useState<{ id: string; url: string | null; error: boolean } | null>(
    null
  )
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    loadFile(id)
      .then((blob) => {
        if (cancelled) {
          return
        }
        if (blob) {
          objectUrl = URL.createObjectURL(blob)
        }
        setState({ id, url: objectUrl, error: false })
      })
      .catch(() => {
        // 隐私模式 / 配额不足 / 数据库被关闭时 IndexedDB 会 reject；
        // 没有错误态的话附件会永远停在「加载中」且产生 unhandled rejection。
        if (!cancelled) {
          setState({ id, url: null, error: true })
        }
      })
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [id])
  return state?.id === id
    ? { url: state.url, error: state.error }
    : { url: undefined, error: false }
}

/** 历史或失效附件的补传状态：只在还没有 serverId 时显示 */
const useUploadState = (file: FileAttachment) =>
  useUploads((state) => {
    if (file.serverId) {
      return null
    }
    const task = state.tasks[file.id]
    return task?.status === 'uploading' || task?.status === 'error' ? task : null
  })

/**
 * 消息里的附件：
 * - 图片：纯图片显示 120×120 缩略图，与文件混排时为 64×64；上传中显示 loading 蒙层，
 *   上传失败显示品牌色描边 + 中心重试图标（可重试）或 photo-error 图标（不可重试）。
 * - 文件：显示文件卡片。
 */
export const MessageFile = ({
  file,
  onRetry,
}: {
  file: FileAttachment
  /** 本条消息补传失败且可重试时提供 */
  onRetry: (() => void) | null
}) => {
  const t = useTranslate()
  const { url, error: readFailed } = useFileUrl(file.id)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const upload = useUploadState(file)
  const uploading = upload?.status === 'uploading'
  const failed = upload?.status === 'error'
  const retryable = failed && upload.retryable
  const errorText = readFailed
    ? t('fileLoadFailed')
    : failed
      ? t(upload.error.key, upload.error.params)
      : undefined

  const retry = readFailed ? null : retryable ? onRetry : null

  if (file.isImage && url !== null) {
    const preview = url ? (
      failedUrl === url ? (
        <span className={styles.failedIcon} role="img" aria-label={file.name}>
          <IconPhotoErrorFill20 />
        </span>
      ) : (
        <img src={url} alt={file.name} onError={() => setFailedUrl(url)} />
      )
    ) : null

    // 上传中：本地原件已在 IndexedDB，先垫在蒙层下显示，避免只有一块灰色占位
    if (uploading) {
      return (
        <div className={clsx(styles.image, styles.imageThumb)} title={file.name}>
          {preview}
          <div className={styles.overlay}>
            <span className={styles.spinner} />
          </div>
        </div>
      )
    }

    // 「上传失败」只显示状态，其余原因写在图片底部的渐变上
    const reason =
      errorText && errorText !== t('uploadFileStatusFailed') ? (
        <span className={styles.reason}>{errorText}</span>
      ) : null

    // 上传失败不可重试：保留缩略图，底部渐变显示原因
    if (failed && !retry) {
      return (
        <div
          className={clsx(styles.image, styles.imageThumb)}
          title={errorText}
          aria-label={errorText}
        >
          {preview ?? (
            <span className={styles.failedIcon}>
              <IconPhotoErrorFill20 />
            </span>
          )}
          {reason}
        </div>
      )
    }

    // 上传失败可重试：缩略图 + 红色描边 + 蒙层重试图标，原因在底部
    if (failed && retry) {
      const retryLabel = t('uploadRetry', { message: errorText ?? t('uploadFileStatusFailed') })
      return (
        <Tooltip content={retryLabel}>
          <button
            type="button"
            className={clsx(styles.image, styles.imageThumb, styles.retryImage)}
            aria-label={retryLabel}
            onClick={retry}
          >
            {preview}
            <div className={clsx(styles.overlay, styles.retryOverlay)}>
              <IconRefreshOutline16 />
            </div>
            {reason}
          </button>
        </Tooltip>
      )
    }

    // 正常态：点击打开灯箱查看大图，原件下载在灯箱里
    return url ? (
      <button
        type="button"
        className={clsx(styles.image, styles.imageThumb, styles.viewImage)}
        title={file.name}
        aria-label={`${t('lightboxOpen')}：${file.name}`}
        onClick={() => openLightbox({ src: url, name: file.name })}
      >
        {preview}
      </button>
    ) : (
      // 原件还没加载出来（极短暂）
      <div className={styles.image} />
    )
  }

  return (
    <FileCard
      name={file.name}
      size={file.size}
      status={uploading ? 'uploading' : failed || readFailed ? 'error' : 'done'}
      error={errorText}
      onRetry={retry ?? undefined}
      onOpen={url && !upload && !readFailed ? () => downloadBlob(url, file.name) : undefined}
    />
  )
}
