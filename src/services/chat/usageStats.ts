import { formatDate } from '../../utils/format.js'
import * as db from './db.js'

export type UsageStats = {
  sessions: number
  userMessages: number
  /** 回答条数（含失败与停止的） */
  replies: number
  /** 输入 Token：未命中缓存 + 写缓存 + 读缓存的累计 */
  inputTokens: number
  outputTokens: number
  /** 近 7 天每天的回复数，最旧在前；始终 7 个元素 */
  daily: { date: string; count: number }[]
}

const DAY = 86_400_000

const dayKey = (time: number): string | null => formatDate(time)

/** 扫描全部本地会话汇总用量；会话较多时耗时随数量线性增长，只在打开面板时调用 */
export const collectUsageStats = async (): Promise<UsageStats> => {
  const summaries = await db.loadSessionSummaries()
  const dailyCounts = new Map<string, number>()
  let userMessages = 0
  let replies = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const summary of summaries) {
    const session = await db.loadSession(summary.id)
    if (!session) {
      continue
    }
    for (const message of session.messages) {
      if (message.role === 'user') {
        userMessages += 1
        continue
      }
      replies += 1
      const { usage } = message
      if (usage) {
        inputTokens +=
          usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
        outputTokens += usage.output_tokens
      }
      const key = dayKey(message.createdAt)
      if (key) {
        dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1)
      }
    }
  }
  const today = new Date()
  const daily = Array.from({ length: 7 }, (_, index) => {
    const key = formatDate(today.getTime() - (6 - index) * DAY) ?? ''
    return { date: key, count: dailyCounts.get(key) ?? 0 }
  })
  return {
    sessions: summaries.length,
    userMessages,
    replies,
    inputTokens,
    outputTokens,
    daily,
  }
}
