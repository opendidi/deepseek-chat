import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildMarkerLink,
  buildRouteLink,
  buildStaticMapUrl,
  formatDistance,
  formatDuration,
} from '../src/utils/amapCard.js'

test('静态地图 URL：markers 组装 + zoom/size', () => {
  const url = buildStaticMapUrl(['116.397,39.918', '116.40,39.90'], 11, '540*320')
  assert.ok(url.startsWith('/api/amap/staticmap?'))
  const params = new URL(url, 'http://x').searchParams
  assert.equal(params.get('zoom'), '11')
  assert.equal(params.get('size'), '540*320')
  assert.equal(params.get('markers'), 'mid,0xFF0000,A:116.397,39.918|mid,0xFF0000,B:116.40,39.90')
})

test('静态地图 URL：跳过空坐标', () => {
  const url = buildStaticMapUrl(['', '116.40,39.90'])
  const markers = new URL(url, 'http://x').searchParams.get('markers')
  assert.equal(markers, 'mid,0xFF0000,A:116.40,39.90')
})

test('地点跳转链接：position + name + src', () => {
  const url = new URL(buildMarkerLink('116.397,39.918', '故宫'))
  assert.equal(url.origin + url.pathname, 'https://uri.amap.com/marker')
  assert.equal(url.searchParams.get('position'), '116.397,39.918')
  assert.equal(url.searchParams.get('name'), '故宫')
  assert.equal(url.searchParams.get('src'), 'deepseek-chat')
})

test('路线跳转链接：起终点 + 出行方式', () => {
  const url = new URL(buildRouteLink('116.1,39.9', '116.5,40.0', 'walking'))
  assert.equal(url.origin + url.pathname, 'https://uri.amap.com/navigation')
  assert.equal(url.searchParams.get('from'), '116.1,39.9')
  assert.equal(url.searchParams.get('to'), '116.5,40.0')
  assert.equal(url.searchParams.get('mode'), 'walk')
  const driving = new URL(buildRouteLink('116.1,39.9', '116.5,40.0', 'driving'))
  assert.equal(driving.searchParams.get('mode'), 'car')
})

test('距离与耗时格式化', () => {
  assert.equal(formatDistance(800), '800 米')
  assert.equal(formatDistance(35200), '35.2 km')
  assert.equal(formatDuration(2700), '45 分钟')
  assert.equal(formatDuration(4500), '1 小时 15 分钟')
  assert.equal(formatDuration(30), '1 分钟')
})
