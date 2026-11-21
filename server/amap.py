"""高德 Web 服务 API 的服务端代理逻辑：Key 保存在服务器环境（AMAP_KEY），浏览器不接触。

四个能力（地点搜索 / 地理编码 / 实时天气 / 路线规划）在这里完成上游调用与结果精简，
浏览器侧工具只做参数透传；Key 未配置时抛 AmapError('AMAP_KEY_MISSING')，
由路由层转成 400，前端据此给出部署引导提示。
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

from .config import AMAP_KEY

AMAP_BASE = 'https://restapi.amap.com'
AMAP_TIMEOUT = 10


class AmapError(Exception):
    """高德接口错误：message 面向用户可读；AMAP_KEY_MISSING 由路由层固定返回"""


def _compact_poi(poi: dict) -> dict:
    district = ''.join(str(poi.get(key) or '') for key in ('pname', 'cityname', 'adname'))
    return {
        'name': poi.get('name'),
        'address': poi.get('address') or '',
        'location': poi.get('location'),
        'district': district,
    }


def _compact_geocode(geo: dict) -> dict:
    return {
        'formatted_address': geo.get('formatted_address'),
        'location': geo.get('location'),
        'adcode': geo.get('adcode'),
        'level': geo.get('level'),
    }


def _amap_get(path: str, params: dict[str, str], timeout: int = AMAP_TIMEOUT) -> dict:
    if not AMAP_KEY:
        raise AmapError('AMAP_KEY_MISSING')
    query = urllib.parse.urlencode({'key': AMAP_KEY, **params})
    request = urllib.request.Request(f'{AMAP_BASE}{path}?{query}')
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def _require_amap_key() -> None:
    if not AMAP_KEY:
        raise AmapError('AMAP_KEY_MISSING')


def static_map(
    markers: str,
    location: str | None = None,
    zoom: int = 13,
    size: str = '540*320',
) -> bytes:
    """静态地图出图：按标记与中心点渲染 PNG 字节（供聊天中的地图卡片显示）"""
    if not AMAP_KEY:
        raise AmapError('AMAP_KEY_MISSING')
    params = {'markers': markers, 'zoom': str(zoom), 'size': size}
    if location:
        params['location'] = location
    query = urllib.parse.urlencode({'key': AMAP_KEY, **params})
    request = urllib.request.Request(f'{AMAP_BASE}/v3/staticmap?{query}')
    with urllib.request.urlopen(request, timeout=AMAP_TIMEOUT) as response:
        return response.read()


def place_search(keywords: str, city: str | None = None) -> dict:
    _require_amap_key()
    data = _amap_get('/v3/place/text', {'keywords': keywords, 'city': city, 'offset': 5, 'page': 1})
    pois = data.get('pois') or []
    return {'count': len(pois), 'pois': [_compact_poi(poi) for poi in pois]}


def geocode(address: str, city: str | None = None) -> dict:
    _require_amap_key()
    data = _amap_get('/v3/geocode/geo', {'address': address, 'city': city})
    geocodes = data.get('geocodes') or []
    if not geocodes:
        return {'found': False}
    return {'count': len(geocodes), 'geocodes': [_compact_geocode(geo) for geo in geocodes[:3]]}


def _adcode_of(city: str) -> str:
    data = _amap_get('/v3/geocode/geo', {'address': city, 'city': city})
    geocodes = data.get('geocodes') or []
    adcode = geocodes[0].get('adcode') if geocodes else None
    if not adcode:
        raise AmapError(f'找不到城市：{city}')
    return str(adcode)


def weather(city: str) -> dict:
    """实况天气：天气接口需要 adcode，先地理编码再查实况（两步合一）"""
    _require_amap_key()
    adcode = _adcode_of(city)
    data = _amap_get('/v3/weather/weatherInfo', {'city': adcode, 'extensions': 'base'})
    lives = data.get('lives') or []
    if not lives:
        return {'found': False, 'city': city}
    return {'city': city, **lives[0]}


def route_planning(origin_address: str, destination_address: str, mode: str = 'driving') -> dict:
    """路线规划摘要：起终点地址先转坐标，再按驾车 / 步行查询，返回距离耗时与前几步指引"""
    _require_amap_key()
    origin = _amap_get('/v3/geocode/geo', {'address': origin_address})
    destination = _amap_get('/v3/geocode/geo', {'address': destination_address})
    origin_point = (origin.get('geocodes') or [{}])[0].get('location')
    destination_point = (destination.get('geocodes') or [{}])[0].get('location')
    if not origin_point or not destination_point:
        return {'found': False, 'reason': '起点或目的地无法解析为坐标'}
    data = _route_data(origin_point, destination_point, mode)
    route = data.get('route') or {}
    paths = route.get('paths') or []
    if not paths:
        return {'found': False, 'reason': '未找到可行路线'}
    best = paths[0]
    steps = [step.get('instruction') or '' for step in (best.get('steps') or [])]
    return {
        'mode': mode,
        'origin': origin_address,
        'destination': destination_address,
        'origin_point': origin_point,
        'destination_point': destination_point,
        'distance_meters': int(float(best.get('distance') or 0)),
        'duration_seconds': int(float(best.get('duration') or 0)),
        'steps': steps[:6],
    }


def route_line_points(origin_address: str, destination_address: str, mode: str = 'driving') -> dict:
    """路线折线：只返回最佳路径的坐标串，供交互地图绘制路线（不占工具结果，按需由地图卡片拉取）"""
    _require_amap_key()
    origin = _amap_get('/v3/geocode/geo', {'address': origin_address})
    destination = _amap_get('/v3/geocode/geo', {'address': destination_address})
    origin_point = (origin.get('geocodes') or [{}])[0].get('location')
    destination_point = (destination.get('geocodes') or [{}])[0].get('location')
    if not origin_point or not destination_point:
        return {'found': False}
    data = _route_data(origin_point, destination_point, mode)
    paths = (data.get('route') or {}).get('paths') or []
    if not paths:
        return {'found': False}
    points: list[list[float]] = []
    for step in paths[0].get('steps') or []:
        for pair in str(step.get('polyline') or '').split(';'):
            lng, _, lat = pair.partition(',')
            try:
                point = [float(lng), float(lat)]
            except ValueError:
                continue
            # 相邻步骤的接驳点重复，去重后再交给前端绘制
            if not points or points[-1] != point:
                points.append(point)
    return {'found': True, 'points': points}


def _route_data(origin_point: str, destination_point: str, mode: str) -> dict:
    path = '/v3/direction/walking' if mode == 'walking' else '/v3/direction/driving'
    return _amap_get(path, {'origin': origin_point, 'destination': destination_point},
                     timeout=AMAP_TIMEOUT * 2)
