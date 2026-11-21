"""会话路由：列表、详情、整会话保存（multipart 单事务）、删除、重命名/置顶。"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from ..schemas import SessionPatch
from ..storage import (
    delete_session,
    list_summaries,
    load_session,
    rename_session,
    save_session,
    set_session_pinned,
)
from .parsing import parse_session_payload, read_upload_files

router = APIRouter(prefix='/api/sessions', tags=['sessions'])

# 会话列表/详情是动态数据（保存后立即可见），显式禁止浏览器缓存
NO_STORE = {'Cache-Control': 'no-store'}


@router.get('')
def list_sessions() -> Response:
    return JSONResponse(list_summaries(), headers=NO_STORE)


@router.get('/{session_id}')
def get_session(session_id: str) -> Response:
    session = load_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail='会话不存在')
    return JSONResponse(session, headers=NO_STORE)


@router.put('/{session_id}')
async def put_session(
    session_id: str, session: UploadFile = File(...), files: list[UploadFile] = File(default=[])
) -> dict:
    # session 以文件 part 传输：starlette 对非文件 part 有 1MB 上限，长会话 JSON 会被拦；
    # 文件 part 走临时文件落盘，没有这个限制
    if not session.filename:
        raise HTTPException(status_code=400, detail='session part 缺少文件名')
    raw = await session.read()
    try:
        data = parse_session_payload(raw.decode('utf-8'), session_id)
    except UnicodeDecodeError as error:
        raise HTTPException(status_code=400, detail='session 不是有效的 UTF-8') from error
    content = await read_upload_files(files)
    # SQLite 写入是同步阻塞的，放进线程池避免卡住事件循环
    await run_in_threadpool(save_session, data, content)
    return {'ok': True}


@router.delete('/{session_id}')
def remove_session(session_id: str) -> Response:
    delete_session(session_id)
    return Response(status_code=204)


@router.patch('/{session_id}')
def patch_session(session_id: str, patch: SessionPatch) -> Response:
    if patch.title is not None:
        rename_session(session_id, patch.title)
    if patch.pinned is not None:
        set_session_pinned(session_id, patch.pinned)
    return Response(status_code=204)
