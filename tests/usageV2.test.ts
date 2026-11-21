import { API_ORIGIN_SHIM } from './helpers/apiOrigin.js'
// 导入链会经过 api/client.js，必须先注入构建期常量
void API_ORIGIN_SHIM
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installMemoryStorage } from './helpers/localStorage.js'
import { formatDate } from '../src/utils/format.js'
import {
  MAX_LEDGER_DAYS,
  clearLedger,
  clearLedgerSession,
  clearLedgerSessions,
  hideAllRecords,
  hideRecord,
  ledgerInRange,
  ledgerSessions,
  normalizeDay,
  readHiddenRecords,
  readLedger,
  readTodayUsage,
  checkDailyQuota,
  recordUsage,
} from '../src/services/chat/usageLedger.js'
import {
  estimateRequestCost,
  modelPrices,
  peakFactor,
  beijingParts,
} from '../src/services/chat/usagePricing.js'
import {
  donutSlices,
  heatWindowDates,
  hourPeak,
  percent,
  sparklinePath,
} from '../src/utils/usageChart.js'
import { maskApiKey } from '../src/utils/maskApiKey.js'

const usage = {
  input_tokens: 100,
  cache_creation_input_tokens: 20,
  cache_read_input_tokens: 300,
  output_tokens: 50,
  server_tool_use: { web_search_requests: 2, tool_search: 0 },
}

test('normalizeDay 补齐 v1 账本与脏字段', () => {
  const v1 = normalizeDay({ ttsChars: 12, asrSeconds: 3 })
  assert.equal(v1.version, 2)
  assert.equal(v1.ttsChars, 12)
  assert.equal(v1.asrSeconds, 3)
  assert.equal(v1.hours.length, 24)
  assert.ok(v1.hours.every((value) => value === 0))
  assert.deepEqual(v1.models, {})
  assert.deepEqual(v1.sessions, {})

  assert.deepEqual(normalizeDay(null), normalizeDay({}))
  const dirty = normalizeDay({
    ttsChars: -5,
    asrSeconds: Number.NaN,
    hours: [3, 'x', 2],
    models: { flash: { input: 'oops', requests: 2 } },
    sessions: { a: { title: 42, tokens: 10 } },
  })
  assert.equal(dirty.ttsChars, 0)
  assert.equal(dirty.asrSeconds, 0)
  assert.equal(dirty.hours[0], 3)
  assert.equal(dirty.hours[1], 0)
  assert.equal(dirty.models.flash.input, 0)
  assert.equal(dirty.models.flash.requests, 2)
  assert.equal(dirty.sessions.a.title, '')
  assert.equal(dirty.sessions.a.tokens, 10)
})

test('损坏的 JSON 当作空账本，不抛异常', () => {
  const { storage } = installMemoryStorage()
  storage.setItem('deepseek-chat:usage-ledger', '{not json')
  assert.deepEqual(readLedger(), {})
  storage.setItem('deepseek-chat:usage-ledger', '[]')
  assert.deepEqual(readLedger(), {})
  clearLedger()
})

test('recordUsage 按日 / 模型 / 会话记账并写 24 小时直方图', () => {
  installMemoryStorage()
  clearLedger()
  const at = Date.now()
  const date = formatDate(at) ?? ''
  const hour = new Date(at).getHours()
  recordUsage({
    at,
    model: 'deepseek-flash',
    sessionId: 'session-a',
    title: '测试会话',
    usage,
    pageFetch: 1,
    freeServerTools: true,
  })
  const ledger = readLedger()
  const day = ledger[date]
  assert.ok(day)
  assert.equal(day.hours[hour], 1)
  assert.equal(day.models['deepseek-flash'].requests, 1)
  assert.equal(day.models['deepseek-flash'].input, 100)
  assert.equal(day.models['deepseek-flash'].cacheWrite, 20)
  assert.equal(day.models['deepseek-flash'].cacheRead, 300)
  assert.equal(day.models['deepseek-flash'].output, 50)
  assert.equal(day.models['deepseek-flash'].webSearch, 2)
  assert.equal(day.models['deepseek-flash'].pageFetch, 1)
  assert.equal(day.sessions['session-a'].title, '测试会话')
  assert.equal(day.sessions['session-a'].tokens, 470)
  assert.equal(day.sessions['session-a'].requests, 1)

  assert.equal(ledgerInRange(ledger, [date]).tokens, 470)
  assert.equal(ledgerSessions(ledger, [date])[0].id, 'session-a')
  assert.equal(readTodayUsage().date, date)
  assert.equal(readTodayUsage().requests, 1)
  assert.equal(readTodayUsage().tokens, 470)
  assert.equal(readTodayUsage().webSearch, 2)
})

test('今日用量跨天归零，额度提醒一天只触发一次', () => {
  const { storage } = installMemoryStorage()
  clearLedger()
  const at = Date.now()
  recordUsage({
    at,
    model: 'deepseek-flash',
    sessionId: 'quota-test',
    title: '',
    usage,
    pageFetch: 0,
    freeServerTools: true,
  })
  assert.equal(readTodayUsage().requests, 1)
  assert.equal(checkDailyQuota(0), null)
  const first = checkDailyQuota(0.000001)
  assert.ok(first && first.cost > 0)
  assert.equal(checkDailyQuota(0.000001), null)
  // 手动把今天的记录改成昨天，读取时应当归零
  storage.setItem(
    'deepseek-chat:usage-today',
    JSON.stringify({ ...readTodayUsage(), date: '2020-01-01' })
  )
  assert.equal(readTodayUsage().requests, 0)
  assert.equal(readTodayUsage().date, formatDate(at))
  clearLedger()
})

test('400 天上限：超出后丢弃最早的记录', () => {
  const { storage } = installMemoryStorage()
  const ledger: Record<string, unknown> = {}
  for (let index = 0; index < MAX_LEDGER_DAYS + 5; index += 1) {
    ledger[`2025-${String(index % 12 + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`] =
      normalizeDay({ ttsChars: 1 })
  }
  storage.setItem('deepseek-chat:usage-ledger', JSON.stringify(ledger))
  // 读回来再写一次触发裁剪
  const at = Date.now()
  recordUsage({
    at,
    model: 'deepseek-flash',
    sessionId: 'trim-check',
    title: '',
    usage,
    pageFetch: 0,
    freeServerTools: true,
  })
  assert.ok(Object.keys(readLedger()).length <= MAX_LEDGER_DAYS)
})

test('清除单条 / 全部上下文记录与隐藏记录', () => {
  installMemoryStorage()
  clearLedger()
  const at = Date.now()
  for (const id of ['a', 'b']) {
    recordUsage({
      at,
      model: 'deepseek-flash',
      sessionId: id,
      title: id,
      usage,
      pageFetch: 0,
      freeServerTools: true,
    })
  }
  const date = formatDate(at) ?? ''
  assert.equal(Object.keys(readLedger()[date].sessions).length, 2)
  clearLedgerSession('a')
  assert.deepEqual(Object.keys(readLedger()[date].sessions), ['b'])
  clearLedgerSessions()
  assert.deepEqual(readLedger()[date].sessions, {})

  hideRecord('x')
  hideAllRecords(['y', 'z'])
  assert.deepEqual([...readHiddenRecords()].sort(), ['x', 'y', 'z'])
  clearLedger()
  assert.equal(readHiddenRecords().size, 0)
})

test('计费按北京时间高峰翻倍，免费开关只影响附加项', () => {
  // UTC 02:00 = 北京周三 10:00，属于工作日高峰
  const weekdayPeak = Date.UTC(2026, 10, 18, 2, 0)
  assert.deepEqual(beijingParts(weekdayPeak), { weekday: 3, hour: 10 })
  assert.equal(peakFactor(weekdayPeak), 2)
  // UTC 02:00 周六 = 北京周六 10:00，不翻倍
  const weekend = Date.UTC(2026, 10, 21, 2, 0)
  assert.equal(peakFactor(weekend), 1)
  // 北京 13:00 是午休非高峰
  const noon = Date.UTC(2026, 10, 18, 5, 0)
  assert.equal(peakFactor(noon), 1)

  const parts = {
    input: 1_000_000,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    webSearch: 100,
    pageFetch: 100,
  }
  const free = estimateRequestCost({
    model: 'deepseek-flash',
    at: weekdayPeak,
    parts,
    freeServerTools: true,
  })
  const legacy = estimateRequestCost({
    model: 'deepseek-flash',
    at: weekdayPeak,
    parts,
    freeServerTools: false,
  })
  assert.equal(free, 2)
  assert.ok(Math.abs(legacy - (2 + 100 * 0.005 + 100 * 0.0015)) < 1e-9)
  assert.deepEqual(modelPrices('unknown-model'), [0.02, 1, 4])
})

test('热力图固定 8 周、环形图/折线/小时峰值纯函数', () => {
  const dates = heatWindowDates(new Date('2026-11-18T12:00:00').getTime())
  assert.equal(dates.length, 56)
  assert.equal(new Date(`${dates[0]}T00:00:00`).getDay(), 1)
  assert.equal(dates.at(-1), '2026-11-22')

  const slices = donutSlices([1, 1, 2, 0])
  assert.equal(slices.length, 4)
  assert.equal(slices[0].length, 25)
  assert.equal(slices[2].offset, 50)
  assert.equal(slices[2].length, 50)
  assert.deepEqual(donutSlices([0, 0]).map((item) => item.share), [0, 0])
  assert.equal(percent(1, 3), 33.3)

  assert.match(sparklinePath([1, 2, 3], 100, 40), /^M .* L .* L /)
  assert.match(sparklinePath([5], 100, 40), /^M .* L /)
  assert.equal(sparklinePath([], 100, 40), '')
  assert.deepEqual(hourPeak(Array(24).fill(0)), null)
  assert.deepEqual(hourPeak([0, 0, 5, 3]), { hour: 2, count: 5 })
})

test('API Key 统一掩码为 sk-**** 加末四位', () => {
  assert.equal(maskApiKey('sk-1234567890abcd'), 'sk-****abcd')
  // 过短的 Key 末四位即本身，整体隐藏
  assert.equal(maskApiKey('short'), 'sk-****')
  assert.equal(maskApiKey('abc'), 'sk-****')
  assert.equal(maskApiKey(null), '—')
  assert.equal(maskApiKey('   '), '—')
})
