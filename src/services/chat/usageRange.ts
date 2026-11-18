/** 用量统计的时间范围与日期序列；纯函数，便于单测且不依赖 API 客户端 */
import { formatDate } from '../../utils/format.js'

export type UsageRange = 'today' | '7d' | '30d'

export const RANGE_DAYS: Record<UsageRange, number> = { today: 1, '7d': 7, '30d': 30 }

const DAY = 86_400_000

/** 按本地时区返回范围内的日期字符串（YYYY-MM-DD），最旧在前 */
export const usageDates = (range: UsageRange, now = Date.now()): string[] => {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: RANGE_DAYS[range] }, (_, index) =>
    formatDate(today.getTime() - (RANGE_DAYS[range] - 1 - index) * DAY) ?? ''
  )
}
