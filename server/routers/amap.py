"""高德地图代理路由：浏览器 Agent 工具经这里的端点调用高德 Web 服务 API。

Key 保存在服务器环境（AMAP_KEY，可由根目录 .env 提供），浏览器不接触；
未配置时端点返回 400 + AMAP_KEY_MISSING，前端据此给出部署引导提示。
地图卡片不嵌图，只展示可在高德地图打开的跳转链接（uri.amap.com，免 Key）。
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from ..amap import AmapError, geocode, place_search, route_planning, weather

router = APIRouter(prefix='/api/amap', tags=['amap'])


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


def _amap_error_response(error: AmapError) -> JSONResponse:
    return JSONResponse({'detail': str(error)}, status_code=400)
