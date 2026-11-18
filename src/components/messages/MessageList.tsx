import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

type MessageItemProps = {
  message: Message
  index: number
  lastIndex: number
  sessionId: string
  uploadRetryId: string | null
  busy: boolean
  versions: ReadonlyMap<string, MessageVersions>
  onSelectVersion: (messageId: string, anchorTop: number) => void
}

const MessageItem = ({
  message,
  index,
  lastIndex,
  sessionId,
  uploadRetryId,
  busy,
  versions,
  onSelectVersion,
}: MessageItemProps) =>
  message.role === 'user' ? (
    <UserMessage
      sessionId={sessionId}
      message={message}
      retryUploadId={uploadRetryId}
      isFirst={index === 0}
      isLast={index === lastIndex || index === lastIndex - 1}
      busy={busy}
      versions={versions.get(message.id) ?? EMPTY_VERSIONS}
      onSelectVersion={onSelectVersion}
    />
  ) : (
    <AssistantMessage
      sessionId={sessionId}
      message={message}
      isLast={index === lastIndex}
      streaming={busy && index === lastIndex}
      busy={busy}
      versions={versions.get(message.id) ?? EMPTY_VERSIONS}
      onSelectVersion={onSelectVersion}
    />
  )

/**
 * 历史消息单独成树：流式期间只有最后一条消息对象会变，
 * 其余 props 保持稳定，memo 可直接跳过整列历史消息的 reconcile。
 */
const HistoryItems = memo(function HistoryItems({
  messages,
  ...rest
}: Omit<MessageItemProps, 'message' | 'index'> & { messages: Message[] }) {
  return (
    <>
      {messages.map((message, index) => (
        <MessageItem key={message.id} {...rest} message={message} index={index} />
      ))}
    </>
  )
})

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  // 每帧都会生成新的可见消息数组，但历史消息对象本身引用不变；
  // 复用上一帧的历史前缀数组，让 memo 的历史子树在流式期间完全跳过。
  const historyRef = useRef<Message[]>([])
  const historyMessages = useMemo(() => {
    const next = messages.slice(0, -1)
    const previous = historyRef.current
    if (previous.length === next.length && previous.every((item, i) => item === next[i])) {
      return previous
    }
    historyRef.current = next
    return next
  }, [messages])
  const itemProps = {
    lastIndex,
    sessionId: session.id,
    uploadRetryId,
    busy: streaming,
    versions,
    onSelectVersion: selectVersion,
  }
  const lastMessage = messages[lastIndex]
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            <HistoryItems messages={historyMessages} {...itemProps} />
            {lastMessage ? (
              <MessageItem {...itemProps} message={lastMessage} index={lastIndex} />
            ) : null}
          </div>
        </div>
        {footer}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
