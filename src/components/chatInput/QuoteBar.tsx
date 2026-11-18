import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { Quote } from '../../services/chat/quotes.js'
import { IconCloseFill14, IconQuoteOutline16 } from '../base/icons.js'
import styles from './QuoteBar.module.scss'

/** 输入框上方的引用条：每条单行截断，悬停看全文，点击 × 移除 */
export const QuoteBar = memo(function QuoteBar({
  quotes,
  onRemove,
}: {
  quotes: Quote[]
  onRemove: (id: string) => void
}) {
  const t = useTranslate()
  if (quotes.length === 0) {
    return null
  }
  return (
    <div className={styles.list}>
      {quotes.map((quote) => (
        <div key={quote.id} className={styles.item}>
          <span className={styles.icon}>
            <IconQuoteOutline16 />
          </span>
          <span className={styles.text} title={quote.text}>
            {quote.text}
          </span>
          <button
            type="button"
            className={styles.remove}
            aria-label={t('quoteRemove')}
            onClick={() => onRemove(quote.id)}
          >
            <IconCloseFill14 />
          </button>
        </div>
      ))}
    </div>
  )
})
