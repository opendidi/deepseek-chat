import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildAmapCardView,
  buildMarkerLink,
  buildRouteLink,
  formatDistance,
  formatDuration,
} from '../src/utils/amapCard.js'

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

test('卡片视图：POI 结果提取地点链接（无地图图片）', () => {
  const view = buildAmapCardView('amap_place_search', {
    pois: [{ name: '顺峰山公园', address: '南国东路', location: '113.28,22.83' }],
  })
  assert.ok(view)
  assert.equal(view.pois.length, 1)
  assert.equal(view.pois[0].name, '顺峰山公园')
  assert.equal(view.routeMeta, null)
  assert.equal(view.weatherText, null)
  assert.ok(view.mapLink?.startsWith('https://uri.amap.com/marker'))
})

test('卡片视图：地理编码映射为 POI，weather 文案组装', () => {
  const geo = buildAmapCardView('amap_geocode', {
    geocodes: [{ formatted_address: '顺德区顺峰山公园', location: '113.28,22.83' }],
  })
  assert.ok(geo)
  assert.equal(geo.pois[0].name, '顺德区顺峰山公园')
  assert.ok(geo.mapLink?.startsWith('https://uri.amap.com/marker'))

  const weather = buildAmapCardView('amap_weather', {
    weather: '晴',
    temperature: '28',
    winddirection: '东南',
  })
  assert.ok(weather)
  assert.equal(weather.weatherText, '晴 28°C · 东南')
  assert.equal(weather.pois.length, 0)
  assert.equal(weather.mapLink, null)
})

test('卡片视图：路线生成导航链接与距离耗时', () => {
  const view = buildAmapCardView('amap_route_planning', {
    origin: '北京西站',
    destination: '首都机场 T3',
    origin_point: '116.32,39.89',
    destination_point: '116.60,40.08',
    distance_meters: 35200,
    duration_seconds: 2700,
    mode: 'walking',
  })
  assert.ok(view)
  assert.equal(view.pois.length, 0)
  assert.deepEqual(view.routeMeta, { distanceMeters: 35200, durationSeconds: 2700 })
  assert.ok(view.mapLink?.startsWith('https://uri.amap.com/navigation'))
  const link = new URL(view.mapLink ?? 'http://x')
  assert.equal(link.searchParams.get('from'), '116.32,39.89')
  assert.equal(link.searchParams.get('to'), '116.60,40.08')
  assert.equal(link.searchParams.get('mode'), 'walk')
})

test('卡片视图：路线缺起终点坐标时无导航链接', () => {
  const view = buildAmapCardView('amap_route_planning', { origin: '甲', destination: '乙' })
  assert.ok(view)
  assert.equal(view.mapLink, null)
  assert.deepEqual(view.routeMeta, { distanceMeters: 0, durationSeconds: 0 })
})

test('卡片视图：非法 JSON 数据返回 null', () => {
  assert.equal(buildAmapCardView('amap_place_search', null), null)
})
