import { useTranslate } from '../../i18n/index.js'
import { memo, useEffect, useMemo, useReducer, useState } from 'react'
import {
  getHighlightLang,
  getPrism,
  isHighlightLoaded,
  loadHighlight,
} from '../../services/markdown/highlight.js'
import { IconCheckOutline16, IconCopyOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { useAlive } from '../../utils/useAlive.js'
import { copyText } from '../../utils/clipboard.js'
import { MermaidDiagram } from './MermaidDiagram.js'
import styles from './CodeBlock.module.scss'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Prism 核心未就绪时的回退：与 Prism.highlight 一样做 HTML 转义 */
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)

/** 代码块标题栏：左侧语言名，右侧复制 */
const CodeInfoRow = ({
  code,
  infostring,
  showDiagram,
  onToggleDiagram,
}: {
  code: string
  infostring: string
  showDiagram: boolean
  onToggleDiagram?: () => void
}) => {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)
  const alive = useAlive()
  // 定时器随 copied 状态由 effect 托管，卸载时自动清理
  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => {
      if (alive.current) {
        setCopied(false)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [copied, alive])
  return (
    <div className={styles.container}>
      {onToggleDiagram ? (
        <div className="md-code-block-switch" aria-label={t('mermaidSwitchLabel')}>
          <button
            type="button"
            className={styles.button}
            aria-pressed={showDiagram}
            onClick={() => !showDiagram && onToggleDiagram()}
          >
            {t('mermaidDiagram')}
          </button>
          <button
            type="button"
            className={styles.button}
            aria-pressed={!showDiagram}
            onClick={() => showDiagram && onToggleDiagram()}
          >
            {t('mermaidCode')}
          </button>
        </div>
      ) : (
        <span className={styles.name}>{infostring}</span>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={async () => {
          if (!(await copyText(code))) {
            showToast({ key: 'copyFailed' })
            return
          }
          if (alive.current) {
            setCopied(true)
          }
        }}
      >
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        <span>{t(copied ? 'copied' : 'copy')}</span>
      </button>
    </div>
  )
}

/** 代码块：语言包按需加载，不支持或尚未加载的语言按纯文本显示 */
export const CodeBlock = memo(function CodeBlock({
  code,
  infostring,
  loading = false,
}: {
  code: string
  infostring: string
  loading?: boolean
}) {
  const isMermaid = infostring.toLowerCase() === 'mermaid'
  const [showDiagram, setShowDiagram] = useState(true)
  // 语言包注册在全局 Prism 上，每次渲染直接判断；加载完成后触发一次重渲染
  const rerender = useReducer((n: number) => n + 1, 0)[1]
  const lang = getHighlightLang(infostring)
  const loaded = lang !== null && isHighlightLoaded(lang)
  useEffect(() => {
    if (lang === null || loaded) {
      return
    }
    let unmounted = false
    loadHighlight(lang).then(() => {
      if (!unmounted) {
        rerender()
      }
    })
    return () => {
      unmounted = true
    }
  }, [lang, loaded, rerender])
  const renderedHtml = useMemo(() => {
    const prism = getPrism()
    if (!prism) {
      // 核心尚未加载完成：与 Prism.highlight 一致地做 HTML 转义，避免 raw 代码注入
      return escapeHtml(code)
    }
    const name = lang !== null && loaded ? lang : 'plaintext'
    return prism.highlight(code, prism.languages[name], name)
  }, [code, lang, loaded])
  return (
    <div className="md-code-block">
      <div className="md-code-block-banner">
        <CodeInfoRow
          code={code}
          infostring={infostring}
          showDiagram={showDiagram}
          onToggleDiagram={isMermaid ? () => setShowDiagram((show) => !show) : undefined}
        />
      </div>
      {isMermaid && showDiagram ? (
        <MermaidDiagram code={code} loading={loading} />
      ) : (
        <pre dangerouslySetInnerHTML={{ __html: renderedHtml }}></pre>
      )}
    </div>
  )
})
