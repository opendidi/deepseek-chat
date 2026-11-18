import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  axisLabel,
  chartLabelIndices,
  formatMoney,
  heatLevel,
  metricText,
  metricValue,
  padHeatDays,
  shortDate,
  weekdayLabels,
} from '../src/utils/usageChart.js'

test('Y 轴刻度按指标缩写', () => {
  assert.equal(axisLabel(39_808, 'tokens'), '40k')
  assert.equal(axisLabel(1_500, 'replies'), '1.5k')
  assert.equal(axisLabel(0, 'tokens'), '0')
  assert.equal(axisLabel(0, 'cost'), '¥0')
  assert.equal(axisLabel(0.003, 'cost'), '¥0.003')
  assert.equal(axisLabel(1.25, 'cost'), '¥1.3')
})

test('指标取值与展示格式化', () => {
  const day = { date: '2026-11-18', tokens: 1200, cost: 0.003, replies: 4 }
  assert.equal(metricValue(day, 'tokens'), 1200)
  assert.equal(metricValue(day, 'cost'), 0.003)
  assert.equal(metricValue(day, 'replies'), 4)
  assert.equal(metricText(0.003, 'cost'), '¥0.0030')
  assert.equal(formatMoney(1.25), '¥1.25')
})

test('日期缩写与坐标轴刻度索引', () => {
  assert.equal(shortDate('2026-11-08'), '11/8')
  assert.equal(shortDate(''), '')
  assert.deepEqual([...chartLabelIndices(7)], [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual([...chartLabelIndices(30)], [0, 8, 15, 23, 29])
})

test('热力图补齐到整周且按峰值分四级', () => {
  const days = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, '0')}`,
    tokens: 0,
    cost: 0,
    replies: 0,
  }))
  const padded = padHeatDays(days)
  assert.equal(padded.length, 35)
  assert.equal(padded[30], null)
  assert.equal(padded.filter((day) => day !== null).length, 30)
  assert.equal(heatLevel(0, 100), 0)
  assert.equal(heatLevel(20, 100), 1)
  assert.equal(heatLevel(50, 100), 2)
  assert.equal(heatLevel(80, 100), 3)
})

test('星期标签按首日星期轮换', () => {
  // 2026-11-18 是周三：第一行从「三」开始
  assert.deepEqual(weekdayLabels('2026-11-18', '一二三四五六日'.split('')), [
    '三',
    '四',
    '五',
    '六',
    '日',
    '一',
    '二',
  ])
  assert.deepEqual(weekdayLabels('', 'MTWTFSS'.split('')), [
    'M',
    'T',
    'W',
    'T',
    'F',
    'S',
    'S',
  ])
})
