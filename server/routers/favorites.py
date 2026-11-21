"""收藏路由：跨会话收藏的读取、保存与删除。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from ..schemas import FavoriteIn
from ..storage import delete_favorite, list_favorites, put_favorite

router = APIRouter(prefix='/api/favorites', tags=['favorites'])


@router.get('')
def get_favorites() -> list[dict]:
    return list_favorites()


@router.put('/{favorite_id}')
def save_favorite(favorite_id: str, favorite: FavoriteIn) -> Response:
    if favorite.id != favorite_id:
        raise HTTPException(status_code=400, detail='favorite.id 与请求路径不一致')
    put_favorite(favorite.model_dump())
    return Response(status_code=204)


@router.delete('/{favorite_id}')
def remove_favorite(favorite_id: str) -> Response:
    delete_favorite(favorite_id)
    return Response(status_code=204)
