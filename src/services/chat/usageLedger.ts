/**
 * 本机用量账本 v2：每轮请求结束时按「日 / 模型 / 会话」记账。
 *
 * 只保存聚合数字与 24 小时请求数直方图，不含对话正文。v1 账本（仅 ttsChars /
 * asrSeconds）读取时按缺省值补齐，不需要迁移脚本；损坏的 JSON 当作空账本处理。
 * 服务端上报的 Token 明细同时保存在会话消息里，账本用于快速读取、额度提醒以及
 * 会话删除后仍能追溯的记录，两者不重复计入统计页。
 */
import type { MessageUsage } from '../api/types.js'
import { formatDate } from '../../utils/format.js'
import { estimateRequestCost, type CostParts } from './usagePricing.js'

const KEY = 'deepseek-chat:usage-ledger'
const HIDDEN_KEY = 'deepseek-chat:usage-hidden-records'
/** 与 400 天账本分开的今日用量，跨天自动归零，只用于额度提醒 */
const TODAY_KEY = 'deepseek-chat:usage-today'
const REMINDED_KEY = 'deepseek-chat:usage-quota-reminded'
/** 账本按天保留的上限，超出后丢弃最早的记录 */
export const MAX_LEDGER_DAYS = 400
export const LEDGER_VERSION = 2
const HOURS = 24

export type LedgerModelUsage = {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  cost: number
  requests: number
  webSearch: number
  pageFetch: number
}

export type LedgerSessionUsage = {
  title: string
  tokens: number
  cost: number
  requests: number
  /** 该会话当天最后一次请求时间，用于上下文记录表格 */
  lastAt: number
}

export type LedgerDay = {
  version: typeof LEDGER_VERSION
  ttsChars: number
  asrSeconds: number
  /** 24 小时请求数直方图 */
  hours: number[]
  models: Record<string, LedgerModelUsage>
  sessions: Record<string, LedgerSessionUsage>
}

export type UsageLedger = Record<string, LedgerDay>

export type LedgerExtra = {
  ttsChars: number
  asrSeconds: number
  requests: number
  cost: number
  tokens: number
  webSearch: number
  pageFetch: number
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

const emptyModel = (): LedgerModelUsage => ({
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  cost: 0,
  requests: 0,
  webSearch: 0,
  pageFetch: 0,
})

const emptySession = (): LedgerSessionUsage => ({
  title: '',
  tokens: 0,
  cost: 0,
  requests: 0,
  lastAt: 0,
})

export const emptyDay = (): LedgerDay => ({
  version: LEDGER_VERSION,
  ttsChars: 0,
  asrSeconds: 0,
  hours: Array<number>(HOURS).fill(0),
  models: {},
  sessions: {},
})

const readModel = (value: unknown): LedgerModelUsage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyModel()
  }
  const item = value as Record<string, unknown>
  return {
    input: num(item.input),
    cacheWrite: num(item.cacheWrite),
    cacheRead: num(item.cacheRead),
    output: num(item.output),
    cost: num(item.cost),
    requests: num(item.requests),
    webSearch: num(item.webSearch),
    pageFetch: num(item.pageFetch),
  }
}

const readSession = (value: unknown): LedgerSessionUsage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptySession()
  }
  const item = value as Record<string, unknown>
  return {
    title: typeof item.title === 'string' ? item.title.slice(0, 200) : '',
    tokens: num(item.tokens),
    cost: num(item.cost),
    requests: num(item.requests),
    lastAt: num(item.lastAt),
  }
}

/** 单个日期的读取：v1 / 缺字段 / 脏类型一律按缺省值补齐，不让页面崩 */
export const normalizeDay = (value: unknown): LedgerDay => {
  const day = emptyDay()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return day
  }
  const raw = value as Record<string, unknown>
  day.ttsChars = num(raw.ttsChars)
  day.asrSeconds = num(raw.asrSeconds)
  if (Array.isArray(raw.hours)) {
    for (let hour = 0; hour < HOURS; hour += 1) {
      day.hours[hour] = num(raw.hours[hour])
    }
  }
  if (raw.models && typeof raw.models === 'object' && !Array.isArray(raw.models)) {
    for (const [id, item] of Object.entries(raw.models)) {
      day.models[id] = readModel(item)
    }
  }
  if (raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)) {
    for (const [id, item] of Object.entries(raw.sessions)) {
      day.sessions[id] = readSession(item)
    }
  }
  return day
}

export const readLedger = (): UsageLedger => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const result: UsageLedger = {}
    for (const [date, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        continue
      }
      result[date] = normalizeDay(value)
    }
    return result
  } catch {
    return {}
  }
}

const writeLedger = (ledger: UsageLedger) => {
  const dates = Object.keys(ledger).sort()
  const trimmed: UsageLedger = {}
  for (const date of dates.slice(-MAX_LEDGER_DAYS)) {
    trimmed[date] = ledger[date]
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // 存储不可用时只影响本机用量统计
  }
}

const withDay = (date: string, update: (day: LedgerDay) => void) => {
  if (!date) {
    return
  }
  const ledger = readLedger()
  const day = ledger[date] ?? emptyDay()
  update(day)
  ledger[date] = day
  writeLedger(ledger)
}

export type TodayUsage = {
  date: string
  requests: number
  tokens: number
  cost: number
  webSearch: number
  pageFetch: number
}

const emptyToday = (): TodayUsage => ({
  date: formatDate(Date.now()) ?? '',
  requests: 0,
  tokens: 0,
  cost: 0,
  webSearch: 0,
  pageFetch: 0,
})

/** 今日聚合：日期不是今天就当作空记录，不需要定时任务清理 */
export const readTodayUsage = (): TodayUsage => {
  const empty = emptyToday()
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TODAY_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return empty
    }
    const raw = parsed as Record<string, unknown>
    if (raw.date !== empty.date) {
      return empty
    }
    return {
      date: empty.date,
      requests: num(raw.requests),
      tokens: num(raw.tokens),
      cost: num(raw.cost),
      webSearch: num(raw.webSearch),
      pageFetch: num(raw.pageFetch),
    }
  } catch {
    return empty
  }
}

/** 今日费用达到额度时一天只提醒一次；返回 null 表示本次不需要提醒 */
export const checkDailyQuota = (quota: number): { cost: number } | null => {
  if (!(quota > 0)) {
    return null
  }
  const today = readTodayUsage()
  if (today.cost < quota) {
    return null
  }
  try {
    if (localStorage.getItem(REMINDED_KEY) === today.date) {
      return null
    }
    localStorage.setItem(REMINDED_KEY, today.date)
  } catch {
    return null
  }
  return { cost: today.cost }
}

export type UsageRecord = {
  at: number
  model: string | null
  sessionId: string
  title: string
  usage: MessageUsage
  /** 本轮网页抓取结果数；服务端搜索次数从 usage 读取 */
  pageFetch: number
  freeServerTools: boolean
}

/** 一轮请求结束（含失败/停止，只要服务端上报了 usage）时写入账本 */
export const recordUsage = ({
  at,
  model,
  sessionId,
  title,
  usage,
  pageFetch,
  freeServerTools,
}: UsageRecord) => {
  const date = formatDate(at)
  if (!date || !sessionId) {
    return
  }
  const parts: CostParts = {
    input: usage.input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
    cacheRead: usage.cache_read_input_tokens,
    output: usage.output_tokens,
    webSearch: usage.server_tool_use?.web_search_requests ?? 0,
    pageFetch,
  }
  const tokens = parts.input + parts.cacheWrite + parts.cacheRead + parts.output
  const cost = estimateRequestCost({ model, at, parts, freeServerTools })
  const hour = new Date(at).getHours()
  const modelId = model ?? 'unknown'

  withDay(date, (day) => {
    day.hours[hour >= 0 && hour < HOURS ? hour : 0] += 1

    const modelUsage = day.models[modelId] ?? emptyModel()
    modelUsage.input += parts.input
    modelUsage.cacheWrite += parts.cacheWrite
    modelUsage.cacheRead += parts.cacheRead
    modelUsage.output += parts.output
    modelUsage.cost += cost
    modelUsage.requests += 1
    modelUsage.webSearch += parts.webSearch ?? 0
    modelUsage.pageFetch += parts.pageFetch ?? 0
    day.models[modelId] = modelUsage

    const session = day.sessions[sessionId] ?? emptySession()
    session.title = title.slice(0, 200) || session.title
    session.tokens += tokens
    session.cost += cost
    session.requests += 1
    session.lastAt = Math.max(session.lastAt, at)
    day.sessions[sessionId] = session
  })

  const today = readTodayUsage()
  today.requests += 1
  today.tokens += tokens
  today.cost += cost
  today.webSearch += parts.webSearch ?? 0
  today.pageFetch += parts.pageFetch ?? 0
  try {
    localStorage.setItem(TODAY_KEY, JSON.stringify(today))
  } catch {
    // 存储不可用时只影响额度提醒
  }
}

/** 朗读一段文本时累计合成字符数 */
export const recordTtsChars = (text: string) =>
  withDay(formatDate(Date.now()) ?? '', (day) => {
    day.ttsChars += Math.max(0, text.length)
  })

/** 一次听写结束后累计录音秒数 */
export const recordAsrSeconds = (seconds: number) => {
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    return
  }
  withDay(formatDate(Date.now()) ?? '', (day) => {
    day.asrSeconds += seconds
  })
}

const emptyExtra = (): LedgerExtra => ({
  ttsChars: 0,
  asrSeconds: 0,
  requests: 0,
  cost: 0,
  tokens: 0,
  webSearch: 0,
  pageFetch: 0,
})

/** 汇总范围内的附加用量与账本自身的请求聚合 */
export const ledgerInRange = (
  ledger: UsageLedger,
  dates: readonly string[]
): LedgerExtra => {
  const allowed = new Set(dates)
  return Object.entries(ledger).reduce<LedgerExtra>((total, [date, day]) => {
    if (!allowed.has(date)) {
      return total
    }
    total.ttsChars += day.ttsChars
    total.asrSeconds += day.asrSeconds
    for (const model of Object.values(day.models)) {
      total.requests += model.requests
      total.cost += model.cost
      total.tokens += model.input + model.cacheWrite + model.cacheRead + model.output
      total.webSearch += model.webSearch
      total.pageFetch += model.pageFetch
    }
    return total
  }, emptyExtra())
}

/** 范围内 24 小时请求数，供账本导出与额度核对 */
export const ledgerHours = (
  ledger: UsageLedger,
  dates: readonly string[]
): number[] => {
  const allowed = new Set(dates)
  const hours = Array<number>(HOURS).fill(0)
  for (const [date, day] of Object.entries(ledger)) {
    if (!allowed.has(date)) {
      continue
    }
    for (let hour = 0; hour < HOURS; hour += 1) {
      hours[hour] += day.hours[hour] ?? 0
    }
  }
  return hours
}

export type LedgerSessionRecord = LedgerSessionUsage & { id: string }

/** 范围内按会话拆分的账本记录；会话删除后仍可追溯 */
export const ledgerSessions = (
  ledger: UsageLedger,
  dates: readonly string[]
): LedgerSessionRecord[] => {
  const allowed = new Set(dates)
  const result = new Map<string, LedgerSessionRecord>()
  for (const [date, day] of Object.entries(ledger)) {
    if (!allowed.has(date)) {
      continue
    }
    for (const [id, session] of Object.entries(day.sessions)) {
      const item = result.get(id) ?? { id, ...emptySession() }
      item.title = session.title || item.title
      item.tokens += session.tokens
      item.cost += session.cost
      item.requests += session.requests
      item.lastAt = Math.max(item.lastAt, session.lastAt)
      result.set(id, item)
    }
  }
  return [...result.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/** 今天的账本用量，用于每日额度提醒；与统计范围无关 */
export const ledgerToday = (ledger: UsageLedger, date: string): LedgerExtra =>
  ledgerInRange(ledger, [date])

/** 清除单条上下文记录（所有日期里的该会话） */
export const clearLedgerSession = (id: string) => {
  const ledger = readLedger()
  let changed = false
  for (const day of Object.values(ledger)) {
    if (day.sessions[id]) {
      day.sessions = Object.fromEntries(
        Object.entries(day.sessions).filter(([key]) => key !== id)
      )
      changed = true
    }
  }
  if (changed) {
    writeLedger(ledger)
  }
}

/** 清空全部上下文记录，保留语音等附加用量 */
export const clearLedgerSessions = () => {
  const ledger = readLedger()
  for (const day of Object.values(ledger)) {
    day.sessions = {}
  }
  writeLedger(ledger)
}

/** 上下文记录表格里被用户清除的会话 id；清除后即使会话还在也不再展示 */
export const readHiddenRecords = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === 'string'))
      : new Set()
  } catch {
    return new Set()
  }
}

const writeHiddenRecords = (ids: ReadonlySet<string>) => {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids]))
  } catch {
    // 忽略存储不可用
  }
}

export const hideRecord = (id: string) => {
  const hidden = readHiddenRecords()
  hidden.add(id)
  writeHiddenRecords(hidden)
}

export const hideAllRecords = (ids: readonly string[]) => {
  const hidden = readHiddenRecords()
  for (const id of ids) {
    hidden.add(id)
  }
  writeHiddenRecords(hidden)
}

export const clearLedger = () => {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(HIDDEN_KEY)
    localStorage.removeItem(TODAY_KEY)
    localStorage.removeItem(REMINDED_KEY)
  } catch {
    // 忽略存储不可用
  }
}
