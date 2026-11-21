/**
 * 统计页与输入栏统计弹窗共用的聚合层：扫描本地会话消息得到准确用量，
 * 再合并本机账本里的语音附加用量与「会话已删除」的历史记录。
 * 账本只记聚合数字，不参与 token 明细的双算。
 */
import { formatDate } from '../../utils/format.js'
import { DAY_MS } from '../../utils/time.js'
import { heatWindowDates, percent } from '../../utils/usageChart.js'
import { BUILTIN_MODELS, modelDisplayName } from '../models.js'
import { useSettings } from '../settings.js'
import { readActiveSessionId } from './activeSession.js'
import * as db from './db.js'
import { systemPromptFor } from './requestShape.js'
import {
  resolveChatTools,
  summarizeToolSteps,
  toolDefinitionText,
  type ToolStats,
} from '../agent/toolPolicy.js'
import type { Message, ToolStep } from './types.js'
import {
  ledgerInRange,
  ledgerSessions,
  readHiddenRecords,
  readLedger,
  readTodayUsage,
  type TodayUsage,
  type UsageLedger,
} from './usageLedger.js'
import {
  CONTEXT_COMPRESS_RATIO,
  CONTEXT_WINDOW,
  OUTPUT_RESERVE,
  estimateRequestCost,
  estimateTokens,
  mediaCost,
  modelPrices,
  type TokenPrices,
} from './usagePricing.js'
import { RANGE_DAYS, usageDates, type UsageRange } from './usageRange.js'


export type CompositionKey =
  | 'usageCompositionMiss'
  | 'usageCompositionHit'
  | 'usageCompositionWrite'
  | 'usageCompositionOutput'

export type ContextCategoryKey =
  | 'usageContextCategorySystem'
  | 'usageContextCategoryTools'
  | 'usageContextCategoryUser'
  | 'usageContextCategoryReply'
  | 'usageContextCategoryThinking'
  | 'usageContextCategoryToolCall'
  | 'usageContextCategoryToolResult'
  | 'usageContextCategoryAttachment'

export type UsageTotals = {
  cost: number
  tokens: number
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  cacheHitRate: number
  replies: number
  modelCalls: number
  activeDays: number
  sessions: number
  webSearch: number
  pageFetch: number
  ttsChars: number
  asrSeconds: number
}

export type DailyUsage = {
  date: string
  cost: number
  tokens: number
  replies: number
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}

export type ShareItem = { key: CompositionKey | ContextCategoryKey; tokens: number; share: number }
export type ModelUsage = { model: string; name: string; tokens: number; cost: number; replies: number }
export type SessionUsage = {
  id: string
  title: string
  tokens: number
  cost: number
  replies: number
  lastAt: number
  /** 会话已删除，排行榜里的「打开」按钮需要置灰 */
  deleted: boolean
}
export type ContextRecord = {
  id: string
  title: string
  tokens: number
  percent: number
  lastAt: number
  exists: boolean
}
export type ContextInfo = {
  current: number
  total: number
  tracked: number
  window: number
  reserve: number
  compressAt: number
  remaining: number
}
export type CurrentSessionUsage = {
  outputs: number[]
  last7: { date: string; tokens: number }[]
  composition: ShareItem[]
  webSearch: number
  pageFetch: number
  files: number
  context: number
}

export type DetailedUsage = {
  range: UsageRange
  generatedAt: number
  totals: UsageTotals
  daily: DailyUsage[]
  hourly: number[]
  composition: ShareItem[]
  contextBreakdown: ShareItem[]
  byModel: ModelUsage[]
  bySession: SessionUsage[]
  /** 固定最近 8 周，不受统计范围影响 */
  heatmap: { date: string; tokens: number; cost: number; replies: number }[]
  billing: { model: string; name: string; prices: TokenPrices }[]
  context: ContextInfo
  contextRecords: ContextRecord[]
  currentSession: CurrentSessionUsage
  /** 工具调用次数、失败率、耗时与按工具分布 */
  tools: ToolStats
  /** 独立于 400 天账本的今日聚合 */
  today: TodayUsage
  ledger: UsageLedger
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

const jsonText = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    // 循环引用等极端值放弃序列化，只影响展示不影响统计
    return ''
  }
}

const shareItems = (
  entries: readonly { key: ShareItem['key']; tokens: number }[]
): ShareItem[] => {
  const total = entries.reduce((sum, item) => sum + item.tokens, 0)
  return entries.map((item) => ({ ...item, share: percent(item.tokens, total) }))
}

/** 当前会话最近一轮请求的上下文分类：按字符权重估算，仅用于展示 */
const contextCategories = (
  messages: readonly Message[],
  definitionText: string,
  systemPrompt: string,
  baseSystemPrompt: string
): ShareItem[] => {
  const lastAssistantIndex = messages.findLastIndex((item) => item.role === 'assistant')
  const assistant = lastAssistantIndex >= 0 ? messages[lastAssistantIndex] : undefined
  const userIndex = messages
    .slice(0, Math.max(0, lastAssistantIndex))
    .findLastIndex((item) => item.role === 'user')
  const user = userIndex >= 0 ? messages[userIndex] : undefined
  const blocks = assistant?.role === 'assistant' ? assistant.blocks : []
  const steps = assistant?.role === 'assistant' ? (assistant.toolSteps ?? []) : []

  const textOf = (type: 'text' | 'thinking') =>
    blocks
      .map((block) => {
        if (type === 'text') {
          return block.type === 'text' ? block.text : ''
        }
        return block.type === 'thinking' ? block.thinking : ''
      })
      .join('')

  const toolCalls = blocks.filter((block) => block.type === 'server_tool_use')
  const toolResults = blocks.filter(
    (block) =>
      block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result'
  )

  const entries: { key: ContextCategoryKey; tokens: number }[] = [
    {
      key: 'usageContextCategorySystem',
      tokens: estimateTokens(
        [baseSystemPrompt, systemPrompt, assistant?.role === 'assistant' ? assistant.latestReminder : '']
          .filter(Boolean)
          .join('\n\n')
      ),
    },
    { key: 'usageContextCategoryTools', tokens: estimateTokens(definitionText) },
    { key: 'usageContextCategoryUser', tokens: estimateTokens(user?.role === 'user' ? user.content : '') },
    { key: 'usageContextCategoryReply', tokens: estimateTokens(textOf('text')) },
    { key: 'usageContextCategoryThinking', tokens: estimateTokens(textOf('thinking')) },
    {
      key: 'usageContextCategoryToolCall',
      tokens: estimateTokens(
        [...toolCalls.map(jsonText), ...steps.map((step) => step.inputJson)].join('\n')
      ),
    },
    {
      key: 'usageContextCategoryToolResult',
      tokens: estimateTokens(
        [...toolResults.map(jsonText), ...steps.map((step) => step.result ?? '')].join('\n')
      ),
    },
    {
      key: 'usageContextCategoryAttachment',
      tokens:
        user?.role === 'user'
          ? estimateTokens(user.files.map((file) => `${file.name} ${file.size}`).join('\n'))
          : 0,
    },
  ]
  return shareItems(entries)
}

const emptyDaily = (date: string): DailyUsage => ({
  date,
  cost: 0,
  tokens: 0,
  replies: 0,
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
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
  const start = today.getTime() - (RANGE_DAYS[range] - 1) * DAY_MS
  const allowed = new Set(dates)

  const last7Dates = usageDates('7d', now)
  const last7Map = new Map<string, number>(last7Dates.map((date) => [date, 0]))
  const heatDates = heatWindowDates(now)
  const heatSet = new Set(heatDates)
  const heatMap = new Map<string, { date: string; tokens: number; cost: number; replies: number }>(
    heatDates.map((date) => [date, { date, tokens: 0, cost: 0, replies: 0 }])
  )

  const totals: UsageTotals = {
    cost: 0,
    tokens: 0,
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    cacheHitRate: 0,
    replies: 0,
    modelCalls: 0,
    activeDays: 0,
    sessions: 0,
    webSearch: 0,
    pageFetch: 0,
    ttsChars: 0,
    asrSeconds: 0,
  }
  const dailyMap = new Map<string, DailyUsage>(dates.map((date) => [date, emptyDaily(date)]))
  const modelMap = new Map<string, ModelUsage>()
  const sessionMap = new Map<string, SessionUsage>()
  const contextRecords = new Map<string, ContextRecord>()
  const hourly = Array<number>(24).fill(0)
  const activeId = readActiveSessionId()
  const settings = useSettings.getState()
  const policy = resolveChatTools({
    mode: settings.chatMode,
    search: settings.search,
    agentTools: settings.agentTools,
    enabledTools: new Set(settings.enabledToolNames),
    locale: settings.locale,
  })
  const toolSteps: ToolStep[] = []
  const currentOutputs: number[] = []
  const currentComposition = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
  let currentWebSearch = 0
  let currentPageFetch = 0
  const currentFiles = new Set<string>()
  let currentContext = 0
  let totalContext = 0
  let trackedSessions = 0
  let activeMessages: readonly Message[] = []

  const summaries = await db.loadSessionSummaries()
  const hiddenRecords = readHiddenRecords()
  for (const summary of summaries) {
    const session = await db.loadSession(summary.id)
    if (!session) {
      continue
    }
    trackedSessions += 1
    let sessionContext = 0
    for (const message of session.messages) {
      sessionContext += estimateTokens(messageText(message))
      if (summary.id === activeId && message.role === 'user') {
        for (const file of message.files) {
          currentFiles.add(file.id)
        }
      }
    }
    totalContext += sessionContext
    if (summary.id === activeId) {
      currentContext = sessionContext
      activeMessages = session.messages
    }
    const lastAt =
      [...session.messages].reverse().find((item) => item.role === 'assistant')?.createdAt ??
      summary.updatedAt
    if (!hiddenRecords.has(summary.id)) {
      contextRecords.set(summary.id, {
        id: summary.id,
        title: summary.title,
        tokens: sessionContext,
        percent: percent(sessionContext, CONTEXT_WINDOW),
        lastAt,
        exists: true,
      })
    }

    for (const message of session.messages) {
      if (message.role !== 'assistant') {
        continue
      }
      const usage = message.usage
      const input = usage?.input_tokens ?? 0
      const cacheWrite = usage?.cache_creation_input_tokens ?? 0
      const cacheRead = usage?.cache_read_input_tokens ?? 0
      const output = usage?.output_tokens ?? 0
      const tokens = input + cacheWrite + cacheRead + output
      const webSearch = usage?.server_tool_use?.web_search_requests ?? 0
      const pageFetch = message.blocks.filter(
        (block) =>
          block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result'
      ).length
      const cost = estimateRequestCost({
        model: message.model,
        at: message.createdAt,
        parts: { input, cacheWrite, cacheRead, output, webSearch, pageFetch },
        freeServerTools,
      })
      const dateKey = formatDate(message.createdAt)

      // 热力图覆盖固定 8 周，与上面的统计范围解耦
      if (dateKey && heatSet.has(dateKey)) {
        const heatDay = heatMap.get(dateKey)
        if (heatDay) {
          heatDay.tokens += tokens
          heatDay.cost += cost
          heatDay.replies += 1
        }
      }
      if (dateKey && last7Map.has(dateKey)) {
        last7Map.set(dateKey, (last7Map.get(dateKey) ?? 0) + tokens)
      }
      if (summary.id === activeId) {
        if (usage) {
          currentOutputs.push(output)
        }
        currentComposition.input += input
        currentComposition.cacheWrite += cacheWrite
        currentComposition.cacheRead += cacheRead
        currentComposition.output += output
        currentWebSearch += webSearch
        currentPageFetch += pageFetch
      }

      if (message.createdAt < start) {
        continue
      }
      if (message.toolSteps) {
        toolSteps.push(...message.toolSteps)
      }
      totals.cost += cost
      totals.replies += 1
      // 一条回答可能包含多轮工具往返，按实际请求轮数统计
      totals.modelCalls += message.requestCount ?? 1
      totals.input += input
      totals.cacheWrite += cacheWrite
      totals.cacheRead += cacheRead
      totals.output += output
      totals.tokens += tokens
      totals.webSearch += webSearch
      totals.pageFetch += pageFetch
      hourly[new Date(message.createdAt).getHours()] += 1

      if (dateKey && allowed.has(dateKey)) {
        const day = dailyMap.get(dateKey)
        if (day) {
          day.cost += cost
          day.tokens += tokens
          day.replies += 1
          day.input += input
          day.cacheWrite += cacheWrite
          day.cacheRead += cacheRead
          day.output += output
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
        lastAt,
        deleted: false,
      }
      item.tokens += tokens
      item.cost += cost
      item.replies += 1
      item.lastAt = Math.max(item.lastAt, message.createdAt)
      sessionMap.set(summary.id, item)
    }
  }

  const ledger = readLedger()
  const extra = ledgerInRange(ledger, dates)
  totals.ttsChars = extra.ttsChars
  totals.asrSeconds = extra.asrSeconds
  totals.cost += mediaCost(totals.ttsChars, totals.asrSeconds)
  totals.activeDays = [...dailyMap.values()].filter((day) => day.replies > 0).length
  totals.cacheHitRate = percent(totals.cacheRead, totals.cacheRead + totals.input + totals.cacheWrite)

  // 账本里的会话记录即使在会话删除后仍保留，用于排行置灰与上下文记录表格
  const existingIds = new Set(summaries.map((item) => item.id))
  for (const record of ledgerSessions(ledger, dates)) {
    if (sessionMap.has(record.id)) {
      continue
    }
    sessionMap.set(record.id, {
      id: record.id,
      title: record.title,
      tokens: record.tokens,
      cost: record.cost,
      replies: record.requests,
      lastAt: record.lastAt,
      deleted: !existingIds.has(record.id),
    })
    if (!hiddenRecords.has(record.id)) {
      contextRecords.set(record.id, {
        id: record.id,
        title: record.title,
        tokens: record.tokens,
        percent: percent(record.tokens, CONTEXT_WINDOW),
        lastAt: record.lastAt,
        exists: existingIds.has(record.id),
      })
    }
  }
  totals.sessions = sessionMap.size

  const composition = shareItems([
    { key: 'usageCompositionMiss' as const, tokens: totals.input },
    { key: 'usageCompositionHit' as const, tokens: totals.cacheRead },
    { key: 'usageCompositionWrite' as const, tokens: totals.cacheWrite },
    { key: 'usageCompositionOutput' as const, tokens: totals.output },
  ])
  const currentShare = shareItems([
    { key: 'usageCompositionMiss' as const, tokens: currentComposition.input },
    { key: 'usageCompositionHit' as const, tokens: currentComposition.cacheRead },
    { key: 'usageCompositionWrite' as const, tokens: currentComposition.cacheWrite },
    { key: 'usageCompositionOutput' as const, tokens: currentComposition.output },
  ])

  return {
    range,
    generatedAt: now,
    totals,
    daily: [...dailyMap.values()],
    hourly,
    composition,
    contextBreakdown: contextCategories(
      activeMessages,
      toolDefinitionText(policy.tools),
      settings.systemPrompt,
      systemPromptFor(settings.locale)
    ),
    tools: summarizeToolSteps(toolSteps),
    byModel: [...modelMap.values()].sort((a, b) => b.tokens - a.tokens),
    bySession: [...sessionMap.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10),
    heatmap: heatDates.map((date) => heatMap.get(date) ?? { date, tokens: 0, cost: 0, replies: 0 }),
    billing: BUILTIN_MODELS.map((model) => ({
      model: model.id,
      name: model.name,
      prices: modelPrices(model.id),
    })),
    context: {
      current: currentContext,
      total: totalContext,
      tracked: trackedSessions,
      window: CONTEXT_WINDOW,
      reserve: OUTPUT_RESERVE,
      compressAt: Math.round((CONTEXT_WINDOW - OUTPUT_RESERVE) * CONTEXT_COMPRESS_RATIO),
      remaining: Math.max(0, CONTEXT_WINDOW - OUTPUT_RESERVE - currentContext),
    },
    contextRecords: [...contextRecords.values()].sort((a, b) => b.lastAt - a.lastAt),
    currentSession: {
      outputs: currentOutputs,
      last7: last7Dates.map((date) => ({ date, tokens: last7Map.get(date) ?? 0 })),
      composition: currentShare,
      webSearch: currentWebSearch,
      pageFetch: currentPageFetch,
      files: currentFiles.size,
      context: currentContext,
    },
    today: readTodayUsage(),
    ledger,
  }
}
