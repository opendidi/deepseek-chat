import { API_ORIGIN_SHIM } from './helpers/apiOrigin.js'
// usageLedger 经 usagePricing → models → api/client，导入前需注入构建期常量
void API_ORIGIN_SHIM
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDate } from '../src/utils/format.js'
import { usageDates } from '../src/services/chat/usageRange.js'
import { ledgerInRange, normalizeDay } from '../src/services/chat/usageLedger.js'

test('usageDates 按范围返回升序日期，最后一天是今天', () => {
  const now = new Date('2026-11-18T12:00:00').getTime()
  for (const [range, days] of [
    ['today', 1],
    ['7d', 7],
    ['30d', 30],
  ] as const) {
    const dates = usageDates(range, now)
    assert.equal(dates.length, days)
    assert.ok(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))
    assert.deepEqual(dates, [...dates].sort())
    assert.equal(dates.at(-1), formatDate(now))
  }
})

test('ledgerInRange 只汇总范围内的附加用量与账本请求', () => {
  const ledger = {
    '2026-11-16': normalizeDay({ ttsChars: 100, asrSeconds: 10 }),
    '2026-11-17': normalizeDay({
      ttsChars: 10,
      asrSeconds: 2,
      models: {
        flash: {
          input: 100,
          cacheWrite: 0,
          cacheRead: 50,
          output: 20,
          cost: 0.1,
          requests: 2,
          webSearch: 1,
          pageFetch: 0,
        },
      },
    }),
    '2026-11-18': normalizeDay({ ttsChars: 5, asrSeconds: 1 }),
  }
  const range = ledgerInRange(ledger, ['2026-11-17', '2026-11-18'])
  assert.equal(range.ttsChars, 15)
  assert.equal(range.asrSeconds, 3)
  assert.equal(range.requests, 2)
  assert.equal(range.tokens, 170)
  assert.equal(range.webSearch, 1)
  assert.deepEqual(
    { tts: ledgerInRange(ledger, []).ttsChars, requests: ledgerInRange(ledger, []).requests },
    { tts: 0, requests: 0 }
  )
})
