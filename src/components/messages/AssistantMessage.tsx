import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo } from 'react'
import {
  IconRefreshOutline16,
  IconStarFill16,
  IconStarOutline16,
  IconWarningOutline16,
} from '../base/icons.js'
import { describeReply } from '../../services/chat/describe.js'
import type { MessageUsage } from '../../services/api/types.js'
import { canContinueReply } from '../../services/chat/reply.js'
import { useSettings } from '../../services/settings.js'
import { continueReply, regenerateReply } from '../../services/chat/store.js'
import { toggleFavorite, useFavorites } from '../../services/chat/favorites.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { AssistantMessage as AssistantMessageType } from '../../services/chat/types.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { Button } from '../base/Button.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { ToolSteps } from './ToolSteps.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { ReadAloudButton } from './ReadAloudButton.js'
import { CopyButton } from './CopyButton.js'
import { ReplyArea } from './ReplyArea.js'
import { useReplyView } from './useReplyView.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import styles from './AssistantMessage.module.scss'

const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

/** Token 数缩写：千位以下原样，以上按 k 保留一位小数 */
const formatTokens = (value: number): string => {
  if (value < 1000) {
    return String(value)
  }
  const k = value / 1000
  return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
}

/** 用量提示：芯片展示 ↑输入 ↓输出，悬停看完整说明 */
const UsageChip = ({ usage }: { usage: MessageUsage }) => {
  const t = useTranslate()
  const input =
    usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
  return (
    <Tooltip
      content={t('messageUsageTooltip', {
        input: formatTokens(input),
        output: formatTokens(usage.output_tokens),
      })}
    >
      <span className={styles.usage}>
        {t('messageUsage', {
          input: formatTokens(input),
          output: formatTokens(usage.output_tokens),
        })}
      </span>
    </Tooltip>
  )
}

export const AssistantMessage = memo(function AssistantMessage({
  sessionId,
  message,
  isLast,
  streaming,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: AssistantMessageType
  isLast: boolean
  streaming: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const allowRefusal = useSettings((state) => state.continueAfterRefusal)
  const view = useReplyView(message, streaming)
  const summaryEntry = `${message.id}-summary`
  // 相等性下沉进 selector：只在本条的汇总入口命中时才重渲染，
  // 避免开关搜索面板（entry 变化）牵动所有已挂载消息的 store 订阅。
  const summaryActive = useSearchPanel((state) => state.entry === summaryEntry)
  const notice = streaming ? null : describeReply(message)
  // 安全拒绝：已下发的思考与正文按协议丢弃，只显示模板答复。
  const refused = message.stopReason === 'refusal'
  const answer = refused ? null : view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const copyText = responseText || notice?.text
  const waiting = streaming && view.steps.length === 0 && !view.answer && !message.thinking
  return (
    <div className={styles.message} data-message-id={message.id}>
      {refused ? null : (
        <ReplyArea
          message={message}
          view={view}
          streaming={streaming}
          hasResponse={!!responseText}
        />
      )}
      {answer ? (
        <Markdown
          className="ds-assistant-message-main-content"
          content={answer.markdown}
          loading={streaming}
          cacheKey={message.id}
          disableLink={false}
          sources={view.sources}
        />
      ) : null}
      <ToolSteps steps={message.toolSteps} />
      {waiting ? (
        <div className={styles.waiting}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={styles.waitingDot} />
          ))}
        </div>
      ) : null}
      {notice?.presentation === 'response' ? (
        <Markdown
          className="ds-assistant-message-main-content"
          content={notice.text}
          loading={false}
          cacheKey={`${message.id}-template`}
          disableLink={false}
        />
      ) : notice ? (
        <div className={styles.notice}>
          <IconWarningOutline16 />
          <span>
            {notice.text}
            {notice.action === 'apiKey' ? (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.noticeAction}
                  onClick={() => openSettings('data')}
                >
                  {t('changeApiKey')}
                </button>
              </>
            ) : null}
            {notice.action === 'topUp' ? (
              <>
                {' '}
                <a
                  className={styles.noticeAction}
                  href={TOP_UP_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('topUp')}
                </a>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {!streaming && !refused && view.searchResults.length > 0 ? (
        <div
          className={clsx(styles.summary, summaryActive && styles.summaryActive)}
          onClick={() => toggleSearchPanel(summaryEntry, view.searchResults)}
        >
          <SiteThumbnails sources={view.searchResults} />
          <span>
            {t(
              view.searchResults.length === 1 ? 'messageSearchSummary' : 'messageSearchSummaries',
              { count: view.searchResults.length }
            )}
          </span>
        </div>
      ) : null}
      {streaming ? null : (
        <div className={styles.bottom}>
          <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
            {copyText ? <CopyButton text={copyText} /> : null}
            {responseText && !refused ? (
              <FavoriteButton sessionId={sessionId} message={message} />
            ) : null}
            {responseText && !refused ? (
              <ReadAloudButton messageId={message.id} text={responseText} />
            ) : null}
            <IconButton
              icon={<IconRefreshOutline16 />}
              tooltip={t('regenerate')}
              tooltipPlacement="bottom"
              disabled={busy || refused}
              onClick={() => {
                stopReadAloud()
                regenerateReply(sessionId, message.id)
              }}
            />
            {!busy && message.usage ? <UsageChip usage={message.usage} /> : null}
          </div>
          {isLast && canContinueReply(message, allowRefusal) ? (
            <Button
              variant="outlined"
              size="s"
              className={styles.continueButton}
              disabled={busy}
              onClick={() => {
                stopReadAloud()
                continueReply(sessionId, message.id)
              }}
            >
              {t('continueGenerating')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
})

/** 订阅指定回答的收藏状态 */
const useFavoritesState = (sessionId: string, messageId: string): boolean =>
  useFavorites((state) =>
    state.favorites.some((favorite) => favorite.id === `${sessionId}:${messageId}`)
  )

/** 收藏按钮：已收藏显示实心星标 */
const FavoriteButton = ({
  sessionId,
  message,
}: {
  sessionId: string
  message: AssistantMessageType
}) => {
  const t = useTranslate()
  const favorited = useFavoritesState(sessionId, message.id)
  return (
    <IconButton
      icon={favorited ? <IconStarFill16 /> : <IconStarOutline16 />}
      tooltip={t(favorited ? 'favoriteRemove' : 'favoriteAdd')}
      tooltipPlacement="bottom"
      ariaLabel={t(favorited ? 'favoriteRemove' : 'favoriteAdd')}
      aria-pressed={favorited}
      onClick={() => toggleFavorite(sessionId, message)}
    />
  )
}
