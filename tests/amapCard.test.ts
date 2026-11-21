import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildAmapCardView,
  buildMarkerLink,
  buildRouteLink,
  buildStaticMapUrl,
  formatDistance,
  formatDuration,
  parseLocation,
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

test('parseLocation：合法坐标解析，非法输入返回 null', () => {
  assert.deepEqual(parseLocation('116.397,39.918'), [116.397, 39.918])
  assert.equal(parseLocation(''), null)
  assert.equal(parseLocation('116.397'), null)
  assert.equal(parseLocation('abc,39.9'), null)
  assert.equal(parseLocation('116.397,'), null)
})

test('卡片视图：POI 结果提取地点与标记名', () => {
  const view = buildAmapCardView('amap_place_search', {
    pois: [{ name: '顺峰山公园', address: '南国东路', location: '113.28,22.83' }],
  })
  assert.ok(view)
  assert.deepEqual(view.locations, ['113.28,22.83'])
  assert.deepEqual(view.labels, ['顺峰山公园'])
  assert.equal(view.route, null)
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

  const weather = buildAmapCardView('amap_weather', {
    weather: '晴',
    temperature: '28',
    winddirection: '东南',
  })
  assert.ok(weather)
  assert.equal(weather.weatherText, '晴 28°C · 东南')
  assert.equal(weather.locations.length, 0)
})

test('卡片视图：路线提取起终点标签与折线查询参数', () => {
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
  assert.deepEqual(view.locations, ['116.32,39.89', '116.60,40.08'])
  assert.deepEqual(view.labels, ['北京西站', '首都机场 T3'])
  assert.deepEqual(view.route, { origin: '北京西站', destination: '首都机场 T3', mode: 'walking' })
  assert.deepEqual(view.routeMeta, { distanceMeters: 35200, durationSeconds: 2700 })
  assert.ok(view.mapLink?.startsWith('https://uri.amap.com/navigation'))
})

test('卡片视图：路线缺起终点地址时不生成折线查询参数', () => {
  const view = buildAmapCardView('amap_route_planning', {
    origin_point: '116.32,39.89',
    destination_point: '116.60,40.08',
  })
  assert.ok(view)
  assert.equal(view.route, null)
})

test('卡片视图：非法 JSON 数据返回 null', () => {
  assert.equal(buildAmapCardView('amap_place_search', null), null)
})
