/**
 * 用量图表的纯计算：数值格式化、坐标轴刻度、日期标签与热力图分格。
 * 不依赖 API 客户端或 React，便于单测。
 */
export type UsageMetric = 'tokens' | 'cost' | 'replies'
export type DailyMetric = { date: string; cost: number; tokens: number; replies: number }

export const formatNumber = (value: number) => Math.round(value).toLocaleString()
export const formatMoney = (value: number) =>
  `¥${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`

export const metricValue = (day: DailyMetric, metric: UsageMetric) =>
  metric === 'tokens' ? day.tokens : metric === 'cost' ? day.cost : day.replies

export const metricText = (value: number, metric: UsageMetric) =>
  metric === 'cost' ? formatMoney(value) : formatNumber(value)

/** Y 轴刻度：Token / 次数用 k、M 缩写，费用保留小数 */
export const axisLabel = (value: number, metric: UsageMetric) => {
  if (metric === 'cost') {
    if (value === 0) {
      return '¥0'
    }
    if (value < 0.01) {
      return `¥${value.toFixed(3)}`
    }
    return `¥${value < 1 ? value.toFixed(2) : value.toFixed(1)}`
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  }
  return String(Math.round(value))
}

/** YYYY-MM-DD -> M/D，坐标轴通用写法 */
export const shortDate = (date: string) => {
  const parts = date.split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date
}

/** 7 天以内逐日标注；30 天只标首、四等分点、末，避免文字重叠 */
export const chartLabelIndices = (length: number): Set<number> => {
  if (length <= 7) {
    return new Set(Array.from({ length }, (_, index) => index))
  }
  return new Set([
    0,
    Math.round(length / 4),
    Math.round(length / 2),
    Math.round((length * 3) / 4),
    length - 1,
  ])
}

/**
 * 日历热力图：以周一为每周首列，前面按首日真实星期补空格，末尾补齐整周。
 * 返回按行（每行 7 天一周）排列的格子，null 是范围外的占位。
 */
export const calendarCells = <T extends { date: string }>(days: T[]): (T | null)[] => {
  if (days.length === 0) {
    return []
  }
  const weekday = new Date(`${days[0].date}T00:00:00`).getDay()
  const leading = Number.isFinite(weekday) ? (weekday + 6) % 7 : 0
  const cells: (T | null)[] = [...Array<T | null>(leading).fill(null), ...days]
  const trailing = (7 - (cells.length % 7)) % 7
  return [...cells, ...Array<T | null>(trailing).fill(null)]
}

/** YYYY-MM-DD -> 日号（去掉前导零），用于日历格子内的数字 */
export const dayOfMonth = (date: string) => String(Number(date.slice(-2)))

/** 四级强度：0 表示当天无用量 */
export const heatLevel = (value: number, max: number): 0 | 1 | 2 | 3 => {
  if (value <= 0) {
    return 0
  }
  const ratio = value / Math.max(1, max)
  return ratio > 0.6 ? 3 : ratio > 0.25 ? 2 : 1
}

