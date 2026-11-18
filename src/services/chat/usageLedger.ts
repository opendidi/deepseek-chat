/**
 * 本机用量账本：只保存朗读字符数、听写秒数的按天聚合数字，不含对话正文。
 * 服务端提供的 Token 用量来自会话本身，不写入账本。
 */
import { formatDate } from '../../utils/format.js'

const KEY = 'deepseek-chat:usage-ledger'
/** 账本按天保留的上限，超出后丢弃最早的记录 */
const MAX_DAYS = 400

export type LedgerDay = { ttsChars: number; asrSeconds: number }
export type UsageLedger = Record<string, LedgerDay>

const emptyDay = (): LedgerDay => ({ ttsChars: 0, asrSeconds: 0 })

export const readLedger = (): UsageLedger => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const result: UsageLedger = {}
    for (const [date, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') {
        continue
      }
      const day = value as Partial<LedgerDay>
      if (typeof day.ttsChars === 'number' || typeof day.asrSeconds === 'number') {
        result[date] = {
          ttsChars: Number.isFinite(day.ttsChars) ? Math.max(0, day.ttsChars ?? 0) : 0,
          asrSeconds: Number.isFinite(day.asrSeconds) ? Math.max(0, day.asrSeconds ?? 0) : 0,
        }
      }
    }
    return result
  } catch {
    return {}
  }
}

const writeLedger = (ledger: UsageLedger) => {
  const dates = Object.keys(ledger).sort()
  const trimmed: UsageLedger = {}
  for (const date of dates.slice(-MAX_DAYS)) {
    trimmed[date] = ledger[date]
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // 存储不可用时只影响本机附加用量统计
  }
}

const add = (field: keyof LedgerDay, amount: number) => {
  if (!(amount > 0) || !Number.isFinite(amount)) {
    return
  }
  const date = formatDate(Date.now())
  if (!date) {
    return
  }
  const ledger = readLedger()
  const day = ledger[date] ?? emptyDay()
  ledger[date] = { ...day, [field]: day[field] + amount }
  writeLedger(ledger)
}

/** 朗读一段文本时累计合成字符数 */
export const recordTtsChars = (text: string) => add('ttsChars', text.length)

/** 一次听写结束后累计录音秒数 */
export const recordAsrSeconds = (seconds: number) => add('asrSeconds', seconds)

export const ledgerInRange = (ledger: UsageLedger, dates: readonly string[]): LedgerDay => {
  const allowed = new Set(dates)
  return Object.entries(ledger).reduce<LedgerDay>((total, [date, day]) => {
    if (allowed.has(date)) {
      total.ttsChars += day.ttsChars
      total.asrSeconds += day.asrSeconds
    }
    return total
  }, emptyDay())
}

export const clearLedger = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 忽略存储不可用
  }
}
