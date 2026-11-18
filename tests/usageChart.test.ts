import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  axisLabel,
  calendarCells,
  chartIndexAt,
  chartLabelIndices,
  dayOfMonth,
  formatMoney,
  heatLevel,
  metricText,
  metricValue,
  shortDate,
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

test('热力图按峰值分四级', () => {
  assert.equal(heatLevel(0, 100), 0)
  assert.equal(heatLevel(20, 100), 1)
  assert.equal(heatLevel(50, 100), 2)
  assert.equal(heatLevel(80, 100), 3)
})

test('光标横向位置换算到日期列', () => {
  assert.equal(chartIndexAt(0, 30), 0)
  assert.equal(chartIndexAt(0.5, 30), 15)
  assert.equal(chartIndexAt(1.2, 30), 29)
  assert.equal(chartIndexAt(-0.2, 30), 0)
  assert.equal(chartIndexAt(0.9, 7), 6)
})

test('日历格子按周一补前置空格并补齐整周', () => {
  // 2026-11-18 是周三，前面补周一、周二两个空格
  const days = ['2026-11-18', '2026-11-19', '2026-11-20'].map((date) => ({
    date,
    tokens: 1,
    cost: 0,
    replies: 1,
  }))
  const cells = calendarCells(days)
  assert.equal(cells.length, 7)
  assert.equal(cells[0], null)
  assert.equal(cells[1], null)
  assert.equal(cells[2]?.date, '2026-11-18')
  assert.equal(cells[4]?.date, '2026-11-20')
  assert.equal(cells[5], null)
  assert.equal(cells[6], null)
  assert.equal(dayOfMonth('2026-11-08'), '8')
  assert.equal(dayOfMonth('2026-11-18'), '18')
})

test('30 天日历保持整周且真实天数不变', () => {
  const days = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, '0')}`,
  }))
  const cells = calendarCells(days)
  assert.equal(cells.length % 7, 0)
  assert.equal(cells.filter((cell) => cell !== null).length, 30)
})
