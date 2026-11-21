import clsx from 'clsx'
import { useMemo, useRef } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { getVisibleMessages, sessionStructureKey } from '../../services/chat/branches.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import { TocMenu } from './TocMenu.js'
import styles from './SessionView.module.scss'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  // 目录只依赖消息结构：流式逐字刷新正文时无需重建提问列表
  const structureKey = sessionStructureKey(session)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const questions = useMemo(
    () => {
      // 只在结构变化时重算；流式正文更新不应重建提问列表
      void structureKey
      return getVisibleMessages(sessionRef.current).flatMap((message) =>
        message.role === 'user' && message.content
          ? [{ id: message.id, text: message.content }]
          : []
      )
    },
    [structureKey]
  )
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          {questions.length >= 2 ? <TocMenu questions={questions} /> : null}
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
