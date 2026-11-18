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

/** 热力图补齐到整周，末尾用 null 占位（不参与统计与 tooltip） */
export const padHeatDays = <T>(days: T[]): (T | null)[] => {
  const size = Math.ceil(days.length / 7) * 7
  return Array.from({ length: size }, (_, index) => days[index] ?? null)
}

/** 四级强度：0 表示当天无用量 */
export const heatLevel = (value: number, max: number): 0 | 1 | 2 | 3 => {
  if (value <= 0) {
    return 0
  }
  const ratio = value / Math.max(1, max)
  return ratio > 0.6 ? 3 : ratio > 0.25 ? 2 : 1
}

/** 7 行网格的星期标签：按首日星期轮换（周一为 0） */
export const weekdayLabels = (firstDate: string, names: string[]) => {
  if (names.length === 0) {
    return Array.from({ length: 7 }, () => '')
  }
  const parsed = firstDate ? new Date(`${firstDate}T00:00:00`).getDay() : 1
  const start = (parsed + 6) % 7
  return Array.from({ length: 7 }, (_, index) => names[(start + index) % names.length] ?? '')
}
