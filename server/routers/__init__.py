"""API 路由聚合：app.py 逐个 include 这里的 router。"""

from . import favorites, files, search, sessions, staging

ROUTERS = (
    sessions.router,
    files.router,
    favorites.router,
    staging.router,
    search.router,
)
