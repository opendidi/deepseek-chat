"""FastAPI 应用装配：lifespan、路由聚合、托管 dist/ 静态产物。

本机单用户服务，绑定 127.0.0.1；接口与前端 src/services/chat/db.ts 的函数一一对应，
存储语义见 storage 包（server/storage/）的模块注释，路由实现在 server/routers/。
"""

from __future__ import annotations

import hmac
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import AMAP_KEY, DATA_DIR, DIST_DIR
from .routers import ROUTERS
from .storage import configure


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    configure(DATA_DIR)
    yield


app = FastAPI(title='deepseek-chat', lifespan=_lifespan, docs_url=None, redoc_url=None, openapi_url=None)

# 访问口令（可选）：设置 ACCESS_PASSWORD 环境变量后，除健康检查外的全部 /api 请求
# 必须携带 x-access-key 头。用于公网部署时挡住无鉴权的数据读写；本地自用不设即完全关闭。
NO_AUTH_PATHS = {'/api/health'}


@app.middleware('http')
async def require_access_key(request: Request, call_next):
    password = os.environ.get('ACCESS_PASSWORD') or ''
    if (
        password
        and request.url.path.startswith('/api')
        and request.url.path not in NO_AUTH_PATHS
    ):
        supplied = request.headers.get('x-access-key', '')
        if not hmac.compare_digest(supplied.encode(), password.encode()):
            return JSONResponse({'detail': 'unauthorized'}, status_code=401)
    return await call_next(request)


@app.get('/api/auth/verify')
def verify_access_key() -> dict:
    """前端用来校验口令是否正确；中间件已拒绝错误口令，走到这里即通过"""
    return {'ok': True}


@app.middleware('http')
async def guard_cross_site(request: Request, call_next):
    """同源防线（CSRF / DNS rebinding）：浏览器跨站发起的「简单请求」（如 POST multipart）
    不触发 preflight、服务端照常执行——任意网页都能静默清空本机数据。
    带 Origin 头且与请求 Host 不同源的请求一律 403；非浏览器请求（无 Origin）不受影响。"""
    origin = request.headers.get('origin')
    if origin and urlsplit(origin).netloc != request.headers.get('host', ''):
        return JSONResponse({'detail': 'cross-origin request blocked'}, status_code=403)
    return await call_next(request)


@app.get('/api/health')
def health() -> dict:
    return {'ok': True, 'amap': bool(AMAP_KEY)}


for _router in ROUTERS:
    app.include_router(_router)

# API 路由注册完再挂静态目录，/api/* 优先；dist 尚未构建时只提供 API
if DIST_DIR.is_dir():
    app.mount('/', StaticFiles(directory=DIST_DIR, html=True), name='dist')
