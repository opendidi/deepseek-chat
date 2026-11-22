import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  IconChartOutline16,
  IconEllipsisOutline16,
  IconGlobeLanguageOutline14,
  IconNotebookOutline16,
  IconPaperclipOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { Menu, type MenuOption } from '../base/Menu.js'
import { setChatModel, setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { requestMessageEdit } from '../messages/editRequestState.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  removeDraftQuote,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import {
  navigateInputHistory,
  recordInputHistory,
  resetInputHistory,
} from '../../services/chat/inputHistory.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ModelPicker } from './ModelPicker.js'
import { ACCEPT, MAX_COUNT, MAX_SIZE_MB, useUploads } from '../../services/attachments.js'
import { usePrompts, type PromptTemplate } from '../../services/prompts.js'
import { DraftAttachments } from './DraftAttachments.js'
import { QuoteBar } from './QuoteBar.js'
import { openPromptLibrary } from './promptLibraryState.js'
import { PromptMenu } from './PromptMenu.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { EmojiButton } from './EmojiButton.js'
import { SessionStatsButton, SessionStatsModalHost, openSessionStats } from './SessionStats.js'
import { ChatModePicker, chatModeMenuOptions } from './ChatModePicker.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.scss'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  // 纯 selector 反模式修正：计算放 useMemo，selector 只取数据
  const uploadTasks = useUploads((state) => state.tasks)
  const draftReady = useMemo(
    () => prepareDraftMessage(draft, uploadTasks) !== null,
    [draft, uploadTasks]
  )
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const chatMode = useSettings((state) => state.chatMode)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const chatModel = useSettings((state) => state.chatModel)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaWrapperRef = useRef<HTMLDivElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)

  // 斜杠命令：草稿以 / 开头且不含空白时浮出提示词菜单，Esc 可关闭本次浮出
  const prompts = usePrompts((state) => state.prompts)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1]
  const slashMatches = useMemo(() => {
    if (slashQuery === undefined) {
      return null
    }
    const query = slashQuery.toLowerCase()
    return prompts.filter((prompt) => prompt.title.toLowerCase().includes(query))
  }, [prompts, slashQuery])
  const slashOpen = slashMatches !== null && !slashDismissed
  useEffect(() => {
    if (slashQuery === undefined) {
      setSlashDismissed(false)
    }
    setSlashIndex(0)
  }, [slashQuery])

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory) {
      return
    }
    const error = addDraftFiles(sessionId, files)
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        retryDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  /** 表情插入到光标处，并把光标移到插入内容之后 */
  const insertAtCursor = useCallback(
    (insert: string) => {
      const textarea = textareaRef.current
      const current = getDraft(sessionId).text
      const start = textarea?.selectionStart ?? current.length
      const end = textarea?.selectionEnd ?? current.length
      setDraftText(sessionId, current.slice(0, start) + insert + current.slice(end))
      const caret = start + insert.length
      requestAnimationFrame(() => {
        // 移动端面板占据键盘位置，重新聚焦会把软键盘弹回来、把面板挤走；
        // 仍设置选区，保证连续挑选表情时接着上一次的位置插入。
        textarea?.setSelectionRange(caret, caret)
        if (!isMobile) {
          // 面板保持打开可继续选表情，焦点仍交还输入框以便直接打字
          textarea?.focus({ preventScroll: true })
        }
      })
    },
    [isMobile, sessionId]
  )

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    const sentText = getDraft(sessionId).text
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!sendMessage(sessionId)) {
      return
    }
    recordInputHistory(sentText)
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  /** 空输入框用 ↑/↓ 调取已发送的历史输入；返回 null 时不拦截按键 */
  const navigateHistory = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.nativeEvent.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }
    const next = navigateInputHistory(getDraft(sessionId).text, event.key === 'ArrowUp')
    if (next === null) {
      return
    }
    event.preventDefault()
    setText(next)
    // 光标移到行尾，连续翻历史时从末尾继续
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      const caret = next.length
      textarea?.setSelectionRange(caret, caret)
    })
  }

  /** 应用提示词：整段替换草稿（草稿此时只是「/关键词」），光标落到内容末尾 */
  const applyPrompt = (prompt: PromptTemplate) => {
    setSlashDismissed(false)
    setSlashIndex(0)
    setText(prompt.content)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      const caret = prompt.content.length
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(caret, caret)
    })
  }

  /** 移动端「更多」菜单：把低频入口（聊天模式 / 提示词库 / 会话统计）收起来，工具行只留高频操作 */
  const moreOptions: MenuOption[] = [
    ...chatModeMenuOptions(t, chatMode),
    { key: 'prompts', label: t('promptLibrary'), icon: <IconNotebookOutline16 />, onSelect: openPromptLibrary },
    { key: 'stats', label: t('sessionStatsTooltip'), icon: <IconChartOutline16 />, onSelect: openSessionStats },
  ]

  /** 斜杠菜单打开时优先处理 ↑/↓/Enter/Esc，都不再进输入历史与发送流程 */
  const slashMenuKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!slashOpen || !slashMatches || event.nativeEvent.isComposing) {
      return false
    }
    const count = slashMatches.length
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (count > 0) {
        const delta = event.key === 'ArrowUp' ? -1 : 1
        setSlashIndex((index) => (index + delta + count) % count)
      }
      return true
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const pick = slashMatches[slashIndex]
      if (pick) {
        applyPrompt(pick)
      } else {
        openPromptLibrary()
      }
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setSlashDismissed(true)
      return true
    }
    return false
  }

  /** 正在生成时按 Esc 停止回答，与停止按钮等效 */
  const stopStreamingKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && streaming && sessionId !== null) {
      event.preventDefault()
      stopReply(sessionId)
      return true
    }
    return false
  }

  /** 空输入框按 ↑ 调出上一条提问的编辑（等同点该条消息的编辑按钮）；没有可编辑消息时交回输入历史 */
  const editLastQuestionKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (
      event.key !== 'ArrowUp' ||
      event.nativeEvent.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      sessionId === null ||
      streaming ||
      getDraft(sessionId).text !== ''
    ) {
      return false
    }
    const cache = useChatStore.getState().sessionCache
    const session = Object.hasOwn(cache, sessionId) ? cache[sessionId] : undefined
    const last = session
      ? getVisibleMessages(session).filter((message) => message.role === 'user').at(-1)
      : undefined
    if (!last) {
      return false
    }
    event.preventDefault()
    requestMessageEdit(last.id)
    return true
  }

  return (
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      <QuoteBar
        quotes={draft.quotes}
        onRemove={(id) => removeDraftQuote(sessionId, id)}
      />
      <div ref={textareaWrapperRef} className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
          placeholder={t('chatInputPlaceholderChat')}
          rows={2}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={text}
          onChange={(event) => {
            resetInputHistory()
            setText(event.target.value)
          }}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (slashMenuKeyDown(event)) {
              return
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
              return
            }
            if (stopStreamingKeyDown(event) || editLastQuestionKeyDown(event)) {
              return
            }
            navigateHistory(event)
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
        {slashOpen && slashMatches ? (
          <PromptMenu
            anchor={textareaWrapperRef.current}
            matches={slashMatches}
            activeIndex={Math.min(slashIndex, Math.max(slashMatches.length - 1, 0))}
            onSelect={applyPrompt}
            onManage={openPromptLibrary}
          />
        ) : null}
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Tooltip content={t('deactivatedThinkTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, thinking && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinking}
              onClick={() => setThinking(!thinking)}
            >
              <IconThinkOutline14 />
              <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
          <ModelPicker chatModel={chatModel} onPick={setChatModel} />
        </div>
        <div className={styles.right}>
          {isMobile ? (
            <Menu options={moreOptions}>
              {({ toggle, ...triggerProps }) => (
                <IconButton
                  icon={<IconEllipsisOutline16 />}
                  tooltip={t('more')}
                  ariaLabel={t('more')}
                  onClick={toggle}
                  {...triggerProps}
                />
              )}
            </Menu>
          ) : (
            <>
              <ChatModePicker />
              <SessionStatsButton disabled={importingHistory} />
              <IconButton
                icon={<IconNotebookOutline16 />}
                tooltip={t('promptLibrary')}
                ariaLabel={t('promptLibrary')}
                disabled={importingHistory}
                onClick={openPromptLibrary}
              />
            </>
          )}
          <EmojiButton disabled={importingHistory} onSelect={insertAtCursor} />
          <VoiceButton
            status={voice.status}
            disabled={!voice.available}
            seconds={voice.seconds}
            onClick={() => {
              if (voice.status !== 'idle' || !useChatStore.getState().importingHistory) {
                void voice.toggle()
              }
            }}
          />
          <IconButton
            size="m"
            tone="primary"
            icon={<IconPaperclipOutline16 />}
            tooltip={`${t('uploadFileDesc')}\n${t('dragFileDesc', { count: MAX_COUNT, size: MAX_SIZE_MB })}`}
            ariaLabel={t('uploadFile')}
            disabled={importingHistory}
            onClick={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          )}
        </div>
        {/* 弹窗与入口按钮解耦：移动端从「更多」菜单打开时按钮并不渲染 */}
        <SessionStatsModalHost />
      </div>
      {dragging ? <DragMask /> : null}
    </div>
  )
}

