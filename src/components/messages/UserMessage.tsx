import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { IconEditOutline16, IconQuoteOutline16 } from '../base/icons.js'
import { editMessage, retryUpload } from '../../services/chat/store.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import { clearMessageEdit, useEditRequest } from './editRequestState.js'
import { MessageFile } from './MessageFile.js'
import { CopyButton } from './CopyButton.js'
import { formatQuotedContent, splitQuotedContent } from '../../services/chat/quotes.js'
import styles from './UserMessage.module.scss'

export const UserMessage = memo(function UserMessage({
  sessionId,
  message,
  retryUploadId,
  isFirst,
  isLast,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: UserMessageType
  /** 回答因补传附件失败可重试时为该回答 id */
  retryUploadId: string | null
  isFirst: boolean
  isLast: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  // 引用与提问分开显示；编辑时只改提问，引用原样保留
  const { quotes, text } = splitQuotedContent(message.content)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isMobile = useIsMobile()
  const canSend = !busy && (draft.trim() !== '' || message.files.length > 0 || quotes.length > 0)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (editing && textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 202)}px`
    }
  }, [editing, draft])

  // 输入框空置按 ↑ 请求编辑上一条提问：命中本条即进入编辑（等同点编辑按钮）
  const requestedEdit = useEditRequest((state) => state.messageId)
  useEffect(() => {
    if (requestedEdit === message.id && !busy) {
      setDraft(text)
      setEditing(true)
      clearMessageEdit(message.id)
    }
  }, [requestedEdit, message.id, busy, text])

  const sendEdit = () => {
    const next = formatQuotedContent(draft.trim(), quotes)
    if (canSend && ensureApiKey() && editMessage(sessionId, message.id, next)) {
      stopReadAloud()
      setEditing(false)
    }
  }

  return (
    <div className={clsx(styles.container, isFirst && styles.isFirst)} data-message-id={message.id}>
      {message.files.length > 0 ? (
        <div
          className={clsx(
            styles.files,
            message.files.some((file) => !file.isImage) && styles.filesWithDocuments
          )}
        >
          {message.files.map((file) => (
            <MessageFile
              key={file.id}
              file={file}
              onRetry={retryUploadId ? () => retryUpload(sessionId, retryUploadId) : null}
            />
          ))}
        </div>
      ) : null}
      {editing ? (
        <div className={styles.editor}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            aria-label={t('editMessage')}
            autoFocus
            rows={1}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }
              if (event.key === 'Escape') {
                setEditing(false)
              } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !isMobile) {
                event.preventDefault()
                sendEdit()
              }
            }}
          />
          <div className={styles.editorActions}>
            <Button size="s" variant="outlined" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button size="s" disabled={!canSend} onClick={sendEdit}>
              {t('send')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {quotes.length > 0 ? (
            <div className={styles.quotes}>
              {quotes.map((quote, index) => (
                <div key={index} className={styles.quote}>
                  <span
                    className={styles.quoteIcon}
                    role="img"
                    aria-label={t('quote')}
                    title={t('quote')}
                  >
                    <IconQuoteOutline16 />
                  </span>
                  <span className={styles.quoteText}>{quote}</span>
                </div>
              ))}
            </div>
          ) : null}
          {text ? <div className={styles.bubble}>{text}</div> : null}
          <div className={styles.bottom}>
            <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
              {message.content ? <CopyButton text={message.content} /> : null}
              <IconButton
                icon={<IconEditOutline16 />}
                tooltip={t('editMessage')}
                tooltipPlacement="bottom"
                disabled={busy}
                onClick={() => {
                  setDraft(text)
                  setEditing(true)
                }}
              />
            </div>
            <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          </div>
        </>
      )}
    </div>
  )
})
