/** 引用片段：来自助手回复的选中文字或整段正文，随下一条消息一起提交 */
export type Quote = {
  id: string
  text: string
}

/** 单条与总引用上限，避免把长回答整段塞进上下文 */
export const MAX_QUOTES = 6
export const MAX_QUOTE_LENGTH = 2000
export const MAX_QUOTE_TOTAL = 8000

/** 引用条与请求里使用的片段，超长时截断 */
export const normalizeQuoteText = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.length > MAX_QUOTE_LENGTH ? `${trimmed.slice(0, MAX_QUOTE_LENGTH)}…` : trimmed
}

/**
 * 把引用拼进用户消息正文：每行加 Markdown 引用前缀 `> `，多条之间空一行，
 * 末尾再接用户本次提问。模型能据此区分「引用内容」与「当前问题」。
 */
export const formatQuotedContent = (text: string, quotes: readonly string[]): string => {
  let remaining = MAX_QUOTE_TOTAL
  const blocks: string[] = []
  for (const quote of quotes) {
    const content = normalizeQuoteText(quote)
    if (!content || remaining <= 0) {
      continue
    }
    const limited = content.slice(0, remaining)
    remaining -= limited.length
    blocks.push(
      limited
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    )
  }
  if (blocks.length === 0) {
    return text
  }
  const question = text.trim()
  return question ? `${blocks.join('\n\n')}\n\n${question}` : blocks.join('\n\n')
}

/** 把消息正文拆回引用片段与用户提问，用于界面分区展示与编辑 */
export const splitQuotedContent = (content: string): { quotes: string[]; text: string } => {
  const lines = content.split('\n')
  const quotes: string[] = []
  let current: string[] = []
  let index = 0
  const flush = () => {
    if (current.length > 0) {
      quotes.push(current.join('\n'))
      current = []
    }
  }
  for (; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.startsWith('> ')) {
      current.push(line.slice(2))
      continue
    }
    if (line === '') {
      flush()
      continue
    }
    break
  }
  flush()
  const text = lines.slice(index).join('\n').replace(/^\n+/, '')
  return { quotes, text }
}
