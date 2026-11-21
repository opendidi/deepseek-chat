import type { MouseEvent } from 'react'
import type { Source } from '../../services/chat/view.js'
import { safeWebUrl } from '../../utils/url.js'
import { HoverCard, type HoverCardTrigger } from './HoverCard.js'
import { SourceCard } from './SourceCard.js'

/**
 * 正文里 [citation:N] 的数字角标：悬停预览来源，点击新标签打开。
 * 角标使用带 link 角色的 span，可嵌入链接文字。样式由 .ds-markdown-cite 提供。
 */
export const CitationLink = ({ source }: { source: Source }) => {
  const openUrl = () => {
    const url = safeWebUrl(source.url)
    // 历史数据或异常流里可能留存非 http(s) 地址，绝不交给 window.open
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
  const open = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openUrl()
  }
  const renderTrigger: HoverCardTrigger = ({ domRef, domProps }) => (
    <span
      ref={domRef}
      className="ds-markdown-cite"
      {...domProps}
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || (event.key === ' ' && !event.nativeEvent.isComposing)) {
          event.preventDefault()
          event.stopPropagation()
          openUrl()
        }
      }}
    >
      {source.index}
    </span>
  )
  return (
    <HoverCard renderTrigger={renderTrigger}>
      <SourceCard source={source} />
    </HoverCard>
  )
}
