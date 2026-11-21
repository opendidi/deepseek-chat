"""导入暂存路由：会话与附件先入 staging，commit 单事务整体替换正式数据。"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from ..schemas import FileTypesIn
from ..routers.parsing import validate_messages
from ..storage import (
    SessionExistsError,
    import_add_session,
    import_begin,
    import_commit,
    import_put_files,
    import_update_file_types,
)
from .parsing import read_upload_files

router = APIRouter(prefix='/api/import', tags=['import'])


@router.post('/begin')
def begin_import() -> dict:
    import_begin()
    return {'ok': True}


@router.post('/session')
def add_staging_session(session: dict) -> dict:
    if not isinstance(session, dict) or not isinstance(session.get('id'), str):
        raise HTTPException(status_code=400, detail='session 形状无效')
    validate_messages(session)
    try:
        import_add_session(session)
    except SessionExistsError as error:
        raise HTTPException(status_code=409, detail=f'重复的会话 id：{error}') from error
    return {'ok': True}


@router.post('/files')
async def add_staging_files(files: list[UploadFile] = File(default=[])) -> dict:
    content = await read_upload_files(files)
    await run_in_threadpool(
        import_put_files, [(file_id, bytes_) for file_id, bytes_, _mime in content]
    )
    return {'ok': True}


@router.patch('/file-types')
def update_file_types(body: FileTypesIn) -> dict:
    import_update_file_types(body.types)
    return {'ok': True}


@router.post('/commit')
def commit_import() -> list[dict]:
    # 同步 def 本身已在线程池里执行；不要套 run_in_threadpool（返回 coroutine 会导致响应校验 500）
    return import_commit()
