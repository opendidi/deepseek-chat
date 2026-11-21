/**
 * 用量图表的纯计算：数值格式化、坐标轴刻度、日期标签与热力图分格。
 * 不依赖 API 客户端或 React，便于单测。
 */
import { formatDate } from './format.js'
import { DAY_MS } from './time.js'

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

/** 光标在绘图区的横向比例换算成日期列索引，越界时收口到首尾 */
export const chartIndexAt = (ratio: number, length: number) =>
  Math.max(0, Math.min(length - 1, Math.floor(ratio * length)))

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


/**
 * 活跃热力图固定「最近 8 周」：从 7 周前的周一到本周日共 56 格。
 * 与统计范围无关，首格一定是周一，末尾未来日期按 0 显示。
 */
export const heatWindowDates = (now = Date.now()): string[] => {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const mondayOffset = (today.getDay() + 6) % 7
  const start = today.getTime() - (mondayOffset + 7 * 7) * DAY_MS
  return Array.from({ length: 56 }, (_, index) =>
    formatDate(start + index * DAY_MS) ?? ''
  )
}

/** 占比百分比，保留一位小数；总量为 0 时全部返回 0 */
export const percent = (value: number, total: number): number =>
  total > 0 ? Math.round((Math.max(0, value) / total) * 1000) / 10 : 0

export type DonutSlice = { offset: number; length: number; share: number }

/** 环形图分段：配合 circle[pathLength=100] 的 stroke-dasharray / dashoffset */
export const donutSlices = (values: readonly number[]): DonutSlice[] => {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  let offset = 0
  return values.map((value) => {
    const share = total > 0 ? Math.max(0, value) / total : 0
    const length = share * 100
    const slice = { offset, length, share }
    offset += length
    return slice
  })
}

/** 迷你折线的 SVG path；单点时画一小段水平线，避免空路径 */
export const sparklinePath = (
  values: readonly number[],
  width: number,
  height: number,
  pad = 2
): string => {
  if (values.length === 0) {
    return ''
  }
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const span = Math.max(1, max - min)
  const innerW = Math.max(1, width - pad * 2)
  const innerH = Math.max(1, height - pad * 2)
  const points = values.map((value, index) => {
    const x = pad + (values.length === 1 ? innerW / 2 : (index / (values.length - 1)) * innerW)
    const y = pad + innerH - ((value - min) / span) * innerH
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return points.length === 1
    ? `M ${pad},${points[0].split(',')[1]} L ${(width - pad).toFixed(1)},${points[0].split(',')[1]}`
    : `M ${points.join(' L ')}`
}

/** 24 小时里最忙的一小时；全为 0 时返回 null */
export const hourPeak = (hours: readonly number[]): { hour: number; count: number } | null => {
  let hour = -1
  let count = 0
  for (let index = 0; index < 24; index += 1) {
    if ((hours[index] ?? 0) > count) {
      hour = index
      count = hours[index] ?? 0
    }
  }
  return hour < 0 ? null : { hour, count }
}

/** 小时标签：00、03 … 21，避免 24 个标签挤在一起 */
export const hourLabelIndices = new Set([0, 3, 6, 9, 12, 15, 18, 21])

