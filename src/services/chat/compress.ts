import type { MessageParam } from '../api/types.js'
import { COMPRESS_LABELS, COMPRESS_PREFIXES, promptLocale } from '../agent/promptI18n.js'

/**
 * 长对话压缩：开启后，请求上下文超过预算时把较早的消息折叠成一段本地摘要放进 system，
 * 只影响本次请求，不改写会话历史、不落盘。字符数作为 token 的粗略近似。
 */
/** 触发压缩的字符预算（约等于 64k 窗口的 80%） */
export const CONTEXT_CHAR_BUDGET = 48_000
/** 压缩后保留最近内容的预算 */
export const KEEP_CHAR_BUDGET = 28_000
/** 摘要最大长度（含前缀） */
export const SUMMARY_CHAR_LIMIT = 6_000

const textOfBlock = (block: unknown): string => {
  if (typeof block !== 'object' || block === null) {
    return ''
  }
  const value = block as { text?: unknown; thinking?: unknown }
  if (typeof value.text === 'string') {
    return value.text
  }
  return typeof value.thinking === 'string' ? value.thinking : ''
}

/** 只取文本内容；附件与工具块不参与长度估算和摘要 */
export const messageText = (message: MessageParam): string => {
  if (message.role === 'latest_reminder') {
    return message.content
  }
  if (typeof message.content === 'string') {
    return message.content
  }
  return message.content.map(textOfBlock).filter(Boolean).join(' ')
}

export type CompressionResult = {
  messages: MessageParam[]
  /** 空串表示未压缩 */
  summary: string
}

export const compressMessages = (
  messages: MessageParam[],
  enabled: boolean,
  locale = 'zh-CN'
): CompressionResult => {
  const lang = promptLocale(locale)
  const unchanged: CompressionResult = { messages, summary: '' }
  if (!enabled) {
    return unchanged
  }
  const total = messages.reduce((sum, message) => sum + messageText(message).length, 0)
  if (total <= CONTEXT_CHAR_BUDGET) {
    return unchanged
  }

  // 从最新消息往前保留一段预算内的上下文
  let size = 0
  let start = messages.length
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const length = messageText(messages[i]).length
    if (size + length > KEEP_CHAR_BUDGET && start < messages.length) {
      break
    }
    size += length
    start = i
  }
  // 请求体必须从 user 开始；切点落在 assistant / reminder 上时后退到下一个 user
  while (start < messages.length && messages[start].role !== 'user') {
    start += 1
  }
  if (start >= messages.length) {
    return unchanged
  }

  const lines: string[] = []
  for (const message of messages.slice(0, start)) {
    const text = messageText(message).trim()
    if (!text) {
      continue
    }
    const labels = COMPRESS_LABELS[lang]
    const label =
      message.role === 'user'
        ? labels.user
        : message.role === 'assistant'
          ? labels.assistant
          : labels.context
    lines.push(`- ${label}：${text.slice(0, 200).replace(/\s+/g, ' ')}`)
  }
  const limit = Math.max(0, SUMMARY_CHAR_LIMIT - COMPRESS_PREFIXES[lang].length)
  let digest = lines.join('\n')
  if (digest.length > limit) {
    digest = `${digest.slice(0, limit)}…`
  }
  return {
    messages: messages.slice(start),
    summary: digest ? `${COMPRESS_PREFIXES[lang]}${digest}` : '',
  }
}
