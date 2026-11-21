"""全文搜索路由：GET /api/search?q="""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from ..storage import search_messages

router = APIRouter(prefix='/api/search', tags=['search'])


@router.get('')
def search(q: str = Query(default=''), limit: int = Query(default=30, ge=1, le=100)) -> Response:
    hits = search_messages(q, limit)
    return JSONResponse(hits, headers={'Cache-Control': 'no-store'})
