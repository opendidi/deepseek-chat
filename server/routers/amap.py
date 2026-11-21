"""高德地图代理路由：浏览器 Agent 工具经这里的端点调用高德 Web 服务 API。

Key 保存在服务器环境（AMAP_KEY，可由根目录 .env 提供），浏览器不接触；
未配置时端点返回 400 + AMAP_KEY_MISSING，前端据此给出部署引导提示。
交互地图（JS API）的 Key 另存 AMAP_JS_KEY / AMAP_SECURITY_CODE（jsconfig 下发，
属于浏览器端公开凭据，域名白名单由高德控制台约束）。
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from ..amap import AmapError, geocode, place_search, route_line_points, route_planning, static_map, weather
from ..config import AMAP_JS_KEY, AMAP_SECURITY_CODE

router = APIRouter(prefix='/api/amap', tags=['amap'])


@router.get('/jsconfig')
def amap_jsconfig() -> JSONResponse:
    """交互地图配置：JS API Key 与安全密钥（未配置 JS Key 时 404，前端回退静态地图）"""
    if not AMAP_JS_KEY:
        return JSONResponse({'detail': 'AMAP_JS_KEY_MISSING'}, status_code=404)
    return JSONResponse({'key': AMAP_JS_KEY, 'securityCode': AMAP_SECURITY_CODE})


@router.get('/place')
def amap_place(keywords: str = Query(...), city: str = Query(default='')) -> JSONResponse:
    try:
        return JSONResponse(place_search(keywords, city or None))
    except AmapError as error:
        return _amap_error_response(error)


@router.get('/geocode')
def amap_geocode(address: str = Query(...), city: str = Query(default='')) -> JSONResponse:
    try:
        return JSONResponse(geocode(address, city or None))
    except AmapError as error:
        return _amap_error_response(error)


@router.get('/weather')
def amap_weather(city: str = Query(...)) -> JSONResponse:
    try:
        return JSONResponse(weather(city))
    except AmapError as error:
        return _amap_error_response(error)


@router.get('/route')
def amap_route(
    origin: str = Query(...),
    destination: str = Query(...),
    mode: str = Query(default='driving'),
) -> JSONResponse:
    try:
        return JSONResponse(route_planning(origin, destination, mode))
    except AmapError as error:
        return _amap_error_response(error)


@router.get('/routeline')
def amap_routeline(
    origin: str = Query(...),
    destination: str = Query(...),
    mode: str = Query(default='driving'),
) -> JSONResponse:
    """路线折线坐标：交互地图按需拉取（不进工具结果，避免撑爆上下文）"""
    try:
        return JSONResponse(route_line_points(origin, destination, mode))
    except AmapError as error:
        return _amap_error_response(error)


@router.get('/staticmap')
def amap_staticmap(
    markers: str = Query(...),
    location: str = Query(default=''),
    zoom: int = Query(default=13, ge=1, le=20),
    size: str = Query(default='540*320'),
) -> Response:
    """静态地图出图：PNG 供聊天中的地图卡片以 <img> 显示（该端点豁免访问口令）"""
    try:
        png = static_map(markers, location or None, zoom, size)
    except AmapError as error:
        return JSONResponse({'detail': str(error)}, status_code=400)
    return Response(
        content=png,
        media_type='image/png',
        headers={'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff'},
    )


def _amap_error_response(error: AmapError) -> JSONResponse:
    return JSONResponse({'detail': str(error)}, status_code=400)
