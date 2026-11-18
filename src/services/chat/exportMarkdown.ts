import { translate } from '../../i18n/index.js'
import { formatDate } from '../../utils/format.js'
import { getVisibleMessages } from './branches.js'
import { useChatStore } from './store.js'
import * as db from './db.js'
import type { AssistantMessage, Session } from './types.js'

/** 导出里记录的引用来源：仅标题与链接 */
type SourceCitation = { title: string | null; url: string }

/** 导出文件名里的标题：替换文件系统非法字符 */
const safeFileName = (title: string) =>
  (title
    .trim()
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/_+$/, '') || 'chat') + '.md'

/** 一条回答的正文：思考折叠块 + 正文文本，返回收集到的引用来源 */
const replyToMarkdown = (
  reply: AssistantMessage
): { text: string; citations: SourceCitation[] } => {
  const citations: SourceCitation[] = []
  const seen = new Set<string>()
  const parts: string[] = []
  const thinking = reply.blocks
    .filter((block) => block.type === 'thinking' && block.thinking.trim())
    .map((block) => (block.type === 'thinking' ? block.thinking.trim() : ''))
    .join('\n\n')
  if (thinking) {
    parts.push(
      `<details>\n<summary>${translate('exportMarkdownThinking')}</summary>\n\n${thinking}\n\n</details>`
    )
  }
  for (const block of reply.blocks) {
    if (block.type !== 'text' || !block.text.trim()) {
      continue
    }
    parts.push(block.text.trim())
    for (const citation of block.citations ?? []) {
      if (!seen.has(citation.url)) {
        seen.add(citation.url)
        citations.push({ title: citation.title, url: citation.url })
      }
    }
  }
  if (citations.length > 0) {
    const sourceList = citations
      .map(
        (citation, index) => `${index + 1}. [${citation.title || citation.url}](${citation.url})`
      )
      .join('\n')
    parts.push(`**${translate('exportMarkdownSources')}：**\n\n${sourceList}`)
  }
  return { text: parts.join('\n\n'), citations }
}

/** 会话当前路径转 Markdown 文档：提问为「用户」标题，回答为 DeepSeek 标题 */
export const sessionToMarkdown = (session: Session): string => {
  const now = new Date()
  const lines: string[] = [
    `# ${session.title || translate('untitledChat')}`,
    '',
    `> ${translate('exportMarkdownDate')}：${formatDate(now)}`,
    '',
  ]
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      lines.push(`## ${translate('exportMarkdownUser')}`, '', message.content, '')
      if (message.files.length > 0) {
        lines.push(
          `${translate('exportMarkdownAttachments')}：${message.files.map((file) => file.name).join('、')}`,
          ''
        )
      }
    } else {
      const { text } = replyToMarkdown(message)
      lines.push('## DeepSeek', '', text, '')
    }
  }
  return lines.join('\n')
}

/** 触发浏览器下载 */
const download = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 导出指定会话为 Markdown：优先内存中的最新内容，未打开的会话从本地存储读取 */
export const exportSessionMarkdown = async (sessionId: string): Promise<boolean> => {
  const { sessionCache, sessions } = useChatStore.getState()
  const summary = sessions.find((session) => session.id === sessionId)
  const cached = Object.hasOwn(sessionCache, sessionId) ? sessionCache[sessionId] : undefined
  const stored = cached ?? (await db.loadSession(sessionId))
  if (!stored) {
    return false
  }
  // 未打开的会话导出期间可能刚被重命名，标题以列表为准
  const session = summary ? { ...stored, title: summary.title } : stored
  const blob = new Blob([sessionToMarkdown(session)], { type: 'text/markdown;charset=utf-8' })
  download(safeFileName(session.title), blob)
  return true
}
