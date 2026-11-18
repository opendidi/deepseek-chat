import { formatDate } from '../../utils/format.js'
import { BUILTIN_MODELS, modelDisplayName } from '../models.js'
import { readActiveSessionId } from './activeSession.js'
import * as db from './db.js'
import type { Message } from './types.js'
import { ledgerInRange, readLedger } from './usageLedger.js'
import { RANGE_DAYS, usageDates, type UsageRange } from './usageRange.js'

/** 附加用量单价（¥）；服务端搜索免费开关关闭时按旧规则计费 */
export const EXTRA_PRICES = {
  legacySearch: 0.005, // 5 元 / 1000 次
  pageFetch: 0.0015, // 元 / 页
  ttsChar: 0.0003, // 元 / 字符
  asrSecond: 0.00021666666666666668, // 元 / 秒
} as const

const DAY = 86_400_000
const CONTEXT_WINDOW = 1_000_000
const OUTPUT_RESERVE = 8_200

const pricesOf = (model: string | null): [number, number, number] => {
  const found = BUILTIN_MODELS.find((item) => item.id === model) ?? BUILTIN_MODELS[0]
  return (found.prices ?? BUILTIN_MODELS[0].prices ?? ['0.02', '1.00', '4.00']).map(Number) as [
    number,
    number,
    number,
  ]
}

/** 官方定价页口径：工作日 9:00–12:00、14:00–18:00 为高峰，费用翻倍 */
const peakFactor = (time: number): number => {
  const date = new Date(time)
  const weekday = date.getDay()
  if (weekday === 0 || weekday === 6) {
    return 1
  }
  const hour = date.getHours() + date.getMinutes() / 60
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18) ? 2 : 1
}

/** 中英文按不同字符权重粗估 token，仅用于上下文占用展示 */
const estimateTokens = (text: string): number => {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return Math.round(cjk + (text.length - cjk) / 4)
}

const messageText = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .map((block) =>
      block.type === 'text'
        ? block.text
        : block.type === 'thinking'
          ? block.thinking
          : ''
    )
    .join('')
}

export type UsageTotals = {
  cost: number
  replies: number
  sessions: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  modelCalls: number
  webSearch: number
  pageFetch: number
  ttsChars: number
  asrSeconds: number
}

export type DailyUsage = { date: string; cost: number; tokens: number; replies: number }
export type ModelUsage = { model: string; name: string; tokens: number; cost: number; replies: number }
export type SessionUsage = { id: string; title: string; tokens: number; cost: number; replies: number }

export type DetailedUsage = {
  range: UsageRange
  generatedAt: number
  totals: UsageTotals
  daily: DailyUsage[]
  byModel: ModelUsage[]
  bySession: SessionUsage[]
  context: { current: number; total: number; tracked: number; window: number; reserve: number }
}

const emptyTotals = (): UsageTotals => ({
  cost: 0,
  replies: 0,
  sessions: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  modelCalls: 0,
  webSearch: 0,
  pageFetch: 0,
  ttsChars: 0,
  asrSeconds: 0,
})

/** 扫描本地会话聚合成统计页所需的全部指标；只在打开/切换范围时调用 */
export const collectDetailedUsage = async (
  range: UsageRange,
  freeServerTools: boolean
): Promise<DetailedUsage> => {
  const now = Date.now()
  const dates = usageDates(range, now)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const start = today.getTime() - (RANGE_DAYS[range] - 1) * DAY
  const allowed = new Set(dates)

  const totals = emptyTotals()
  const dailyMap = new Map<string, DailyUsage>(
    dates.map((date) => [date, { date, cost: 0, tokens: 0, replies: 0 }])
  )
  const modelMap = new Map<string, ModelUsage>()
  const sessionMap = new Map<string, SessionUsage>()
  const activeId = readActiveSessionId()
  let currentContext = 0
  let totalContext = 0
  let trackedSessions = 0

  const summaries = await db.loadSessionSummaries()
  for (const summary of summaries) {
    const session = await db.loadSession(summary.id)
    if (!session) {
      continue
    }
    trackedSessions += 1
    let sessionContext = 0
    for (const message of session.messages) {
      sessionContext += estimateTokens(messageText(message))
    }
    totalContext += sessionContext
    if (summary.id === activeId) {
      currentContext = sessionContext
    }

    for (const message of session.messages) {
      if (message.role !== 'assistant' || message.createdAt < start) {
        continue
      }
      const usage = message.usage
      const input = usage
        ? usage.input_tokens + usage.cache_creation_input_tokens
        : 0
      const cached = usage?.cache_read_input_tokens ?? 0
      const output = usage?.output_tokens ?? 0
      const tokens = input + cached + output
      const [hitPrice, inputPrice, outputPrice] = pricesOf(message.model)
      const tokenCost =
        ((cached * hitPrice + input * inputPrice + output * outputPrice) / 1_000_000) *
        peakFactor(message.createdAt)
      const webSearch = usage?.server_tool_use?.web_search_requests ?? 0
      const pageFetch = message.blocks.filter(
        (block) =>
          block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result'
      ).length
      const extraCost = freeServerTools
        ? 0
        : webSearch * EXTRA_PRICES.legacySearch + pageFetch * EXTRA_PRICES.pageFetch
      const cost = tokenCost + extraCost

      totals.cost += cost
      totals.replies += 1
      totals.modelCalls += 1
      totals.inputTokens += input
      totals.cachedTokens += cached
      totals.outputTokens += output
      totals.webSearch += webSearch
      totals.pageFetch += pageFetch

      const dateKey = formatDate(message.createdAt)
      if (dateKey && allowed.has(dateKey)) {
        const day = dailyMap.get(dateKey)
        if (day) {
          day.cost += cost
          day.tokens += tokens
          day.replies += 1
        }
      }

      const modelId = message.model ?? BUILTIN_MODELS[0].id
      const model = modelMap.get(modelId) ?? {
        model: modelId,
        name: modelDisplayName(modelId),
        tokens: 0,
        cost: 0,
        replies: 0,
      }
      model.tokens += tokens
      model.cost += cost
      model.replies += 1
      modelMap.set(modelId, model)

      const item = sessionMap.get(summary.id) ?? {
        id: summary.id,
        title: summary.title,
        tokens: 0,
        cost: 0,
        replies: 0,
      }
      item.tokens += tokens
      item.cost += cost
      item.replies += 1
      sessionMap.set(summary.id, item)
    }
  }

  const media = ledgerInRange(readLedger(), dates)
  totals.ttsChars = media.ttsChars
  totals.asrSeconds = media.asrSeconds
  totals.cost +=
    media.ttsChars * EXTRA_PRICES.ttsChar + media.asrSeconds * EXTRA_PRICES.asrSecond
  totals.sessions = sessionMap.size

  return {
    range,
    generatedAt: now,
    totals,
    daily: [...dailyMap.values()],
    byModel: [...modelMap.values()].sort((a, b) => b.tokens - a.tokens),
    bySession: [...sessionMap.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 8),
    context: {
      current: currentContext,
      total: totalContext,
      tracked: trackedSessions,
      window: CONTEXT_WINDOW,
      reserve: OUTPUT_RESERVE,
    },
  }
}
