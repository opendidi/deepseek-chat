import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDate } from '../src/utils/format.js'
import { usageDates } from '../src/services/chat/usageRange.js'
import { ledgerInRange } from '../src/services/chat/usageLedger.js'

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

test('ledgerInRange 只汇总范围内的附加用量', () => {
  const ledger = {
    '2026-11-16': { ttsChars: 100, asrSeconds: 10 },
    '2026-11-17': { ttsChars: 10, asrSeconds: 2 },
    '2026-11-18': { ttsChars: 5, asrSeconds: 1 },
  }
  assert.deepEqual(ledgerInRange(ledger, ['2026-11-17', '2026-11-18']), {
    ttsChars: 15,
    asrSeconds: 3,
  })
  assert.deepEqual(ledgerInRange(ledger, []), { ttsChars: 0, asrSeconds: 0 })
})
