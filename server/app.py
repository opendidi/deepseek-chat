"""FastAPI 应用装配：lifespan、路由聚合、托管 dist/ 静态产物。

本机单用户服务，绑定 127.0.0.1；接口与前端 src/services/chat/db.ts 的函数一一对应，
存储语义见 storage 包（server/storage/）的模块注释，路由实现在 server/routers/。

静态托管开关：默认托管 dist/（生产单端口形态）；设置 SERVE_DIST=0 后为纯 API 服务
（本地开发 python starter.py / pnpm backend，前端由 pnpm dev 的 devServer 托管并代理 /api）。
"""

from __future__ import annotations

import hmac
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
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

# GZip 必须最内层（紧贴路由）：下面的 @app.middleware 都是 BaseHTTPMiddleware，会把响应
# 变成流式分块，GZip 在外层时 minimum_size 判断拿不到完整 body，小响应也会被压缩。
# 对 >1KB 的 JSON / js / css 响应生效（Accept-Encoding: gzip 时），
# 677KB 的主包在远程访问下降到约 220KB。
app.add_middleware(GZipMiddleware, minimum_size=1024)

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


@app.middleware('http')
async def static_cache_headers(request: Request, call_next):
    """带内容 hash 的 js/css 一年不可变缓存：回访直接命中本地缓存零请求。
    index.html 引用这些 hash 文件，必须每次协商（no-cache）以免更新后拿旧引用。"""
    response = await call_next(request)
    path = request.url.path
    if request.method == 'GET' and (path.startswith('/static/js/') or path.startswith('/static/css/')):
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    elif path in ('/', '/index.html'):
        response.headers.setdefault('Cache-Control', 'no-cache')
    return response


@app.get('/api/health')
def health() -> dict:
    return {'ok': True, 'amap': bool(AMAP_KEY)}


for _router in ROUTERS:
    app.include_router(_router)

# API 路由注册完再挂静态目录，/api/* 优先；dist 尚未构建或显式 SERVE_DIST=0 时不托管，
# 此时 / 返回提示信息（前端由 pnpm dev 的 devServer 托管）
if DIST_DIR.is_dir() and os.environ.get('SERVE_DIST', '1') != '0':
    app.mount('/', StaticFiles(directory=DIST_DIR, html=True), name='dist')
else:

    @app.get('/', include_in_schema=False)
    def index_hint() -> JSONResponse:
        return JSONResponse(
            {
                'detail': '后端为纯 API 服务，未托管前端页面',
                'hint': {
                    '开发调试': 'pnpm dev（devServer 默认 8090，/api 已代理到本服务）',
                    '前后端一起': 'pnpm dev:all',
                    '单端口生产形态': 'pnpm build 后以默认环境启动 uvicorn（或去掉 SERVE_DIST=0）',
                },
            },
            status_code=404,
        )
